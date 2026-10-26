// Held-out steps 15.1 to 15.5. Each test starts werk the way a person does and opens the map.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "../..");
const CLI = join(ROOT, "src/cli.ts");
const PORT = 47311;
let server: ChildProcess | undefined;
let project = "";

function werk(...args: string[]) {
  return spawnSync("bun", [CLI, ...args], { cwd: project, encoding: "utf8", env: { ...process.env, PORT: String(PORT) } });
}

// Given: a card on the map. werk must offer a way to write a card.
function card(id: string, body: string, extra: string[] = []) {
  const r = werk("add", id, "--body", body, ...extra);
  expect(r.status, `werk add ${id}: ${r.stdout}${r.stderr}`).toBe(0);
}

async function startServer() {
  server = spawn("bun", [CLI, "serve", "--port", String(PORT)], { cwd: project, env: { ...process.env, PORT: String(PORT) } });
  let out = "";
  server.stdout?.on("data", (d) => (out += d));
  server.stderr?.on("data", (d) => (out += d));
  const exited = new Promise<number>((r) => server?.on("exit", (c) => r(c ?? -1)));
  const up = (async () => {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://localhost:${PORT}/`); return -999; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    return -998;
  })();
  const code = await Promise.race([exited, up]);
  expect(code, `werk serve did not start: ${out}`).toBe(-999);
}

test.beforeEach(() => { project = mkdtempSync(join(tmpdir(), "werk-heldout-")); });
test.afterEach(() => { server?.kill(); server = undefined; });

test("15.1", async ({ page }) => {
  card("al-diff", "a"); card("align", "b");
  card("notes-test", "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.");
  await startServer();
  await page.goto(`http://localhost:${PORT}/map/notes-test`);
  const body = page.locator("main");
  await expect(body.getByRole("link", { name: "#al-diff", exact: true })).toHaveCount(4);
  await expect(body.getByRole("link", { name: "#align", exact: true })).toHaveCount(1);
  await body.getByRole("link", { name: "#al-diff", exact: true }).nth(1).click();
  await expect(page).toHaveURL(/\/map\/al-diff$/);
});

test("15.2", async ({ page }) => {
  card("al-diff", "a");
  card("guards", "--al-diff\n\n##al-diff\n\n&al-diff\n\na code span holding `node src/cli.ts show #al-diff`\n\nsee #no-such-card\n\nvisit https://example.com/page#al-diff\n\n# al-diff\n\n#al-diff");
  await startServer();
  await page.goto(`http://localhost:${PORT}/map/guards`);
  await expect(page.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("15.3", async ({ page }) => {
  card("code-sample", "```zsh\necho $HOME | grep -v x\n```\n\n```TypeScript\nconst n: number = 1\n```\n\n```cobol\nDISPLAY 'HELLO'.\n```\n\n```\n" + "x".repeat(400) + "\n```");
  await startServer();
  await page.goto(`http://localhost:${PORT}/map/code-sample`);
  await expect(page.locator("pre")).toHaveCount(4);
});

test("15.4", async ({ page }) => {
  card("unsafe", "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~");
  await startServer();
  await page.goto(`http://localhost:${PORT}/map/unsafe`);
  await expect(page.getByText("<script>window.__pwned = true</script>")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(page.locator("strong", { hasText: "bold" })).toBeVisible();
  await expect(page.locator("del", { hasText: "gone" })).toBeVisible();
});

test("15.5", async ({ page }) => {
  card("al-diff", "a"); card("old-idea", "b");
  expect(werk("remove", "old-idea").status).toBe(0);
  card("tile-card", "c", ["--summary", "Depends on #al-diff"]);
  await startServer();
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole("textbox").fill("Compare #al-diff with #old-idea and show code");
  await page.keyboard.press("Enter");
  await expect(page.locator('a[href="/map/al-diff"]').first()).toBeVisible();
});
