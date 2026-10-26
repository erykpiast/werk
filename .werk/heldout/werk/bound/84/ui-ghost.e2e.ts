// Held-out: ghosts in the map (steps 70.x) and stale/paused marks (steps 72.x).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, f: Record<string, unknown> = {}) {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...f });
}
const events = (w: { dir: string }) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const accept = (p: Page) => p.getByRole("button", { name: "Accept" });
const probeColour = (p: Page, cls: string) =>
  p.evaluate((c) => {
    const e = document.createElement("span");
    e.className = c;
    document.body.append(e);
    return getComputedStyle(e).color;
  }, cls);
const rgb = (s: string) => (/rgba?\((\d+), (\d+), (\d+)/.exec(s) ?? []).slice(1, 4).map(Number);

test("70.1 a proposed card shows as a grey dashed ghost under its parent", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const ghost = p.locator('[data-tile="refunds"]');
  await expect(ghost).toBeVisible();
  const g = await ghost.evaluate((e) => ({ style: getComputedStyle(e).borderTopStyle, colour: getComputedStyle(e).borderTopColor }));
  expect(g.style).toBe("dashed");
  const [r, gg, b] = rgb(g.colour);
  // grey: the three channels are close to each other
  expect(Math.max(r, gg, b) - Math.min(r, gg, b), `ghost border colour ${g.colour} is not grey`).toBeLessThan(16);
  const real = await p.locator('article[data-card="payments"]').evaluate((e) => getComputedStyle(e).borderTopStyle);
  expect(real).toBe("solid");
});

test("70.2 ✓ on a ghost makes it real", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  const before = events(w).length;
  await accept(p).click();
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  await expect(accept(p)).toHaveCount(0);
  const log = events(w);
  expect(log.length).toBe(before + 1);
  expect(log.at(-1)).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "refunds" } });
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await accept(p).click();
  await expect(p.locator('article[data-card="partial"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tile="partial"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.4 an accept takes only the accepted branch", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Credit note", "--why_not", "Slow");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "src", "--kind", "source", "--title", "Policy", "--finding", "Allowed");
  w.werk("link", "refunds", "src", "--type", "supported_by");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.getByRole("button", { name: /accept all|all/i })).toHaveCount(0);
  await p.locator('[data-tile="refunds"]').click();
  await accept(p).click();
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  const shownOpt = w.werk("show", "refunds:opt0");
  const shownSrc = w.werk("show", "src");
  expect(shownOpt).not.toContain("proposed");
  expect(shownSrc).not.toContain("proposed");
  await expect(p.locator("section[data-section]").filter({ hasText: "(proposed)" })).toHaveCount(0);
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="chargebacks"]')).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tile="chargebacks"]')).toHaveAttribute("data-proposed", "true");
  const st = await p.locator('[data-tile="chargebacks"]').evaluate((e) => getComputedStyle(e).borderTopStyle);
  expect(st).toBe("dashed");
});

test("70.5 a second window sees the accept", async ({ page: p, context }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const q = await context.newPage();
  await p.goto(`${w.url}/map/refunds`);
  await q.goto(`${w.url}/map/refunds`);
  await expect(q.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "true");
  await accept(p).click();
  await expect(q.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
});

/** A, B depends on A, C depends on B; all decided; each card sits under the root. */
function chain(d: Pick<Werk, "seed">, ids = ["a", "b", "c"]) {
  for (const id of ids) card(d, id, { title: `Card ${id}` });
  for (let i = 1; i < ids.length; i++)
    d.seed("edge.added", { from: ids[i], to: ids[i - 1], type: "depends_on", why: `${ids[i]} needs ${ids[i - 1]}` });
}

const hero = (p: Page, id: string) => p.locator(`article[data-card="${id}"]`);

test("72.1 a rejected reopen marks only the direct dependent stale, in red", async ({ page: p }) => {
  const w = await project(undefined, (d) => chain(d));
  w.werk("reopen", "a", "--reason", "rejected", "--why", "the vendor dropped it");
  await p.goto(`${w.url}/map/b`);
  const b = hero(p, "b");
  await expect(b).toHaveAttribute("data-stale", "true");
  const tag = b.locator('[data-tag="stale"]');
  await expect(tag).toHaveCount(1);
  expect(await tag.evaluate((e) => getComputedStyle(e).color)).toBe(await probeColour(p, "text-red-700"));
  await expect(b).toHaveAttribute("data-status", "decided");
  expect(await b.evaluate((e) => getComputedStyle(e).borderLeftColor)).toBe(
    await p.evaluate(() => {
      const e = document.createElement("span");
      e.className = "border-l-4 border-l-green-600";
      e.style.borderLeftStyle = "solid";
      document.body.append(e);
      return getComputedStyle(e).borderLeftColor;
    }),
  );
  await p.goto(`${w.url}/map/c`);
  const c = hero(p, "c");
  await expect(c).toHaveAttribute("data-stale", "false");
  await expect(c).toHaveAttribute("data-postponed", "false");
  await expect(c.locator('[data-tag="stale"], [data-tag="paused"], [data-tag="postponed"]')).toHaveCount(0);
});

test("72.2 a postponed reopen marks every downstream card paused, in grey", async ({ page: p }) => {
  const w = await project(undefined, (d) => chain(d));
  w.werk("reopen", "a", "--reason", "postponed", "--why", "next quarter");
  for (const id of ["b", "c"]) {
    await p.goto(`${w.url}/map/${id}`);
    const t = hero(p, id);
    const tag = t.locator('[data-tag="paused"]');
    await expect(tag).toHaveCount(1);
    expect(await tag.evaluate((e) => getComputedStyle(e).color)).toBe(await probeColour(p, "text-gray-600"));
    await expect(t).toHaveAttribute("data-status", "decided");
    await expect(t.locator('[data-tag="status"]')).toHaveText(/decided/i);
    await expect(t.locator('[data-tag="stale"]')).toHaveCount(0);
    await expect(t).toHaveAttribute("data-stale", "false");
  }
});

test("72.3 the card view of a stale card explains the change", async ({ page: p }) => {
  const w = await project(undefined, (d) => chain(d, ["a", "b"]));
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map/b`);
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("#a");
  await expect(s).toContainText("depends");
  await expect(s).toContainText("rejected");
  await expect(s).toContainText("The vendor dropped this API");
});

test("72.4 a paused card two hops away names the reopened card and the reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => chain(d));
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map/c`);
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("#a");
  await expect(s).toContainText("postponed");
  await expect(s).toContainText("We build the engine next quarter");
});

test("72.5 stale wins over paused on the same card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    for (const id of ["a", "x", "b"]) card(d, id, { title: `Card ${id}` });
    d.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "b needs a" });
    d.seed("edge.added", { from: "b", to: "x", type: "depends_on", why: "b needs x" });
  });
  w.werk("reopen", "x", "--reason", "postponed", "--why", "later");
  w.werk("reopen", "a", "--reason", "rejected", "--why", "wrong approach");
  await p.goto(`${w.url}/map/b`);
  await expect(hero(p, "b").locator('[data-tag="stale"]')).toHaveCount(1);
  await expect(hero(p, "b").locator('[data-tag="paused"]')).toHaveCount(0);
  const s = p.locator('[data-section="stale"]');
  await expect(s).toContainText("#a");
  await expect(s).toContainText("rejected");
});
