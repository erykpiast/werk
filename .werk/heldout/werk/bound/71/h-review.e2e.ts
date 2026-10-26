// Held-out tests for the review steps 18.1 to 18.5.
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}

type Event = { seq: number; actor: string; type: string; payload: Record<string, unknown> };
const events = (w: Werk): Event[] =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event);
const logText = (w: Werk) => readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");

const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

/** The colour of an element as [r, g, b, a], through a canvas so oklch() also converts. */
async function rgb(l: Locator, prop: "backgroundColor" | "borderTopColor" | "borderRightColor"): Promise<number[]> {
  return l.evaluate((el, name) => {
    const colour = getComputedStyle(el)[name as "color"];
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, prop);
}
/**
 * Blue: the blue channel is the largest by a clear margin, and the colour is not transparent. A pale
 * blue fill such as blue-50 is only about 16 above red, while the grey border gray-300 is 11 above, so
 * a border needs a larger margin than a fill.
 */
const isBlue = ([r = 0, g = 0, b = 0, a = 0]: number[], margin = 13) => a > 0 && b > r + margin && b > g + 5;
const isBlueBorder = (c: number[]) => isBlue(c, 40);
const isRed = ([r = 0, g = 0, b = 0, a = 0]: number[]) => a > 0 && r > g + 10 && r > b + 10;

test("18.1", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "storage", { title: "Storage" }));
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  w.werk("add", "pg", "--title", "Use Postgres", "--parent", "storage");

  await p.goto(`${w.url}/map/storage`);
  const tile = p.locator('[data-tile="sqlite"]');
  await expect(tile).toBeVisible();
  expect(isBlueBorder(await rgb(tile, "borderRightColor"))).toBe(true);
  expect(isBlue(await rgb(tile, "backgroundColor"))).toBe(true);
  await expect(tile.locator('[data-tag="proposed"]')).toHaveText("proposed");

  await tile.click();
  await expect(p).toHaveURL(/\/map\/sqlite$/);
  const hero = p.locator("article");
  expect(isBlueBorder(await rgb(hero, "borderRightColor"))).toBe(true);
  expect(isBlue(await rgb(hero, "backgroundColor"))).toBe(true);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText("proposed");
  const actions = hero.locator('[data-role="actions"]');
  await expect(actions.locator('button[data-action="accept"]')).toContainText("✓");
  const ab = await actions.boundingBox();
  const hb = await hero.boundingBox();
  expect((ab?.x ?? 0) + (ab?.width ?? 0)).toBeGreaterThan((hb?.x ?? 0) + (hb?.width ?? 0) - 40);
  expect((ab?.y ?? 0) - (hb?.y ?? 0)).toBeLessThan(40);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await expect(p.locator('[data-action="discard"]')).toHaveCount(0);

  const before = events(w).length;
  await flagPage(p);
  await actions.locator('button[data-action="accept"]').click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  expect(await stillSamePage(p)).toBe(true);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(isBlueBorder(await rgb(hero, "borderRightColor"))).toBe(false);
  const added = events(w).slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.actor === "you")).toBe(true);
  expect(added.some((e) => e.type === "change.accepted" && e.payload.id === "sqlite")).toBe(true);

  // The same accept from the command line, on a twin ghost.
  const mid = events(w).length;
  w.werk("accept", "pg", "--actor", "you");
  const cli = events(w).slice(mid);
  const shape = (list: Event[], id: string) =>
    list.map((e) => ({ actor: e.actor, type: e.type, payload: JSON.stringify(e.payload).replaceAll(id, "ID") }));
  expect(shape(added, "sqlite")).toEqual(shape(cli, "pg"));
  const read = async (id: string) =>
    (await (await p.request.get(`${w.url}/api/card/${id}`)).json()) as { card: Record<string, unknown> };
  const a = (await read("sqlite")).card;
  const b = (await read("pg")).card;
  expect({ proposed: a.proposed, status: a.status }).toEqual({ proposed: b.proposed, status: b.status });
  expect(a.proposed).toBe(false);
});

/** A decided card that may take an amend: a decided root and a kill criterion. */
function decided(down: Pick<Werk, "seed">, id: string, fields: Record<string, unknown>): void {
  down.seed("node.decided", { id: "root" });
  card(down, id, fields);
  down.seed("kill.added", { id, criterion: { form: "revisit" } });
}

test("18.2", async ({ page: p }) => {
  const w = await project(undefined, (down) =>
    decided(down, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." }),
  );
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
  await expect(hero).toHaveAttribute("data-pending", "true");
  expect(isBlueBorder(await rgb(hero, "borderRightColor"))).toBe(true);
  expect(isBlue(await rgb(hero, "backgroundColor"))).toBe(false);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero.getByText("proposed", { exact: true })).toHaveCount(0);

  const added = hero.locator('ins[data-diff="added"]');
  const removed = hero.locator('del[data-diff="removed"]');
  await expect(added).toHaveText("ten");
  await expect(removed).toHaveText("five");
  expect(isBlue(await rgb(added, "backgroundColor"))).toBe(true);
  expect(isBlue(await rgb(removed, "backgroundColor"))).toBe(true);
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);

  await flagPage(p);
  await hero.locator('button[data-action="accept"]').click();
  await expect(hero.locator("[data-diff]")).toHaveCount(0);
  expect(await stillSamePage(p)).toBe(true);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  await expect(hero.locator("ins, del")).toHaveCount(0);
});

