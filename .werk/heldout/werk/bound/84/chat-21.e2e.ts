import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test, type Werk } from "../e2e/harness.ts";
import { FAKE_DIR_VAR, SCRIPT_FILE } from "../src/test/fake-script.ts";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_BIN } from "../e2e/harness.ts";
import { useFake, init, launchArgs, heard, entries, pane, say, turns } from "./chat-helpers.ts";
import { tmpdir } from "node:os";

type H = { start(o: object): Promise<Werk> };

function fakeDirOf(): string {
  const d = join(tmpdir(), `werk-heldout-fake-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}
const setScript = (dir: string, script: object) => writeFileSync(join(dir, SCRIPT_FILE), JSON.stringify(script));

const answerOf = (id: string, text: string, tokens: number, session: string) => [
  init(session),
  {
    event: {
      type: "assistant",
      message: { id, content: [{ type: "text", text }], usage: { input_tokens: tokens, output_tokens: 0 } },
    },
  },
  {
    event: {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      duration_ms: 5,
      total_cost_usd: 0,
      modelUsage: { "claude-opus-5-5": { contextWindow: 200000 }, "claude-sonnet-5-5[1m]": { contextWindow: 1000000 } },
    },
  },
];

async function boot(h: H, dir: string): Promise<Werk> {
  return h.start({ env: { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: dir } });
}
const picked = (p: Page) => pane(p).getByLabel("Model").locator("option:checked");
const pie = (p: Page) => pane(p).getByRole("button", { name: /^Context \d+%$/ });

test("21.1 model and context fill survive a restart; same session resumes", async ({ page: p, harness }) => {
  const dir = fakeDirOf();
  useFake(dir);
  setScript(dir, { roles: { chat: { replies: [answerOf("a1", "Noted.", 100000, "sess-1"), answerOf("a2", "Earlier.", 100000, "sess-1")] } } });
  const w = await boot(harness, dir);
  await p.goto(`${w.url}/map`);
  await pane(p).getByLabel("Model").selectOption({ label: "Opus" });
  await expect(picked(p)).toHaveText("Opus");
  await say(p, "Remember the number 42");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const before = await pie(p).getAttribute("aria-label");
  expect(before).toBe("Context 50%");
  await w.restart();
  await p.goto(`${w.url}/map`);
  await expect(picked(p)).toHaveText("Opus");
  await expect(pie(p)).toHaveAttribute("aria-label", before as string);
  await say(p, "What did I ask you before?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Noted.");
  const args = launchArgs(w);
  expect(args).toHaveLength(2);
  expect(args[1]?.join(" ")).toContain("--resume sess-1");
  expect(args[1]?.join(" ")).toContain("--model claude-opus-5-5");
  expect(heard(w).flat().at(-1)).toContain("What did I ask you before?");
});

test("21.2 dead stored session starts again; waiting message is delivered", async ({ page: p, harness }) => {
  const dir = fakeDirOf();
  useFake(dir);
  setScript(dir, { roles: { chat: { replies: [answerOf("a1", "First.", 1000, "sess-old")] } } });
  const w = await boot(harness, dir);
  await p.goto(`${w.url}/map`);
  await say(p, "hello");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  setScript(dir, { roles: { chat: { sessions: ["other"], replies: [answerOf("a2", "Fresh answer.", 1000, "sess-new")] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "second message");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Fresh answer.");
  await expect(pane(p)).not.toContainText("Your message was not delivered. Send it again.");
  const args = launchArgs(w);
  expect(args.length).toBe(3);
  expect(args[1]?.join(" ")).toContain("--resume sess-old");
  expect(args[2]?.join(" ")).not.toContain("--resume");
  expect(entries(w).filter((e) => e.kind === "message")).toHaveLength(2);
});

const CRASH = "Error line one\nError line two\nError line three\nError line four";
test("21.3 other crash retries once, shows whole error, then recovers in same session", async ({ page: p, harness }) => {
  const dir = fakeDirOf();
  useFake(dir);
  setScript(dir, { roles: { chat: { replies: [answerOf("a1", "First.", 1000, "sess-a")] } } });
  const w = await boot(harness, dir);
  await p.goto(`${w.url}/map`);
  await say(p, "hello");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  setScript(dir, { roles: { chat: { replies: [[{ stderr: `${CRASH}\n` }, { crash: 1 }]] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  const before = launchArgs(w).length;
  await say(p, "again");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  for (const l of CRASH.split("\n")) await expect(pane(p)).toContainText(l);
  expect(launchArgs(w).length - before).toBe(2);
  setScript(dir, { roles: { chat: { replies: [answerOf("a3", "Back.", 1000, "sess-a")] } } });
  await say(p, "once more");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("Back.");
  expect(launchArgs(w).at(-1)?.join(" ")).toContain("--resume sess-a");
});

test("21.4 login problem shows at once with no retry", async ({ page: p, harness }) => {
  const dir = fakeDirOf();
  useFake(dir);
  const err = "Not logged in.\nRun: claude auth login\nthen retry\n";
  setScript(dir, { roles: { chat: { replies: [[{ stderr: err }, { crash: 1 }]] } } });
  const w = await boot(harness, dir);
  await p.goto(`${w.url}/map`);
  await say(p, "hi");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  for (const l of ["Not logged in.", "Run: claude auth login", "then retry"]) await expect(pane(p)).toContainText(l);
  expect(launchArgs(w)).toHaveLength(1);
});

test("21.5 model switch and clear refuse during a turn, work when idle", async ({ page: p, harness }) => {
  const dir = fakeDirOf();
  useFake(dir);
  const long = [init("sess-5"), { pause: 3000 }, ...answerOf("a1", "Long done.", 1000, "sess-5").slice(1)];
  setScript(dir, { roles: { chat: { replies: [long, answerOf("a2", "After clear.", 10, "sess-6")] } } });
  const w = await boot(harness, dir);
  await p.goto(`${w.url}/map`);
  await pane(p).getByLabel("Model").selectOption({ label: "Sonnet" });
  await expect(picked(p)).toHaveText("Sonnet");
  const style = await pie(p).getAttribute("style");
  expect(style).toMatch(/14,\s*165,\s*233/);
  await say(p, "do a long thing");
  await expect(pane(p).getByRole("status", { name: "Turn state" })).toContainText("tokens");
  // The control is disabled while the turn runs, so a person cannot pick Opus.
  await expect(pane(p).getByLabel("Model")).toBeDisabled();
  await expect(pane(p).getByLabel("Model").selectOption({ label: "Opus" }, { timeout: 1000 })).rejects.toThrow();
  await expect(picked(p)).toHaveText("Sonnet");
  const token = await p.locator('meta[name="werk-token"]').getAttribute("content");
  const refused = await fetch(`${w.url}/api/model`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token as string },
    body: JSON.stringify({ model: "claude-opus-5-5", advisor: null }),
  });
  expect(refused.status).toBe(409);
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await pane(p).getByLabel("Model").selectOption({ label: "Sonnet + Opus advisor" });
  await expect(picked(p)).toHaveText("Sonnet + Opus advisor");
  await expect(pane(p)).not.toContainText("not delivered");
  await expect(pane(p).getByText(/exited before/)).toHaveCount(0);
  await pie(p).click();
  const dialog = pane(p).getByRole("dialog", { name: "Context" });
  await expect(dialog).toContainText("%");
  await dialog.getByRole("button", { name: "Clear context" }).click();
  await expect(pane(p)).not.toContainText("not delivered");
  await expect(pane(p).getByText(/exited before/)).toHaveCount(0);
  await say(p, "next");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText(/After clear\.|Long done\./);
  void readFileSync;
});
