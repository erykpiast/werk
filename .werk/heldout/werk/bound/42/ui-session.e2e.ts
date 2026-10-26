import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE } from "../src/test/fake-script.ts";
import { test } from "../e2e/harness.ts";

const stream = (event: object) => ({ event: { type: "stream_event", event } });
const start = (id: string) => stream({ type: "message_start", message: { id } });
const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
const done = (id: string, text: string, usage?: object) => ({ event: { type: "assistant", message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) } } });
const init = (session: string) => ({ event: { type: "system", subtype: "init", session_id: session } });
const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const turns = (p: Page) => pane(p).locator("[data-turn]");
async function say(p: Page, words: string) {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}
const model = (p: Page) => pane(p).getByLabel("Model");
const pie = (p: Page) => pane(p).getByRole("button", { name: /^Context \d+%$/ });

function fake() {
  const dir = mkdtempSync(join(tmpdir(), "heldout-fake-"));
  const script = (s: object) => writeFileSync(join(dir, SCRIPT_FILE), JSON.stringify(s));
  const launches = () => {
    const f = join(dir, LAUNCHES_FILE);
    return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LaunchEntry) : [];
  };
  const args = () => launches().flatMap((e) => (e.kind === "launch" ? [e.args] : []));
  const flag = (a: string[], n: string) => (a.indexOf(n) >= 0 ? a[a.indexOf(n) + 1] : undefined);
  return { dir, script, launches, args, flag, env: { ...process.env, [FAKE_DIR_VAR]: dir } as Record<string, string> };
}
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5[1m]";

test("[21.1] a conversation keeps its model and context fill across a restart", async ({ page: p, harness }) => {
  const f = fake();
  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 149_850 };
  const result = { type: "result", subtype: "success", is_error: false, result: "", modelUsage: { [OPUS]: { contextWindow: 200_000 } } };
  f.script({
    roles: { chat: { replies: [[init("s-1"), start("m1"), open("You asked: hello first"), done("m1", "You asked: hello first", usage), { event: result }]], sessions: ["s-1"] } },
  });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Opus" });
  await say(p, "hello first");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const label = await pie(p).getAttribute("aria-label");
  console.log("PIE BEFORE", label);
  expect(label).toBe("Context 75%");
  await w.restart();
  await p.goto(`${w.url}/map`);
  await expect(model(p).locator("option:checked")).toHaveText("Opus");
  await expect(pie(p)).toHaveAttribute("aria-label", label as string);
  await say(p, "What did I ask you before?");
  await expect(turns(p).last().locator(".msg.agent")).toContainText("hello first");
  const a = f.args();
  expect(a).toHaveLength(2);
  expect(f.flag(a[1] as string[], "--resume")).toBe("s-1");
  expect(f.flag(a[1] as string[], "--model")).toBe(OPUS);
});

