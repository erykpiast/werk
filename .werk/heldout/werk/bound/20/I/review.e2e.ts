// Held-out steps 18.1-18.5 and 70.1-70.5: the person reviews proposals in the browser.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";
import { cleanEnv } from "../../src/test/clean-env.ts";

test.afterEach(stop);

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../../src/test/fake-bin", import.meta.url));

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}

const logOf = (w: Werk) => readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");
const events = (w: Werk) =>
  logOf(w)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; actor: string; payload: Record<string, unknown> });

const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

const style = (l: Locator, prop: string) => l.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop);

/** Whether a CSS colour is blue: oklch hue near 250 with real chroma, or an rgb with blue on top. */
function isBlue(colour: string): boolean {
  const ok = /oklch\(([\d.]+)%? ([\d.]+) ([\d.]+)/.exec(colour);
  if (ok) return Number(ok[2]) > 0.012 && Number(ok[3]) > 200 && Number(ok[3]) < 290;
  const rgb = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(colour);
  if (!rgb) return false;
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return false;
  const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return b > r + 8 && b >= g;
}
function isRed(colour: string): boolean {
  const ok = /oklch\(([\d.]+)%? ([\d.]+) ([\d.]+)/.exec(colour);
  if (ok) return Number(ok[2]) > 0.012 && (Number(ok[3]) < 40 || Number(ok[3]) > 340);
  const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(colour);
  if (!rgb) return false;
  return Number(rgb[1]) > Number(rgb[2]) + 8 && Number(rgb[1]) > Number(rgb[3]) + 8;
}
function isGrey(colour: string): boolean {
  const ok = /oklch\(([\d.]+)%? ([\d.]+)/.exec(colour);
  if (ok) return Number(ok[2]) < 0.012;
  const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(colour);
  if (!rgb) return false;
  const v = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return Math.max(...v) - Math.min(...v) < 12;
}

/** Runs a werk command on a copy of the project's folder and gives back the folder. */
function inCopy(w: Werk, ...args: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-copy-"));
  cpSync(w.dir, root, { recursive: true });
  const run = spawnSync("bun", [CLI, ...args], { cwd: root, env: cleanEnv(process.env, FAKE_BIN), encoding: "utf8" });
  if (run.status !== 0) throw new Error(`copy: werk ${args.join(" ")}: ${run.stderr}`);
  return root;
}
function showIn(dir: string, id: string): string {
  return spawnSync("bun", [CLI, "show", id], { cwd: dir, env: cleanEnv(process.env, FAKE_BIN), encoding: "utf8" })
    .stdout;
}

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

// 18.1
test("18.1 accepting a proposed new card with the check mark makes it real without a reload", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/use-sqlite`);
  const art = p.locator('article[data-card="use-sqlite"]');
  expect(isBlue(await style(art, "border-top-color"))).toBe(true);
  expect(isBlue(await style(art, "background-color"))).toBe(true);
  await expect(art.locator('[data-tag="proposed"]')).toHaveText(/proposed/i);
  const actions = art.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: "Accept" })).toHaveText(/✓/);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  const copy = inCopy(w, "accept", "use-sqlite", "--actor", "you");
  await flagPage(p);
  await actions.getByRole("button", { name: "Accept" }).click();
  await expect(art).toHaveAttribute("data-proposed", "false");
  expect(await stillSamePage(p)).toBe(true);
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(isBlue(await style(art, "border-top-color"))).toBe(false);
  const accept = events(w).filter((e) => e.type === "change.accepted" && e.payload.id === "use-sqlite");
  expect(accept).toHaveLength(1);
  expect(accept[0]?.actor).toBe("you");
  expect(showIn(w.dir, "use-sqlite")).toBe(showIn(copy, "use-sqlite"));
  rmSync(copy, { recursive: true, force: true });
});

// 18.2
test("18.2 a pending edit to a decided card shows as a diff and an accept amends the card", async ({ page: p }) => {
  // A decided card that holds every fact the contract check needs, so an amend can go through.
  const w = await project(undefined, (d) => {
    card(d, "cache", { title: "Cache layer", why: "Reads are slow.", body: "Entries expire after five minutes." });
    d.werk("edit", "cache", "--no-basis", "Nothing decided sits under the cache.");
    d.werk("edit", "cache", "--unchallenged", "Only one layout was considered.");
    d.werk("kill", "cache", "--revisit");
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
  const art = p.locator('article[data-card="cache"]');
  expect(isBlue(await style(art, "border-top-color"))).toBe(true);
  expect(isBlue(await style(art, "background-color"))).toBe(false);
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  const ins = art.locator("ins[data-diff]");
  const del = art.locator("del[data-diff]");
  await expect(ins).toHaveText(["ten"]);
  await expect(del).toHaveText(["five"]);
  expect(isBlue(await style(ins.first(), "background-color"))).toBe(true);
  expect(isBlue(await style(del.first(), "background-color"))).toBe(true);
  expect(await style(del.first(), "text-decoration-line")).toContain("line-through");
  await expect(art.locator("[data-diff]")).toHaveCount(2);

  await flagPage(p);
  await art.getByRole("button", { name: "Accept" }).click();
  await expect(art.locator("[data-diff]")).toHaveCount(0);
  expect(await stillSamePage(p)).toBe(true);
  await expect(art.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
});

// 18.3
test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item number ${i + 1}`).join("\n");
  const para = "Old paragraph text here.";
  const w = await project(undefined, (d) => card(d, "listy", { title: "Listy", body: `${para}\n\n${items}` }));
  const longer = items.replace("- item number 5", "- item number 5\n- a brand new item");
  w.werk(
    "propose",
    "listy",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: para, new: "- first list entry\n- second list entry" },
      { tag: "elaborated", old: items, new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/listy`);
  const body = p.locator('article[data-card="listy"] [data-field="body"]');
  const newItem = body.locator("li", { hasText: "a brand new item" });
  await expect(
    newItem.locator('[data-diff="added"]').or(newItem.locator("xpath=ancestor::*[@data-diff='added']")),
  ).not.toHaveCount(0);
  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li", { hasText: new RegExp(`^item number ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("[data-diff]")).toHaveCount(0);
    expect(await old.evaluate((el) => el.closest("[data-diff]") === null)).toBe(true);
  }
  const removed = body.locator('[data-diff="removed"]', { hasText: "Old paragraph text here." });
  await expect(removed).toHaveCount(1);
  expect(await style(removed, "text-decoration-line")).toContain("line-through");
  expect(isBlue(await style(removed, "background-color"))).toBe(true);
  const added = body.locator('[data-diff="added"]', { hasText: "first list entry" });
  await expect(added).toHaveCount(1);
  await expect(added.locator("li")).toHaveCount(2);
  expect(isBlue(await style(added, "background-color"))).toBe(true);
});

