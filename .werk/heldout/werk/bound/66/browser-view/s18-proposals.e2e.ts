// Held-out steps 18.1–18.5: the ✓ and the ✕ in the map, the diff of a pending edit, and the token.
import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../../e2e/project.ts";
import { card, flagPage, heading, isBlue, isRed, logLines, stillSamePage, style } from "./helpers.ts";

test.afterEach(stop);

const article = (p: Page) => p.locator("article[data-card]");
const decided = { status: "decided", who: "me" };

test("18.1 accepting a proposed new card with the check mark", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage", ...decided }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/use-sqlite`);
  await expect(heading(p)).toHaveText("Use SQLite");
  // blue border, blue background, "proposed" badge
  expect(isBlue(await style(article(p), "border-top-color"))).toBe(true);
  expect(isBlue(await style(article(p), "background-color"), 0.012)).toBe(true);
  await expect(article(p).locator('[data-role="tags"]').getByText("proposed", { exact: true })).toBeVisible();
  // ✓ in the top-right actions, no discard button
  const actions = article(p).locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: /Accept/ })).toContainText("✓");
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  const before = logLines(w).length;
  await flagPage(p);
  await actions.getByRole("button", { name: /Accept/ }).click();
  await expect(article(p)).toHaveAttribute("data-proposed", "false");
  expect(await stillSamePage(p)).toBe(true);
  await expect(article(p).getByText("proposed", { exact: true })).toHaveCount(0);
  expect(isBlue(await style(article(p), "border-top-color"))).toBe(false);
  const lines = logLines(w);
  expect(lines.length).toBe(before + 1);
  const ev = JSON.parse(lines.at(-1) as string);
  expect(ev).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "use-sqlite" } });
  // the same as an accept from the command line
  w.werk("add", "use-pg", "--title", "Use Postgres", "--parent", "storage");
  w.werk("accept", "use-pg", "--actor", "you");
  const cli = JSON.parse(logLines(w).at(-1) as string);
  expect({ type: cli.type, actor: cli.actor, keys: Object.keys(cli.payload) }).toEqual({
    type: ev.type,
    actor: ev.actor,
    keys: Object.keys(ev.payload),
  });
  const shown = w.werk("show", "use-sqlite");
  const shownCli = w.werk("show", "use-pg");
  expect(shown.split("\n")[0]?.replace("use-sqlite", "X")).toBe(shownCli.split("\n")[0]?.replace("use-pg", "X"));
});

test("18.2 a pending edit to a decided card shows as a diff and an accept amends it", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    // A decided card's parent and basis are decided too, so the amend's decide check can pass.
    d.seed("node.decided", { id: "root" });
    card(d, "speed", { title: "Speed matters", ...decided });
    card(d, "cache-layer", { title: "Cache layer", why: "Reads are slow", body: "Entries expire after five minutes.", ...decided });
    // A decided card that meets the decide check: a basis, a weighed option and a kill criterion.
    d.seed("edge.added", { from: "cache-layer", to: "speed", type: "depends_on", why: "It serves speed" });
    d.seed("node.added", { id: "no-cache", kind: "option", title: "No cache", why_not: "Too slow" });
    d.seed("edge.added", { from: "no-cache", to: "cache-layer", type: "alternative_to" });
    d.seed("kill.added", { id: "cache-layer", criterion: { form: "revisit" } });
  });
  w.werk(
    "propose",
    "cache-layer",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]),
  );
  await p.goto(`${w.url}/map/cache-layer`);
  await expect(heading(p)).toHaveText("Cache layer");
  expect(isBlue(await style(article(p), "border-top-color"))).toBe(true);
  expect(isBlue(await style(article(p), "background-color"), 0.012)).toBe(false);
  const ten = article(p).locator("[data-diff]", { hasText: /^ten$/ });
  const five = article(p).locator("[data-diff]", { hasText: /^five$/ });
  await expect(ten).toHaveCount(1);
  await expect(five).toHaveCount(1);
  expect(isBlue(await style(ten, "background-color"), 0.012)).toBe(true);
  expect(isBlue(await style(five, "background-color"), 0.012)).toBe(true);
  expect(await style(five, "text-decoration-line")).toContain("line-through");
  await expect(article(p).locator("[data-diff]")).toHaveCount(2);
  // no "proposed" badge (checked last among the look checks, so the diff checks above still run)
  await expect.soft(article(p).getByText("proposed", { exact: true })).toHaveCount(0);
  await flagPage(p);
  await article(p).getByRole("button", { name: /Accept/ }).click();
  await expect(article(p).locator("[data-diff]"), `log tail: ${logLines(w).slice(-2).join("\n")}; alert: ${await p.getByRole("alert").allTextContents()}`).toHaveCount(0);
  await expect(article(p).locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await stillSamePage(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const para = "Alpha and beta together.";
  const w = await project(undefined, (d) =>
    card(d, "steps", { title: "Steps", body: `${para}\n\n${items}`, ...decided }),
  );
  const longer = items.replace("- item 5", "- item 5\n- brand new item");
  w.werk(
    "propose",
    "steps",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: para, new: "- alpha\n- beta" },
      { tag: "elaborated", old: items, new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/steps`);
  const body = article(p).locator('[data-field="body"]');
  const newItem = body.locator("li", { hasText: "brand new item" });
  await expect(newItem).toHaveCount(1);
  const newMark = newItem.locator("[data-diff]");
  const markOn = (await newMark.count()) > 0 ? newMark.first() : newItem;
  expect(isBlue(await style(markOn, "background-color"), 0.012)).toBe(true);
  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li").filter({ hasText: new RegExp(`^item ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("[data-diff]")).toHaveCount(0);
  }
  // the old paragraph shows as removed
  const removed = body.locator("del, [data-diff=removed]").filter({ hasText: "Alpha and beta together." });
  await expect(removed.first()).toBeVisible();
  expect(await style(removed.first(), "text-decoration-line")).toContain("line-through");
  expect(isBlue(await style(removed.first(), "background-color"), 0.012)).toBe(true);
  // the new list shows as added
  const added = body.locator("ins, [data-diff=added]").filter({ hasText: "alpha" });
  await expect(added.first()).toBeVisible();
  await expect(added.first()).toContainText("beta");
  expect(isBlue(await style(added.first(), "background-color"), 0.012)).toBe(true);
});

