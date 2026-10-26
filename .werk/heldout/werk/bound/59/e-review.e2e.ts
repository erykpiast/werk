// Held-out steps 18.1 - 18.5: the ✓ and the ✕ on the card page.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { cleanEnv } from "../src/test/clean-env.ts";

test.afterEach(stop);

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}

const logOf = (w: Werk) => join(w.dir, ".werk", "log.jsonl");
const events = (w: Werk) =>
  readFileSync(logOf(w), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; actor: string; payload: Record<string, unknown> });

const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const style = (p: Page, sel: string, prop: string) => rgbOf(p.locator(sel).first(), prop);
const rgbOf = (loc: import("@playwright/test").Locator, prop: string) =>
  loc.evaluate((el, name) => {
      const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = getComputedStyle(el).getPropertyValue(name);
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a === 0 ? "rgba(0, 0, 0, 0)" : `rgb(${r}, ${g}, ${b})`;
    }, prop);

test("18.1 the ✓ on a proposed card makes it real without a reload", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  const before = readFileSync(logOf(w), "utf8");

  await p.goto(`${w.url}/map/use-sqlite`);
  const box = 'article[data-card="use-sqlite"]';
  await expect(p.locator('[data-tag="proposed"]')).toHaveText("proposed");
  const border = await style(p, box, "border-top-color");
  const bg = await style(p, box, "background-color");
  // A blue colour has its blue channel highest.
  const blue = (c: string, min = 40) => {
    const [r, g, b] = (c.match(/[\d.]+/g) ?? []).map(Number);
    return (b ?? 0) - (r ?? 0) > min && (b ?? 0) >= (g ?? 0);
  };
  expect(blue(border)).toBe(true);
  expect(blue(bg, 10)).toBe(true);
  const actions = p.locator(`${box} [data-role="actions"]`);
  await expect(actions.getByRole("button", { name: "Accept" })).toHaveText(/✓/);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  await flagPage(p);
  await actions.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator(box)).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(blue(await style(p, box, "border-top-color"))).toBe(false);
  expect(await stillSamePage(p)).toBe(true);
  const last = events(w).at(-1);
  expect(last).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "use-sqlite" } });

  // The same accept from the command line, on a copy of the log before the click.
  const other = mkdtempSync(join(tmpdir(), "werk-heldout-"));
  try {
    mkdirSync(join(other, ".werk"));
    writeFileSync(join(other, ".werk", "log.jsonl"), before);
    const env = cleanEnv(process.env, FAKE_BIN);
    const cli = (dir: string, ...args: string[]) =>
      spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
    expect(cli(other, "accept", "use-sqlite", "--actor", "you").status).toBe(0);
    const theirs = readFileSync(join(other, ".werk", "log.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean);
    const cliLast = JSON.parse(theirs.at(-1) ?? "{}");
    expect({ type: cliLast.type, actor: cliLast.actor, payload: cliLast.payload }).toEqual({
      type: last?.type,
      actor: last?.actor,
      payload: last?.payload,
    });
    expect(cli(other, "show", "use-sqlite").stdout).toBe(cli(w.dir, "show", "use-sqlite").stdout);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test("18.2 a pending edit shows as a diff and the ✓ amends the card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    // A decided card that keeps its contract: a decided basis and a kill criterion.
    down.seed("node.decided", { id: "root" });
    card(down, "cache", { title: "Cache layer", why: "Reads are slow", body: "Entries expire after five minutes." });
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
  const box = 'article[data-card="cache"]';
  await expect(p.locator(box)).toHaveAttribute("data-pending", "true");
  const border = await style(p, box, "border-top-color");
  const bg = await style(p, box, "background-color");
  const [r, g, b] = (border.match(/[\d.]+/g) ?? []).map(Number);
  expect((b ?? 0) - (r ?? 0)).toBeGreaterThan(40);
  expect(g).toBeDefined();
  const [br, , bb] = (bg.match(/[\d.]+/g) ?? []).map(Number);
  expect(bb === br || bg === "rgba(0, 0, 0, 0)").toBe(true);
  await expect(p.locator(`${box} [data-tag="proposed"]`)).toHaveCount(0);
  await expect.soft(p.locator(box).getByText("proposed", { exact: true })).toHaveCount(0);

  const body = p.locator('[data-field="body"]');
  await expect(body.locator('ins[data-diff="added"]')).toHaveText("ten");
  await expect(body.locator('del[data-diff="removed"]')).toHaveText("five");
  const del = body.locator("del").first();
  expect(await del.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  for (const mark of [del, body.locator("ins").first()]) {
    const c = await rgbOf(mark, "background-color");
    const [mr, , mb] = (c.match(/[\d.]+/g) ?? []).map(Number);
    expect((mb ?? 0) > (mr ?? 0)).toBe(true);
  }
  await expect(p.locator(`${box} [data-diff]`)).toHaveCount(2);

  await flagPage(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("[data-diff]")).toHaveCount(0);
  await expect(body).toHaveText("Entries expire after ten minutes.");
  expect(await stillSamePage(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const w = await project(undefined, (down) =>
    card(down, "plan", { title: "The plan", body: `We do it in one pass.\n\n${items}` }),
  );
  const longer = items.replace("- item 5", "- item 5\n- a new item");
  w.werk(
    "propose",
    "plan",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "We do it in one pass.", new: "- first pass\n- second pass" },
      { tag: "elaborated", old: items, new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/plan`);
  const body = p.locator('[data-field="body"]');
  const newItem = body.locator("li", { hasText: "a new item" });
  await expect(newItem.locator("[data-diff='added']")).toHaveCount(1);
  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li").filter({ hasText: new RegExp(`^item ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("[data-diff]")).toHaveCount(0);
  }
  const removed = body.locator('[data-diff="removed"]', { hasText: "We do it in one pass." });
  await expect(removed).toHaveCount(1);
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  expect(await removed.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  const added = body.locator('[data-diff="added"]', { hasText: "first pass" });
  await expect(added).toHaveCount(1);
  await expect(added.locator("li")).toHaveCount(2);
  expect(await added.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("18.4 the ✕ on a card with two children offers subtree or reparent", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "server", { title: "Server" });
    card(down, "auth", { title: "Auth", parent: "server" });
    card(down, "tokens", { title: "Tokens", parent: "auth" });
    card(down, "sessions", { title: "Sessions", parent: "auth" });
  });
  const showBefore = w.werk("show", "auth");
  await p.goto(`${w.url}/map/auth`);
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("button")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards leave/ })).toBeVisible();
  const reparent = dialog.getByRole("button", { name: /Remove only #auth: 1 card leaves.*Server/ });
  await expect(reparent).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const count = events(w).length;

  await flagPage(p);
  await reparent.click();
  await expect(p).toHaveURL(/\/map\/server$/);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await stillSamePage(p)).toBe(true);
  expect(events(w).length).toBe(count + 1);
  expect(events(w).at(-1)).toMatchObject({ type: "node.removed", payload: { id: "auth", reparent: true } });

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  expect(w.werk("show", "auth")).toBe(showBefore);
});

/** One request with any headers. */
function send(url: string, path: string, body: string) {
  const { port } = new URL(url);
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { host: `localhost:${port}`, "content-type": "application/json" },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("18.5 a proposed removal shows red, cancel changes nothing, a write without token is refused", async ({
  page: p,
}) => {
  const w = await project(undefined, (down) => {
    card(down, "legacy", { title: "Legacy importer" });
    card(down, "old-notes", { title: "Old notes" });
  });
  // "An agent has proposed to remove": the command line has no such verb; try the forms an agent would reach for.
  const help = w.werk("help");
  const canPropose = /propose[^\n]*remov|remove[^\n]*propos/i.test(help);

  await p.goto(`${w.url}/map/old-notes`);
  const before = readFileSync(logOf(w), "utf8");
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(readFileSync(logOf(w), "utf8")).toBe(before);

  const status = await send(w.url, "/api/remove", JSON.stringify({ id: "old-notes" }));
  expect(status).toBe(403);
  expect(readFileSync(logOf(w), "utf8")).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");

  expect(canPropose, "no way for an agent to propose a removal").toBe(true);
  await p.goto(`${w.url}/map/root`);
  const tile = p.locator('a[data-tile="legacy"]');
  const colour = await rgbOf(tile, "border-top-color");
  const [r, g] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  expect((r ?? 0) > (g ?? 0) * 2).toBe(true);
});