// 18.4
test("18.4 removing a card with two children offers subtree removal or reparent, each with its count", async ({
  page: p,
}) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server" });
    card(d, "auth", { title: "Auth", parent: "server" });
    card(d, "tokens", { title: "Tokens", parent: "auth" });
    card(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  const before = events(w).length;
  await p.locator('article[data-card="auth"]').getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  const answers = dialog.getByRole("button");
  await expect(answers).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards/ })).toBeVisible();
  const reparent = dialog.getByRole("button", { name: /#auth.*1 card.*Server/ });
  await expect(reparent).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();

  await flagPage(p);
  await reparent.click();
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p).toHaveURL(/\/map\/server$/);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await stillSamePage(p)).toBe(true);
  const after = events(w);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)?.type).toBe("node.removed");

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="sessions"]')).toHaveCount(0);
  await p.locator('[data-tile="auth"]').click();
  await expect(p.locator('article[data-card="auth"] h1')).toHaveText("Auth");
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
});

// 18.5
test("18.5 a proposed removal shows in red, cancel changes nothing, a write without the token is refused", async ({
  page: p,
  context,
}) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "old-notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map/root`);
  const tile = p.locator('[data-tile="legacy"]');
  expect(isRed(await style(tile, "border-top-color")) || isRed(await style(tile, "background-color"))).toBe(true);
  await p.goto(`${w.url}/map/legacy`);
  const art = p.locator('article[data-card="legacy"]');
  expect(isRed(await style(art, "border-top-color"))).toBe(true);
  expect(isRed(await style(art, "background-color"))).toBe(true);

  await p.goto(`${w.url}/map/old-notes`);
  const before = logOf(w);
  await p.locator('article[data-card="old-notes"]').getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.locator('article[data-card="old-notes"] h1')).toHaveText("Old notes");
  expect(logOf(w)).toBe(before);

  await flagPage(p);
  const other = await context.newPage();
  await other.goto("about:blank");
  await other.evaluate(async (url) => {
    try {
      await fetch(`${url}/api/remove`, { method: "POST", mode: "no-cors", body: JSON.stringify({ id: "old-notes" }) });
    } catch {}
  }, w.url);
  expect(await send(w.url, "/api/remove", JSON.stringify({ id: "old-notes" }))).toBe(403);
  expect(logOf(w)).toBe(before);
  await expect(p.locator('article[data-card="old-notes"] h1')).toHaveText("Old notes");
  expect(await stillSamePage(p)).toBe(true);
});

