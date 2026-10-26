import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test as base } from "@playwright/test";
import { test } from "../e2e/harness";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE } from "../src/test/fake-script.ts";
import type { ScriptInput } from "../src/test/project.ts";
import { hueChroma } from "./colors.ts";

void base;
const SONNET = "claude-sonnet-5-5[1m]";
const OPUS = "claude-opus-5-5";
const init = (id: string) => ({ event: { type: "system", subtype: "init", session_id: id } });
const text = (id: string, words: string, usage?: object) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text: words }], ...(usage ? { usage } : {}) } },
});

function fakeDir(script: ScriptInput): { dir: string; env: Record<string, string>; set(s: ScriptInput): void; launches(): LaunchEntry[] } {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-fake-"));
  writeFileSync(join(dir, SCRIPT_FILE), JSON.stringify(script));
  return {
    dir,
    env: { ...(process.env as Record<string, string>), [FAKE_DIR_VAR]: dir },
    set: (s) => writeFileSync(join(dir, SCRIPT_FILE), JSON.stringify(s)),
    launches: () => {
      const f = join(dir, LAUNCHES_FILE);
      return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LaunchEntry) : [];
    },
  };
}
const argsOf = (l: LaunchEntry[]) => l.filter((e) => e.kind === "launch").map((e) => (e as { args: string[] }).args);
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const turns = (p: Page) => pane(p).locator("[data-turn]");
async function say(p: Page, words: string) {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}
const model = (p: Page) => pane(p).getByRole("combobox", { name: "Model" });
const pie = (p: Page) => pane(p).getByRole("button", { name: /^Context \d+%$/ });

test("21.1 a conversation keeps its model and context fill across a server restart", async ({ page: p, harness }) => {
  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 149_850 };
  const result = { type: "result", modelUsage: { [OPUS]: { contextWindow: 200_000 } } };
  const f = fakeDir({ roles: { chat: { replies: [[init("s-1"), text("m1", "Hello back", usage), { event: result }]] } } });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Opus" });
  await say(p, "Hello there");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const fill = await pie(p).getAttribute("aria-label");
  expect(fill).toMatch(/Context [1-9]\d*%/);
  await w.restart();
  await p.reload();
  await expect(model(p).locator("option:checked")).toHaveText("Opus");
  await expect(pie(p)).toHaveAttribute("aria-label", fill as string);
  await say(p, "What did I ask you before?");
  await expect(turns(p).last().locator('[data-role="turn-end"]')).toBeVisible();
  const launches = argsOf(f.launches());
  expect(launches.length).toBe(2);
  expect(flag(launches[1] as string[], "--resume")).toBe("s-1");
  expect(flag(launches[1] as string[], "--model")).toBe(OPUS);
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page: p, harness }) => {
  const f = fakeDir({ roles: { chat: { replies: [[init("s-1"), text("m1", "first answer")]] } } });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await say(p, "Earlier message");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("first answer");
  await w.restart();
  f.set({ roles: { chat: { replies: [[init("s-2"), text("m2", "second answer")]], sessions: ["s-2"] } } });
  await p.reload();
  await say(p, "New message");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("second answer");
  await expect(pane(p)).not.toContainText("Your message was not delivered. Send it again.");
  const sent = f.launches().filter((e) => e.kind === "message").length;
  expect(sent).toBe(2);
});

test("21.3 another crash retries once, asks to send again with the whole error, then resumes", async ({ page: p, harness }) => {
  const f = fakeDir({ roles: { chat: { replies: [[init("s-1"), text("m1", "earlier answer")]] } } });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await say(p, "Earlier");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("earlier answer");
  await model(p).selectOption({ label: "Opus" }); // idle switch: the next message starts a new agent
  const before = argsOf(f.launches()).length;
  f.set({ roles: { chat: { replies: [[{ stderr: "boom line one\nboom line two\nboom line three\n" }, { crash: 1 }]], sessions: ["s-1"] } } });
  await say(p, "Second");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  for (const l of ["boom line one", "boom line two", "boom line three"]) await expect(pane(p)).toContainText(l);
  expect(argsOf(f.launches()).length - before).toBe(2);
  f.set({ roles: { chat: { replies: [[init("s-1"), text("m3", "recovered")]], sessions: ["s-1"] } } });
  await say(p, "Second again");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("recovered");
  const last = argsOf(f.launches()).at(-1) as string[];
  expect(flag(last, "--resume")).toBe("s-1");
});

