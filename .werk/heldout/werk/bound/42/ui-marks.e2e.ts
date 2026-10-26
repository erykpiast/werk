import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const dec = (w: Pick<Werk, "seed">, id: string, extra: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent: "root", status: "decided", who: "me", why: "w", ...extra });
const css = (at: Locator, prop: string) => at.evaluate((el, p) => (getComputedStyle(el) as any)[p] as string, prop);
const rgb = (p: Page, color: string) =>
  p.evaluate((c) => {
    const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a };
  }, color);
const art = (p: Page, id: string) => p.locator(`article[data-card="${id}"]`);

function chain(d: Pick<Werk, "seed">, ids: string[]) {
  for (const id of ids) dec(d, id);
  for (let i = 1; i < ids.length; i++)
    d.seed("edge.added", { from: ids[i], to: ids[i - 1], type: "depends_on", why: `${ids[i]} needs ${ids[i - 1]}` });
}

test("[72.1] rejected reopen: only the next hop is stale, in red", async ({ page: p }) => {
  const w = await project(undefined, (d) => chain(d, ["a", "b", "c"]));
  w.werk("reopen", "a", "--reason", "rejected", "--why", "the vendor dropped it");
  await p.goto(`${w.url}/map/b`);
  const b = art(p, "b");
  await expect(b.locator('[data-tag="stale"]')).toBeVisible();
  const tag = await rgb(p, await css(b.locator('[data-tag="stale"]'), "color"));
  expect(tag.r).toBeGreaterThan(tag.b + 40);
  const bg = await rgb(p, await css(b, "backgroundColor"));
  expect(bg.r).toBeGreaterThan(bg.g + 4);
  await expect(b).toHaveAttribute("data-status", "decided");
  const edge = await rgb(p, await css(b, "borderLeftColor"));
  expect(edge.g).toBeGreaterThan(edge.r);
  await p.goto(`${w.url}/map/c`);
  const c = art(p, "c");
  await expect(c.locator('[data-tag="stale"]')).toHaveCount(0);
  await expect(c.locator('[data-tag="paused"]')).toHaveCount(0);
  await expect(c).toHaveAttribute("data-stale", "false");
});

test("[72.2] postponed reopen: every downstream card is paused in grey", async ({ page: p }) => {
  const w = await project(undefined, (d) => chain(d, ["a", "b", "c"]));
  w.werk("reopen", "a", "--reason", "postponed", "--why", "next quarter");
  for (const id of ["b", "c"]) {
    await p.goto(`${w.url}/map/${id}`);
    const x = art(p, id);
    const tag = x.locator('[data-tag="paused"]');
    await expect(tag).toBeVisible();
    const col = await rgb(p, await css(tag, "color"));
    expect(Math.max(col.r, col.g, col.b) - Math.min(col.r, col.g, col.b)).toBeLessThan(45);
    await expect(x).toHaveAttribute("data-status", "decided");
    await expect(x.locator('[data-tag="stale"]')).toHaveCount(0);
  }
});

test("[72.3] the card view of a stale card explains the change", async ({ page: p }) => {
  const w = await project(undefined, (d) => chain(d, ["a", "b"]));
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="b"]').click();
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("#a");
  await expect(s).toContainText("rejected");
  await expect(s).toContainText("The vendor dropped this API");
  await expect(s).toContainText("depends_on");
  await expect(s).toContainText("#b");
});

test("[72.4] a paused card two hops away names the reopened card", async ({ page: p }) => {
  const w = await project(undefined, (d) => chain(d, ["a", "b", "c"]));
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map/c`);
  const headings = await p.locator("h2").allTextContents();
  console.log("H2:", headings);
  await expect(p.getByRole("heading", { name: "Why this card is stale" })).toBeVisible();
  const s = p.locator('[data-section="stale"], [data-section="paused"]');
  await expect(s).toContainText("#a");
  await expect(s).toContainText("postponed");
  await expect(s).toContainText("We build the engine next quarter");
});

test("[72.5] a stale mark wins over a paused mark", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    for (const id of ["a", "x", "b"]) dec(d, id);
    d.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "needs a" });
    d.seed("edge.added", { from: "b", to: "x", type: "depends_on", why: "needs x" });
  });
  w.werk("reopen", "x", "--reason", "postponed", "--why", "later");
  w.werk("reopen", "a", "--reason", "rejected", "--why", "wrong");
  await p.goto(`${w.url}/map/b`);
  const b = art(p, "b");
  await expect(b.locator('[data-tag="stale"]')).toBeVisible();
  await expect(b.locator('[data-tag="paused"]')).toHaveCount(0);
  const s = p.locator('[data-section="stale"]');
  await expect(s).toContainText("#a");
  await expect(s).toContainText("rejected");
});
