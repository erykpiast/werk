// Held-out steps 18.1–18.5: the review controls in the browser.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";
import { cleanEnv } from "../../src/test/clean-env.ts";

test.afterEach(stop);

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../../src/test/fake-bin", import.meta.url));
const NONE = "rgba(0, 0, 0, 0)";

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}
const logOf = (w: Werk) => join(w.dir, ".werk", "log.jsonl");
const events = (w: Werk) =>
  readFileSync(logOf(w), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } });
const flag = (p: Page) => p.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
const kept = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const style = (p: Page, sel: string) =>
  p.locator(sel).evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, bg: s.backgroundColor };
  });

test("18.1", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/use-sqlite`);
  const hero = p.locator("article");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText("proposed");
  const look = await style(p, "article");
  expect(look.border).toMatch(/rgb\(\d+, \d+, 2\d\d\)|oklch/);
  expect(look.bg).not.toBe("rgb(255, 255, 255)");
  expect(look.bg).not.toBe(NONE);
  await expect(hero).toHaveClass(/border-blue-400/);
  await expect(hero).toHaveClass(/bg-blue-50/);
  const actions = hero.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: "Accept" })).toHaveText(/✓/);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  // The same log, accepted from the command line, for the comparison.
  const other = mkdtempSync(join(tmpdir(), "werk-heldout-18-"));
  mkdirSync(join(other, ".werk"));
  copyFileSync(logOf(w), join(other, ".werk", "log.jsonl"));
  const env = cleanEnv(process.env, FAKE_BIN);
  const cli = (...args: string[]) => spawnSync("bun", [CLI, ...args], { cwd: other, env, encoding: "utf8" });
  const before = events(w).length;

  await flag(p);
  await actions.getByRole("button", { name: "Accept" }).click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero).not.toHaveClass(/border-blue-400/);
  expect(await kept(p)).toBe(true);
  const added = events(w).slice(before);
  expect(added.some((e) => e.type === "change.accepted" && e.payload.id === "use-sqlite" && e.actor === "you")).toBe(
    true,
  );

  expect(cli("accept", "use-sqlite", "--actor", "you").status).toBe(0);
  const fromCli = readFileSync(join(other, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean).slice(before);
  expect(fromCli.map((l) => JSON.parse(l)).map((e) => [e.type, e.actor, e.payload])).toEqual(
    added.map((e) => [e.type, e.actor, e.payload]),
  );
  expect(cli("show", "use-sqlite").stdout).toBe(w.werk("show", "use-sqlite"));
  rmSync(other, { recursive: true, force: true });
});

test("18.2", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "cache", { title: "Cache layer", why: "Reads repeat often.", body: "Entries expire after five minutes." });
    d.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
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
  await expect(hero).toHaveClass(/border-blue-400/);
  await expect(hero).not.toHaveClass(/bg-blue-50/);
  const look = await style(p, "article");
  expect(look.bg).not.toMatch(/239, 246, 255/);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero.getByText("proposed", { exact: true })).toHaveCount(0);
  const ten = hero.getByText("ten", { exact: true });
  const five = hero.getByText("five", { exact: true });
  expect(await ten.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  expect(await five.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  expect(await five.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  for (const f of ["why", "body"]) {
    const marked = await hero.locator(`[data-field="${f}"] ins, [data-field="${f}"] del, [data-field="${f}"] [data-diff]`).allTextContents();
    expect(marked.filter((t) => t !== "ten" && t !== "five")).toEqual([]);
  }
  await expect(hero.locator("h1 ins, h1 del, h1 [data-diff]")).toHaveCount(0);
  await flag(p);
  await hero.getByRole("button", { name: "Accept" }).click();
  await expect(hero.locator("ins, del, [data-diff]")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await kept(p)).toBe(true);
});

test("18.3", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const para = "Old paragraph about the steps.";
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "steps", { title: "Steps", why: "Order matters.", body: `${para}\n\n${items}` });
    d.seed("kill.added", { id: "steps", criterion: { form: "revisit" } });
  });
  const longer = items.replace("- item 5", "- item 5\n- brand new item");
  w.werk(
    "propose",
    "steps",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: para, new: "- first point\n- second point" },
      { tag: "elaborated", old: items, new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/steps`);
  const body = p.locator('[data-field="body"]');
  const newItem = body.locator("li", { hasText: "brand new item" });
  await expect(newItem).toHaveCount(1);
  const newMark = newItem.locator("ins, [data-diff]").first();
  await expect(newMark).toBeVisible();
  expect(await newMark.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  for (let i = 1; i <= 10; i++) {
    const li = body.locator("li", { hasText: new RegExp(`^item ${i}$`) });
    await expect(li).toHaveCount(1);
    await expect(li.locator("ins, del, [data-diff]")).toHaveCount(0);
  }
  const old = body.getByText(para);
  await expect(old).toHaveCount(1);
  const oldStyle = await old.evaluate((el) => {
    const host = el.closest("del, [data-diff]") ?? el;
    const s = getComputedStyle(host);
    return { bg: s.backgroundColor, deco: s.textDecorationLine };
  });
  expect(oldStyle.bg).not.toBe(NONE);
  expect(oldStyle.deco).toContain("line-through");
  for (const t of ["first point", "second point"]) {
    const li = body.locator("li", { hasText: t });
    await expect(li).toHaveCount(1);
    const bg = await li.evaluate((el) => {
      const host = el.closest("ins, [data-diff]") ?? el.querySelector("ins, [data-diff]") ?? el;
      return getComputedStyle(host).backgroundColor;
    });
    expect(bg).not.toBe(NONE);
  }
});