test("18.4 removing a card with two children offers subtree removal or reparent", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server", ...decided });
    card(d, "auth", { title: "Auth", parent: "server", ...decided });
    card(d, "tokens", { title: "Tokens", parent: "auth", ...decided });
    card(d, "sessions", { title: "Sessions", parent: "auth", ...decided });
  });
  await p.goto(`${w.url}/map/server`);
  const tilesBefore = await p.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.outerHTML));
  await p.goto(`${w.url}/map/auth`);
  await expect(heading(p)).toHaveText("Auth");
  const authBefore = await p.locator("#card").innerHTML();
  await article(p).getByRole("button", { name: /Remove/ }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  const answers = dialog.getByRole("button");
  await expect(answers).toHaveCount(3);
  await expect(answers.filter({ hasText: /subtree/ })).toContainText("3 cards");
  const reparent = answers.filter({ hasText: /Server/ });
  await expect(reparent).toContainText("1 card");
  await expect(answers.filter({ hasText: /Cancel/ })).toHaveCount(1);
  const before = logLines(w).length;
  await flagPage(p);
  await reparent.click();
  await expect(dialog).toHaveCount(0);
  expect(await stillSamePage(p)).toBe(true);
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  const lines = logLines(w);
  expect(lines.length).toBe(before + 1);
  expect(JSON.parse(lines.at(-1) as string)).toMatchObject({ type: "node.removed", payload: { id: "auth", reparent: true } });
  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  const tilesAfter = await p.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.outerHTML));
  expect(tilesAfter).toEqual(tilesBefore);
  await p.goto(`${w.url}/map/auth`);
  await expect(heading(p)).toHaveText("Auth");
  expect(await p.locator("#card").innerHTML()).toBe(authBefore);
});

function send(url: string, path: string, body: string) {
  const { port } = new URL(url);
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("18.5 a proposed removal shows in red, cancel changes nothing, a write without the token is refused", async ({
  page: p,
}) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer", ...decided });
    card(d, "old-notes", { title: "Old notes", ...decided });
  });
  // An agent proposes to remove "Legacy importer": the agent runs werk without --actor you.
  const cli = spawnSync("bun", ["src/cli.ts", "help"], { encoding: "utf8" }).stdout;
  let proposed = false;
  try {
    w.werk("remove", "legacy");
    proposed = true;
  } catch {
    proposed = false;
  }
  expect.soft(proposed, `agent could not propose a removal; help names no such verb:\n${cli.split("\n").filter((l) => /remov/.test(l)).join("\n")}`).toBe(true);
  await p.goto(`${w.url}/map/root`);
  const legacy = p.locator('a[data-tile="legacy"]');
  await expect(legacy).toBeVisible();
  const red =
    isRed(await style(legacy, "border-top-color")) ||
    isRed(await style(legacy, "background-color")) ||
    isRed(await style(legacy, "color"));
  expect.soft(red, "Legacy importer is not drawn in red").toBe(true);
  // cancel on a different card
  await p.goto(`${w.url}/map/old-notes`);
  await expect(heading(p)).toHaveText("Old notes");
  const before = logLines(w).length;
  await article(p).getByRole("button", { name: /Remove/ }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(heading(p)).toHaveText("Old notes");
  expect(logLines(w).length).toBe(before);
  // another page writes without the token
  const shown = await p.locator("#card").innerHTML();
  const status = await send(w.url, "/api/remove", JSON.stringify({ id: "old-notes" }));
  expect(status).toBeGreaterThanOrEqual(400);
  expect(logLines(w).length).toBe(before);
  await expect(heading(p)).toHaveText("Old notes");
  expect(await p.locator("#card").innerHTML()).toBe(shown);
});