test("21.4 a login problem shows its error at once with no retry", async ({ page: p, harness }) => {
  const f = fakeDir({
    roles: { chat: { replies: [[{ stderr: "Not logged in\nPlease run claude auth login\nthen try again\n" }, { crash: 1 }]] } },
  });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await say(p, "Hello");
  await expect(pane(p)).toContainText("Not logged in");
  expect(argsOf(f.launches()).length).toBe(1);
  for (const l of ["Not logged in", "Please run claude auth login", "then try again"]) await expect(pane(p)).toContainText(l);
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
});

test("21.5 the model switch and clear context refuse during a turn and restart quietly when idle", async ({ page: p, harness }) => {
  const long = [init("s-1"), { event: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } }, { event: { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "thinking" } } } }, { pause: 3000 }, text("m1", "long answer", { input_tokens: 500 }), { event: { type: "result" } }];
  const f = fakeDir({ roles: { chat: { replies: [long, [text("m2", "after clear")]] } } });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Sonnet" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  const bg = await pie(p).evaluate((el) => getComputedStyle(el).backgroundImage + getComputedStyle(el).backgroundColor);
  expect(bg).toMatch(/\(/);
  const blueLike = /rgb\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
  expect(blueLike).not.toBeNull();
  const [r, g, b] = [Number(blueLike?.[1]), Number(blueLike?.[2]), Number(blueLike?.[3])];
  expect(b).toBeGreaterThan(r);
  void g;
  await say(p, "A long one");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("thinking");
  const refusal = await p.evaluate(async () => {
    const token = document.querySelector('meta[name="werk-token"]')?.getAttribute("content") ?? "";
    const r = await fetch("/api/model", { method: "POST", headers: { "content-type": "application/json", "x-werk-token": token }, body: JSON.stringify({ model: "claude-opus-5-5", advisor: null }) });
    return r.status;
  });
  expect(refusal).toBe(409);
  await expect(model(p)).toBeDisabled();
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible({ timeout: 15000 });
  await model(p).selectOption({ label: "Sonnet + Opus advisor" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet + Opus advisor");
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await pie(p).click();
  const pop = pane(p).getByRole("dialog", { name: "Context" });
  await expect(pop).toContainText(/\d+% of the context window/);
  await pop.getByRole("button", { name: "Clear context" }).click();
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await say(p, "Next one");
  await expect(turns(p).last().locator(".msg.agent")).toContainText("answer", { timeout: 15000 });
});

test("22.2 Always allow applies its rule now and after a restart", async ({ page: p, harness }) => {
  const mkdir = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };
  const input = { command: "mkdir -p /tmp/x" };
  const ask = [{ ask: { id: "r1", tool: "Bash", input, suggestions: [mkdir] } }, text("m1", "ok")];
  const f = fakeDir({ roles: { chat: { replies: [ask, ask] } } });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await say(p, "Make the folder");
  const bar = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(bar.getByRole("button", { name: "Always allow Bash(mkdir:*)" })).toBeVisible();
  await bar.getByRole("button", { name: "Always allow Bash(mkdir:*)" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const log = () => readFileSync(join(w.dir, ".werk", "asks.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(log()[0]).toMatchObject({ decision: "always" });
  expect(JSON.stringify(log()[0])).toContain("Bash(mkdir:*)");
  // The fake agent keeps asking whatever the rules say, so the rule is checked where werk applies it:
  // the answer carries the CLI's own suggestion back, the conversation keeps the rule on disk, and every
  // later agent starts with it as an allowed tool.
  const answered = f.launches().filter((e) => e.kind === "answer").map((e) => (e as { answer: unknown }).answer);
  expect(answered[0]).toMatchObject({ behavior: "allow", updatedInput: input, updatedPermissions: [mkdir] });
  expect(JSON.parse(readFileSync(join(w.dir, ".werk", "allow.json"), "utf8"))).toEqual({ main: { rules: ["Bash(mkdir:*)"], dirs: [] } });
  await w.restart();
  await p.reload();
  await say(p, "After restart");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" })).toBeVisible();
  const launches = argsOf(f.launches());
  const last = launches.at(-1) as string[];
  expect(last[last.indexOf("--allowedTools") + 1]).toBe("Bash(mkdir:*)");
  void hueChroma;
});
