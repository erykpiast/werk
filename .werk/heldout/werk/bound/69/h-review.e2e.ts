// Held-out steps 18.1–18.5: the person reviews proposals in a real browser.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { cleanEnv } from "../src/test/clean-env.ts";

test.afterEach(stop);

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));
const NONE = "rgba(0, 0, 0, 0)";

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}
const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const events = (dir: string) =>
  readFileSync(join(dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { seq: number; type: string; actor: string; payload: Record<string, unknown> });

test("18.1 accepting a proposed new card with the check mark", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  const before = readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");

  await p.goto(`${w.url}/map/use-sqlite`);
  const hero = p.locator("article");
  const look = await hero.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, background: s.backgroundColor };
  });
  const blue = await p.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "border border-blue-400 bg-blue-50";
    document.body.append(probe);
    const s = getComputedStyle(probe);
    return { border: s.borderTopColor, background: s.backgroundColor };
  });
  expect(look.border).toBe(blue.border);
  expect(look.background).toBe(blue.background);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText(/proposed/i);
  const actions = hero.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Accept" })).toContainText("✓");
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  await flagPage(p);
  await actions.getByRole("button", { name: "Accept" }).click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  const after = await hero.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(after).not.toBe(blue.border);
  expect(await stillSamePage(p)).toBe(true);

  const uiAccepts = events(w.dir).filter((e) => e.seq > before.split("\n").filter(Boolean).length);
  expect(uiAccepts.length).toBeGreaterThan(0);
  expect(uiAccepts.every((e) => e.actor === "you")).toBe(true);
  expect(uiAccepts.some((e) => JSON.stringify(e.payload).includes("use-sqlite"))).toBe(true);

  // The same accept from the command line, on a copy of the log before the click.
  const twin = mkdtempSync(join(tmpdir(), "werk-heldout-twin-"));
  try {
    mkdirSync(join(twin, ".werk"));
    writeFileSync(join(twin, ".werk", "log.jsonl"), before);
    const run = spawnSync("bun", [CLI, "accept", "use-sqlite", "--actor", "you"], {
      cwd: twin,
      env: cleanEnv(process.env, FAKE_BIN),
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    const strip = (es: ReturnType<typeof events>) =>
      es.map(({ seq, type, actor, payload }) => ({ seq, type, actor, payload }));
    expect(strip(events(twin))).toEqual(strip(events(w.dir)));
  } finally {
    rmSync(twin, { recursive: true, force: true });
  }
});

test("18.2 a pending edit to a decided card shows as a diff and an accept amends the card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    card(down, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
    down.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  });
  w.werk(
    "propose",
    "cache",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." },
    ]),
  );
  await p.goto(`${w.url}/map/cache`);
  const hero = p.locator("article");
  const blue = await p.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "border border-blue-400";
    document.body.append(probe);
    return getComputedStyle(probe).borderTopColor;
  });
  const look = await hero.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, background: s.backgroundColor };
  });
  expect(look.border).toBe(blue);
  const ghostBg = await p.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "bg-blue-50";
    document.body.append(probe);
    return getComputedStyle(probe).backgroundColor;
  });
  expect(look.background).not.toBe(ghostBg);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero.getByText("proposed", { exact: true })).toHaveCount(0);

  const added = hero.locator('[data-diff="added"]');
  const removed = hero.locator('[data-diff="removed"]');
  await expect(added).toHaveText("ten");
  await expect(removed).toHaveText("five");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);
  for (const mark of [added, removed])
    expect(await mark.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  await expect(hero.locator('[data-field="title"] [data-diff], [data-field="why"] [data-diff]')).toHaveCount(0);

  await flagPage(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(hero.locator("[data-diff]")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await stillSamePage(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const para = "The steps run in order.";
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    card(down, "steps", { title: "Steps", body: `${para}\n\n${items}` });
    down.seed("kill.added", { id: "steps", criterion: { form: "revisit" } });
  });
  w.werk(
    "propose",
    "steps",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: para, new: "- first runs\n- second runs" },
      { tag: "elaborated", old: items, new: items.replace("- item 5", "- item 5\n- new item") },
    ]),
  );
  await p.goto(`${w.url}/map/steps`);
  const body = p.locator('article [data-field="body"]');
  const newItem = body.locator("li", { hasText: "new item" });
  await expect(newItem.locator("[data-diff]")).toHaveCount(1);
  expect(await newItem.locator("[data-diff]").evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li", { hasText: new RegExp(`^item ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("[data-diff]")).toHaveCount(0);
  }
  const gone = body.locator('[data-diff="removed"]', { hasText: para });
  await expect(gone).toHaveCount(1);
  expect(await gone.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  for (const text of ["first runs", "second runs"]) {
    const add = body.locator('[data-diff="added"]', { hasText: text });
    await expect(add).toHaveCount(1);
    expect(await add.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  }
});

test("18.4 removing a card with two children offers subtree removal or reparent", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "server", { title: "Server" });
    card(down, "auth", { title: "Auth", parent: "server" });
    card(down, "tokens", { title: "Tokens", parent: "auth" });
    card(down, "sessions", { title: "Sessions", parent: "auth" });
  });
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/auth`);
  const beforeHtml = await p.locator("article").innerHTML();
  const beforeLines = events(w.dir).length;
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("button")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards leave/ })).toBeVisible();
  const reparent = dialog.getByRole("button", { name: /Remove only #auth: 1 card leaves.*server Server/ });
  await expect(reparent).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();

  await flagPage(p);
  await reparent.click();
  await expect(dialog).toHaveCount(0);
  await p.waitForURL(/\/map\/(server|root)$/);
  expect(await stillSamePage(p)).toBe(true);
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  const added = events(w.dir).slice(beforeLines);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toContain("remov");
  expect(readFileSync(log, "utf8").length).toBeGreaterThan(0);

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/auth`);
  expect(await p.locator("article").innerHTML()).toBe(beforeHtml);
});

test("18.5 a proposed removal shows in red, cancel changes nothing, a write without the token is refused", async ({
  page: p,
}) => {
  const w = await project(undefined, (down) => {
    card(down, "legacy", { title: "Legacy importer" });
    card(down, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/legacy`);
  const red = await p.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "bg-red-50";
    document.body.append(probe);
    return getComputedStyle(probe).backgroundColor;
  });
  expect(await p.locator("article").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(red);

  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(log, "utf8");
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(readFileSync(log, "utf8")).toBe(before);

  await flagPage(p);
  const html = await p.locator("article").innerHTML();
  const other = await p.context().newPage();
  await other.goto("about:blank");
  const status = await other.evaluate(async (url) => {
    try {
      const response = await fetch(`${url}/api/remove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "notes" }),
      });
      return response.status;
    } catch {
      return -1;
    }
  }, w.url);
  expect(status === -1 || status >= 400).toBe(true);
  expect(readFileSync(log, "utf8")).toBe(before);
  await p.waitForTimeout(500);
  expect(await p.locator("article").innerHTML()).toBe(html);
  expect(await stillSamePage(p)).toBe(true);
});