test("18.4", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server" });
    card(d, "auth", { title: "Auth", parent: "server" });
    card(d, "tokens", { title: "Tokens", parent: "auth" });
    card(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  const before = await p.locator("#card").innerHTML();
  const n = events(w).length;
  await p.locator("article").getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  const answers = dialog.getByRole("button");
  await expect(answers).toHaveCount(3);
  const subtree = dialog.getByRole("button", { name: /subtree.*3 cards/ });
  await expect(subtree).toHaveCount(1);
  const reparent = dialog.getByRole("button", { name: /#auth.*1 card leaves.*server.*Server/ });
  await expect(reparent).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(1);
  await flag(p);
  await reparent.click();
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Server");
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  expect(await kept(p)).toBe(true);
  const added = events(w).slice(n);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toBe("node.removed");
  expect(added[0]?.payload.id).toBe("auth");

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/auth`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Auth");
  expect(await p.locator("#card").innerHTML()).toBe(before);
});

test("18.5", async ({ page: p, request }) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map/root`);
  const tile = p.locator('[data-tile="legacy"]');
  await expect(tile).toHaveAttribute("data-removal", "true");
  await expect(tile).toHaveClass(/border-red-400/);
  const probe = await p.evaluate(() => {
    const el = document.createElement("span");
    el.className = "border border-red-400 bg-red-50";
    document.body.append(el);
    const s = getComputedStyle(el);
    const out = { border: s.borderTopColor, bg: s.backgroundColor };
    el.remove();
    return out;
  });
  const look = await tile.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, bg: s.backgroundColor };
  });
  expect(look).toEqual(probe);

  const before = readFileSync(logOf(w), "utf8");
  await p.goto(`${w.url}/map/notes`);
  await p.locator("article").getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(readFileSync(logOf(w), "utf8")).toBe(before);

  await flag(p);
  const response = await request.post(`${w.url}/api/remove`, {
    headers: { "content-type": "application/json" },
    data: { id: "notes" },
  });
  expect(response.ok()).toBe(false);
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(readFileSync(logOf(w), "utf8")).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(await kept(p)).toBe(true);
});