test("18.3", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const para = "Plain words about red and blue.";
  const w = await project(undefined, (down) =>
    decided(down, "list", { title: "A long list", why: "Lists grow.", body: `${items}\n\n${para}` }),
  );
  const longer = items.replace("- item 5", "- item 5\n- a fresh item");
  w.werk(
    "propose",
    "list",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: items, new: longer },
      { tag: "elaborated", old: para, new: "- red\n- blue" },
    ]),
  );
  await p.goto(`${w.url}/map/list`);
  const body = p.locator('article [data-field="body"]');
  await expect(body).toBeVisible();

  const fresh = body.locator("li", { hasText: "a fresh item" });
  await expect(fresh).toHaveCount(1);
  const freshMark = fresh.locator('[data-diff="added"]');
  await expect(freshMark).toHaveCount(1);
  expect(isBlue(await rgb(freshMark, "backgroundColor"))).toBe(true);

  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li", { hasText: new RegExp(`^item ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("[data-diff]")).toHaveCount(0);
    expect(await old.evaluate((el) => el.closest("[data-diff]") === null)).toBe(true);
  }

  const gone = body.locator('[data-diff="removed"]', { hasText: para });
  await expect(gone).toHaveCount(1);
  expect(isBlue(await rgb(gone, "backgroundColor"))).toBe(true);
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");

  const newList = body.locator('[data-diff="added"]').filter({ has: p.locator("li", { hasText: "red" }) });
  await expect(newList).toHaveCount(1);
  await expect(newList.locator("li")).toHaveText(["red", "blue"]);
  expect(isBlue(await rgb(newList, "backgroundColor"))).toBe(true);
});

test("18.4", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "server", { title: "Server" });
    card(down, "auth", { title: "Auth", parent: "server" });
    card(down, "tokens", { title: "Tokens", parent: "auth" });
    card(down, "sessions", { title: "Sessions", parent: "auth" });
  });
  const authBefore = ((await (await p.request.get(`${w.url}/api/card/auth`)).json()) as { html: string }).html;
  await p.goto(`${w.url}/map/server`);
  const serverTilesBefore = await p.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.outerHTML));
  await p.locator('[data-tile="auth"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Auth");
  const before = events(w).length;

  await p.locator('article button[data-action="remove"]').click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  const answers = dialog.getByRole("button");
  await expect(answers).toHaveCount(3);
  await expect(answers.nth(0)).toContainText("subtree");
  await expect(answers.nth(0)).toContainText("3 cards leave");
  await expect(answers.nth(1)).toContainText("#auth");
  await expect(answers.nth(1)).toContainText("Server");
  await expect(answers.nth(1)).toContainText("1 card leaves");
  await expect(answers.nth(2)).toHaveText("Cancel");

  await flagPage(p);
  await answers.nth(1).click();
  await expect(dialog).toHaveCount(0);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Server");
  expect(await stillSamePage(p)).toBe(true);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  const added = events(w).slice(before);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toBe("node.removed");
  expect(added[0]?.payload.id).toBe("auth");

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  const serverTilesAfter = await p.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.outerHTML));
  expect(serverTilesAfter).toEqual(serverTilesBefore);
  const authAfter = ((await (await p.request.get(`${w.url}/api/card/auth`)).json()) as { html: string }).html;
  expect(authAfter).toBe(authBefore);
});

function post(url: string, path: string, body: string) {
  const { port } = new URL(url);
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { host: `localhost:${port}`, "content-type": "application/json", origin: "http://evil.example" },
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

test("18.5", async ({ page: p, context }) => {
  const w = await project(undefined, (down) => {
    card(down, "legacy", { title: "Legacy importer" });
    card(down, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");

  await p.goto(`${w.url}/map/root`);
  const tile = p.locator('[data-tile="legacy"]');
  expect(isRed(await rgb(tile, "borderRightColor"))).toBe(true);
  expect(isRed(await rgb(tile, "backgroundColor"))).toBe(true);
  await tile.click();
  const hero = p.locator("article");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Legacy importer");
  expect(isRed(await rgb(hero, "borderRightColor"))).toBe(true);
  expect(isRed(await rgb(hero, "backgroundColor"))).toBe(true);

  await p.goto(`${w.url}/map/notes`);
  const before = logText(w);
  await p.locator('article button[data-action="remove"]').click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(logText(w)).toBe(before);
  await p.goto(`${w.url}/map/root`);
  await expect(p.locator('[data-tile="notes"]')).toBeVisible();

  await flagPage(p);
  const tilesBefore = await p.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.outerHTML));
  // Another page: a second tab on a different origin posts to the server with no token.
  const other = await context.newPage();
  await other.goto("about:blank");
  const fromOther = await other.evaluate(async (url) => {
    try {
      const r = await fetch(`${url}/api/remove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "notes" }),
      });
      return r.status;
    } catch {
      return -1;
    }
  }, w.url);
  expect(fromOther === -1 || fromOther === 403).toBe(true);
  expect(await post(w.url, "/api/remove", JSON.stringify({ id: "notes" }))).toBe(403);
  expect(logText(w)).toBe(before);
  expect(await stillSamePage(p)).toBe(true);
  await expect(p.locator('[data-tile="notes"]')).toBeVisible();
  const tilesAfter = await p.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.outerHTML));
  expect(tilesAfter).toEqual(tilesBefore);
});