test("[21.2] a dead stored session starts again and the waiting message is delivered", async ({ page: p, harness }) => {
  const f = fake();
  f.script({ roles: { chat: { replies: [[init("s-1"), start("m1"), open("first answer"), done("m1", "first answer")]], sessions: ["s-1", "s-2"] } } });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await say(p, "first message");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("first answer");
  await w.stop();
  // the stored session no longer exists in Claude Code: only s-2 exists now
  f.script({ roles: { chat: { replies: [[init("s-2"), start("m2"), open("fresh answer"), done("m2", "fresh answer")]], sessions: ["s-2"] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "new message");
  await expect(turns(p).last().locator(".msg.agent")).toContainText("fresh answer");
  await expect(pane(p)).not.toContainText("Your message was not delivered");
  const a = f.args();
  console.log("ARGS", a.map((x) => f.flag(x, "--resume")));
  expect(a.length).toBeGreaterThanOrEqual(3);
  expect(f.flag(a[1] as string[], "--resume")).toBe("s-1");
  expect(f.flag(a[a.length - 1] as string[], "--resume")).toBeUndefined();
  const users = f.launches().filter((e) => e.kind === "message").length;
  expect(users).toBe(2);
});

test("[21.3] another crash retries once, asks to send again, shows the whole error", async ({ page: p, harness }) => {
  const f = fake();
  f.script({ roles: { chat: { replies: [[init("s-1"), start("m1"), open("first answer"), done("m1", "first answer")]], sessions: ["s-1"] } } });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await say(p, "first message");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("first answer");
  await w.stop();
  f.script({ roles: { chat: { replies: [[{ stderr: "line one\nline two\nline three\n" }, { crash: 1 }]], sessions: ["s-1"] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  const before = f.args().length;
  await say(p, "second message");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  for (const l of ["line one", "line two", "line three"]) await expect(pane(p)).toContainText(l);
  expect(f.args().length - before).toBe(2);
  f.script({ roles: { chat: { replies: [[init("s-1"), start("m2"), open("recovered"), done("m2", "recovered")]], sessions: ["s-1"] } } });
  await say(p, "second message again");
  await expect(turns(p).last().locator(".msg.agent")).toContainText("recovered");
  const a = f.args();
  expect(f.flag(a[a.length - 1] as string[], "--resume")).toBe("s-1");
});

test("[21.4] a login problem shows at once with no retry", async ({ page: p, harness }) => {
  const f = fake();
  f.script({
    roles: { chat: { replies: [[{ stderr: "Not logged in\nPlease run claude auth login\nthen try again\n" }, { crash: 1 }]] } },
  });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await say(p, "hello");
  await expect(pane(p)).toContainText("then try again");
  for (const l of ["Not logged in", "Please run claude auth login", "then try again"]) await expect(pane(p)).toContainText(l);
  await p.waitForTimeout(1500);
  expect(f.args()).toHaveLength(1);
  const text = (await pane(p).textContent()) ?? "";
  console.log("PANE:", text.slice(0, 400));
  console.log("FULL PANE:", JSON.stringify(text));
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
});

test("[21.5] switch and clear refuse during a turn, restart quietly when idle", async ({ page: p, harness }) => {
  const f = fake();
  f.script({
    roles: {
      chat: {
        replies: [[init("s-1"), start("m1"), open("Working"), { pause: 3500 }, done("m1", "Working done", { input_tokens: 10, output_tokens: 5 }), { event: { type: "result", subtype: "success", is_error: false, result: "" } }]],
      },
    },
  });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Sonnet" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  const bg = await pie(p).evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain("rgb(14, 165, 233)");
  await say(p, "do a long thing");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Working");
  const disabled = await model(p).isDisabled();
  console.log("MODEL SELECT DISABLED DURING TURN:", disabled);
  if (!disabled) await model(p).selectOption({ label: "Opus" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await model(p).selectOption({ label: "Sonnet + Opus advisor" });
  await expect(model(p).locator("option:checked")).toHaveText(/Sonnet.*Opus advisor/);
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await expect(pane(p).getByRole("alert")).toHaveCount(0);
  await pie(p).click();
  const pop = pane(p).getByRole("dialog", { name: "Context" });
  await expect(pop).toContainText("%");
  await pop.getByRole("button", { name: "Clear context" }).click();
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await expect(pane(p).getByRole("alert")).toHaveCount(0);
  await say(p, "after clear");
  await expect(turns(p).last().locator(".msg.agent")).toContainText("Working", { timeout: 15000 });
});

test("[22.2] always allow: the rule is kept and every child after a restart starts with it", async ({ page: p, harness }) => {
  const f = fake();
  const mkdir = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };
  const input = { command: "mkdir -p /tmp/x" };
  f.script({
    roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input, suggestions: [mkdir] } }, start("m1"), open("Done."), done("m1", "Done.")]] } },
  });
  const w = await harness.start({ env: f.env });
  await p.goto(`${w.url}/map`);
  await say(p, "Make the folder");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await ask.getByRole("button", { name: "Always allow Bash(mkdir:*)" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const answered = f.launches().flatMap((e) => (e.kind === "answer" ? [e.answer] : []));
  expect(answered).toEqual([{ behavior: "allow", updatedInput: input, updatedPermissions: [mkdir] }]);
  expect(JSON.stringify(f.args()[0])).not.toContain("mkdir:*");
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "Make it again");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" })).toBeVisible();
  const second = f.args()[1] as string[];
  console.log("SECOND CHILD ARGS", JSON.stringify(second));
  expect(JSON.stringify(second)).toContain("Bash(mkdir:*)");
});