function payments(d: Pick<Werk, "seed">) {
  card(d, "payments", { title: "Payments" });
}

// 70.1
test("70.1 a proposed card shows as a ghost under its proposed parent", async ({ page: p }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const tile = p.locator('[data-section="subcards"] [data-tile="refunds"]');
  await expect(tile).toBeVisible();
  expect(await style(tile, "border-top-style")).toBe("dashed");
  const border = await style(tile, "border-top-color");
  const fill = await style(tile, "background-color");
  expect({ border, fill, greyBorder: isGrey(border) }).toMatchObject({ greyBorder: true });
  const art = p.locator('article[data-card="payments"]');
  expect(await style(art, "border-top-style")).not.toBe("dashed");
  expect(await art.getAttribute("data-proposed")).toBe("false");
});

// 70.2
test("70.2 the person accepts one ghost with the ✓ button and it becomes real", async ({ page: p }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  await p.getByRole("button", { name: "Accept" }).click();
  const art = p.locator('article[data-card="refunds"]');
  await expect(art).toHaveAttribute("data-proposed", "false");
  const accepts = events(w).filter((e) => e.type === "change.accepted" && e.payload.id === "refunds");
  expect(accepts).toHaveLength(1);
  expect(accepts[0]?.actor).toBe("you");
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await p.goto(`${w.url}/map/payments`);
  const tile = p.locator('[data-tile="refunds"]');
  await expect(tile).toHaveAttribute("data-proposed", "false");
  expect(await style(tile, "border-top-style")).not.toBe("dashed");
});

// 70.3
test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial-refunds`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('article[data-card="partial-refunds"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tile="partial-refunds"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

// 70.4
test("70.4 an accept takes only the accepted card's branch, not other ghosts", async ({ page: p }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Store credit only", "--why_not", "Users want cash");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "src-psp", "--kind", "source", "--title", "PSP docs", "--finding", "Refunds take 5 days");
  w.werk("link", "refunds", "src-psp", "--type", "supported_by");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.getByRole("button", { name: /all|together|both/i })).toHaveCount(0);
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.getByRole("button", { name: /all|together|both/i })).toHaveCount(0);
  await p.locator('article[data-card="refunds"]').getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds:opt0`);
  await expect(p.locator("article").first()).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/src-psp`);
  await expect(p.locator("article").first()).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  const tile = p.locator('[data-tile="chargebacks"]');
  await expect(tile).toHaveAttribute("data-proposed", "true");
  expect(await style(tile, "border-top-style")).toBe("dashed");
  expect(isGrey(await style(tile, "border-top-color"))).toBe(true);
});

// 70.5
test("70.5 a second view sees the accept because it reads the same log", async ({ page: p, context }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const second = await context.newPage();
  await p.goto(`${w.url}/map/refunds`);
  await second.goto(`${w.url}/map/payments`);
  await expect(second.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "true");
  await flagPage(second);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(second.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
  expect(await stillSamePage(second)).toBe(true);
});
