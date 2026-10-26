import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { FAKE_DIR } from "../src/test-env/env.ts";
import { served, type Server } from "./server.ts";

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const log = (page: Page) => page.getByRole("log", { name: "Conversation" });
const pane = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const send = async (page: Page, text: string) => {
  await composer(page).fill(text);
  await composer(page).press("Enter");
};
const modelSelect = (page: Page) => page.getByRole("combobox", { name: /model/i });
const pie = (page: Page) => page.getByRole("button", { name: /context/i });

/** A `claude` stand-in that fails with a given error, and passes through to the fake agent once `ok` exists. */
function shim(root: string) {
  const dir = join(root, "shim");
  mkdirSync(dir, { recursive: true });
  const state = join(root, "shim-state");
  mkdirSync(state, { recursive: true });
  writeFileSync(
    join(dir, "claude"),
    `#!/bin/sh
echo "$@" >> "${state}/launches"
if [ -f "${state}/ok" ]; then exec "${FAKE_DIR}/claude" "$@"; fi
cat "${state}/error" >&2
exit 1
`,
  );
  chmodSync(join(dir, "claude"), 0o755);
  return {
    dir,
    ok: () => writeFileSync(join(state, "ok"), ""),
    broken: (text: string) => {
      writeFileSync(join(state, "error"), text);
      rmSync(join(state, "ok"), { force: true });
    },
    launches: () => (existsSync(join(state, "launches")) ? readFileSync(join(state, "launches"), "utf8").split("\n").filter(Boolean) : []),
    state,
  };
}

const SCRIPT = {
  roles: { chat: { replies: [[say("a1", "First answer")], [say("a2", "You asked: hello")], [say("a3", "Third answer")]] } },
};

test("21.1 a conversation keeps its model and context fill across a server restart", async ({ page }) => {
  const s = await served({ script: SCRIPT });
  try {
    await page.goto(s.url);
    await modelSelect(page).selectOption({ label: "Opus" });
    await send(page, "hello");
    await expect(log(page)).toContainText("First answer");
    const fill = await pie(page).getAttribute("aria-valuenow");
    expect(fill).not.toBeNull();
    await s.restart();
    await page.goto(s.url);
    await expect(modelSelect(page)).toHaveValue(/opus/i);
    expect(await pie(page).getAttribute("aria-valuenow")).toBe(fill);
    await send(page, "What did I ask you before?");
    await expect(log(page)).toContainText("hello");
    const args = s.launches().flatMap((r) => (r.kind === "launch" ? [r.args.join(" ")] : []));
    expect(args.at(-1)).toMatch(/--resume\s+\S+/);
  } finally {
    await s.dispose();
  }
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page }) => {
  const s = await served({ script: SCRIPT });
  try {
    await page.goto(s.url);
    await send(page, "hello");
    await expect(log(page)).toContainText("First answer");
    await s.restart();
    await page.goto(s.url);
    // the conversation is open again with its earlier turn
    await expect(log(page)).toContainText("First answer");
    await send(page, "second message");
    await expect(log(page)).toContainText(/You asked|Third answer|answer/i);
    await expect(pane(page)).not.toContainText("Your message was not delivered. Send it again.");
    const launches = s.launches().filter((r) => r.kind === "launch");
    expect(launches.length).toBeGreaterThanOrEqual(2);
    expect(launches.at(-1)?.args.join(" ")).toMatch(/--(resume|session-id)/);
  } finally {
    await s.dispose();
  }
});

async function withShim(error: string, body: (s: Server, page: Page, sh: ReturnType<typeof shim>) => Promise<void>, page: Page) {
  const root = join(tmpdir(), `werk-heldout-shim-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  const sh = shim(root);
  const base = process.env.PATH ?? "";
  const s = await served({
    script: SCRIPT,
    env: { PATH: `${sh.dir}:${FAKE_DIR}:${base}` },
  });
  try {
    writeFileSync(join(sh.state, "error"), error);
    await page.goto(s.url);
    await body(s, page, sh);
  } finally {
    await s.dispose();
  }
}

const MULTI = "boom: first line\nsecond line of the stack\nthird line: exit 1\n";

test("21.3 a crash with another error retries once, then asks the person to send again and shows the whole error", async ({ page }) => {
  await withShim(MULTI, async (s, page, sh) => {
    sh.ok();
    await send(page, "hello");
    await expect(log(page)).toContainText("First answer");
    // the agent now exits early each time it starts
    sh.broken(MULTI);
    await s.restart();
    const before = sh.launches().length;
    await page.goto(s.url);
    await send(page, "second message");
    await expect(pane(page)).toContainText("Your message was not delivered. Send it again.");
    for (const line of MULTI.trim().split("\n")) await expect(pane(page)).toContainText(line);
    expect(sh.launches().length - before).toBe(2);
    sh.ok();
    await send(page, "second message");
    await expect(log(page)).toContainText(/answer/i);
  }, page);
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const LOGIN = "Invalid API key\nPlease run /login\nthen start again\n";
  await withShim(LOGIN, async (_s, page, sh) => {
    await send(page, "hello");
    for (const line of LOGIN.trim().split("\n")) await expect(pane(page)).toContainText(line);
    await expect(pane(page)).toContainText("Your message was not delivered. Send it again.");
    expect(sh.launches()).toHaveLength(1);
  }, page);
});

test("21.5 the model switch and clear context refuse during a turn and restart quietly when idle", async ({ page }) => {
  const s = await served({
    script: { roles: { chat: { replies: [[say("l1", "working"), { pause: 4000 }, say("l2", "done")], [say("n1", "next answer")], [say("n2", "after clear")]] } } },
  });
  try {
    await page.goto(s.url);
    await expect(modelSelect(page)).toHaveValue(/sonnet/i);
    await send(page, "a long turn");
    await expect(log(page)).toContainText("working");
    await modelSelect(page).selectOption({ label: "Opus" });
    await expect(modelSelect(page)).toHaveValue(/sonnet/i);
    await expect(log(page)).toContainText("done", { timeout: 15000 });
    await modelSelect(page).selectOption({ label: "Sonnet with Opus advisor" });
    await expect(modelSelect(page)).toHaveValue(/advisor/i);
    await expect(pane(page)).not.toContainText(/crash|exited/i);
    await pie(page).click();
    await expect(page.getByText("Clear context")).toBeVisible();
    await page.getByText("Clear context").click();
    await expect(pane(page)).not.toContainText(/crash|exited/i);
    await send(page, "after clearing");
    await expect(log(page)).toContainText(/answer|clear/i);
  } finally {
    await s.dispose();
  }
});
