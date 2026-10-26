// Step 15: the person opens a card in werk's map. The map is started the way the dev task
// starts it (`werk serve`, from package.json), in a temp project with the step's cards.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
type Card = { id: string; title?: string; body?: string; summary?: string };

async function openMap(cards: Card[], extraLines: object[] = []): Promise<{ url: string; stop: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-map-"));
  mkdirSync(join(dir, ".werk"));
  const lines = cards.map((c, i) => ({
    seq: i + 1,
    at: new Date().toISOString(),
    actor: "you",
    type: "node.added",
    payload: { id: c.id, kind: "card", title: c.title ?? c.summary ?? c.id, ...(c.body ? { body: c.body } : {}) },
  }));
  const all = [...lines, ...extraLines.map((e, i) => ({ seq: lines.length + i + 1, at: new Date().toISOString(), ...e }))];
  writeFileSync(join(dir, ".werk", "log.jsonl"), all.map((l) => `${JSON.stringify(l)}\n`).join(""));
  const proc = spawn("bun", [CLI, "serve"], { cwd: dir });
  let out = "";
  let err = "";
  proc.stderr.on("data", (d) => (err += d));
  const exited = new Promise<number | null>((r) => proc.on("exit", (code) => r(code)));
  const url = await new Promise<string | undefined>((resolve) => {
    proc.stdout.on("data", (d) => {
      out += d;
      const hit = /https?:\/\/[^\s/]+/.exec(out)?.[0];
      if (hit) resolve(hit);
    });
    void exited.then(() => resolve(undefined));
    setTimeout(() => resolve(undefined), 10000);
  });
  if (url === undefined) {
    proc.kill();
    throw new Error(`the map did not start: exit ${await exited}: ${err.split("\n")[0]}`);
  }
  return { url, stop: () => proc.kill() };
}

async function openCard(p: Page, cards: Card[], id: string, extra: object[] = []) {
  const map = await openMap(cards, extra);
  await p.goto(`${map.url}/map/${id}`);
  return map;
}

test("15.1", async ({ page: p }) => {
  const map = await openCard(
    p,
    [{ id: "al-diff" }, { id: "align" }, { id: "notes-test", body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." }],
    "notes-test",
  );
  await expect(p.locator('a[href="/map/al-diff"]')).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  await expect(p.locator('a[href="/map/align"]')).toHaveText("#align");
  await p.locator('a[href="/map/al-diff"]').nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  map.stop();
});

test("15.2", async ({ page: p }) => {
  const body = ["--al-diff", "", "##al-diff", "", "&al-diff", "", "a code span holding `node src/cli.ts show #al-diff`", "", "see #no-such-card", "", "visit https://example.com/page#al-diff", "", "# al-diff", "", "And #al-diff on its own."].join("\n");
  const map = await openCard(p, [{ id: "al-diff" }, { id: "guards", body }], "guards");
  await expect(p.locator('a[href="/map/al-diff"]')).toHaveCount(1);
  map.stop();
});

test("15.3", async ({ page: p }) => {
  const body = ["```zsh", "echo $HOME | grep -v x", "```", "```TypeScript", "const n: number = 1", "```", "```cobol", "DISPLAY 'HELLO'.", "```", "```", "x".repeat(400), "```"].join("\n");
  const map = await openCard(p, [{ id: "al-diff" }, { id: "code-sample", body }], "code-sample");
  await expect(p.locator(".codebox")).toHaveCount(4);
  map.stop();
});

test("15.4", async ({ page: p }) => {
  const map = await openCard(p, [{ id: "unsafe", body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" }], "unsafe");
  await expect(p.getByText("<script>window.__pwned = true</script>")).toBeVisible();
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  map.stop();
});

test("15.5", async ({ page: p }) => {
  const map = await openMap(
    [{ id: "al-diff" }, { id: "old-idea" }, { id: "tile-card", summary: "Depends on #al-diff" }],
    [{ actor: "you", type: "node.removed", payload: { id: "old-idea" } }],
  );
  await p.goto(map.url);
  await expect(p.getByRole("textbox")).toBeVisible();
  map.stop();
});
