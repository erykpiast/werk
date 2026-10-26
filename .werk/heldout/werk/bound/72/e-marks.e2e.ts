// Held-out steps 72.x: stale and paused marks in the browser after a reopen from the command line.
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", {
    id,
    kind: "card",
    title: `Card ${id.toUpperCase()}`,
    parent: "root",
    status: "decided",
    who: "me",
    ...fields,
  });
}
const dep = (w: Pick<Werk, "seed">, from: string, to: string) =>
  w.seed("edge.added", { from, to, type: "depends_on", why: `${from} builds on ${to}` });

const box = (p: Page, id: string) => p.locator(`article[data-card="${id}"]`);
const tagOf = (p: Page, id: string, name: string) => box(p, id).locator(`[data-tag="${name}"]`);
const colourOf = (p: Page, id: string, name: string) =>
  tagOf(p, id, name).evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.color} ${s.borderTopColor} ${s.backgroundColor}`;
  });
const edge = (p: Page, id: string) => box(p, id).evaluate((el) => getComputedStyle(el).borderLeftColor);

/** Whether an oklch or rgb colour string reads as red (hue near 0-40 or 330-360, or rgb r dominant). */
function isRed(colour: string): boolean {
  const ok = [...colour.matchAll(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)/g)];
  if (ok.some((m) => Number(m[2]) > 0.05 && (Number(m[3]) < 40 || Number(m[3]) > 330))) return true;
  const rgb = [...colour.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)];
  return rgb.some((m) => Number(m[1]) > 150 && Number(m[1]) > Number(m[2]) * 2);
}
/** Whether every colour reads as grey (low chroma). */
function isGrey(colour: string): boolean {
  const ok = [...colour.matchAll(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)/g)];
  const rgb = [...colour.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)];
  return (
    ok.every((m) => Number(m[2]) < 0.05) &&
    rgb.every((m) => Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3]) < 30)
  );
}

async function decidedEdge(p: Page, w: Werk): Promise<string> {
  await p.goto(`${w.url}/map/ref`);
  return edge(p, "ref");
}

test("72.1 a rejected reopen marks only the direct dependent as stale, in red", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "b");
    card(d, "c");
    card(d, "ref");
    dep(d, "b", "a");
    dep(d, "c", "b");
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The storage choice is wrong");
  const green = await decidedEdge(p, w);
  await p.goto(`${w.url}/map/b`);
  await expect(tagOf(p, "b", "stale")).toBeVisible();
  expect(isRed(await colourOf(p, "b", "stale"))).toBe(true);
  expect(await edge(p, "b")).toBe(green);
  await p.goto(`${w.url}/map/c`);
  await expect(box(p, "c")).toBeVisible();
  await expect(tagOf(p, "c", "stale")).toHaveCount(0);
  await expect(tagOf(p, "c", "paused")).toHaveCount(0);
});

test("72.2 a postponed reopen pauses every downstream card in grey and keeps the status colour", async ({
  page: p,
}) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "b");
    card(d, "c");
    card(d, "ref");
    dep(d, "b", "a");
    dep(d, "c", "b");
  });
  w.werk("reopen", "a", "--reason", "postponed", "--why", "The engine waits");
  const green = await decidedEdge(p, w);
  for (const id of ["b", "c"]) {
    await p.goto(`${w.url}/map/${id}`);
    await expect(tagOf(p, id, "paused")).toBeVisible();
    expect(isGrey(await colourOf(p, id, "paused"))).toBe(true);
    await expect(tagOf(p, id, "stale")).toHaveCount(0);
  }
  expect(await edge(p, "c")).toBe(green);
});

test("72.3 the card view of a stale card explains the change, the link and the reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "b");
    dep(d, "b", "a");
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="b"]').click();
  await expect(p).toHaveURL(/\/map\/b$/);
  const section = p.locator("section").filter({ has: p.getByRole("heading", { name: "Why this card is stale" }) });
  await expect(section).toHaveCount(1);
  await expect(section).toContainText("#a");
  await expect(section).toContainText("depends_on");
  await expect(section).toContainText("#b");
  await expect(section).toContainText("rejected");
  await expect(section).toContainText("The vendor dropped this API");
});

test("72.4 the card view of a paused card two hops away names the reopened card and the reason", async ({
  page: p,
}) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "b");
    card(d, "c");
    dep(d, "b", "a");
    dep(d, "c", "b");
  });
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="c"]').click();
  await expect(p).toHaveURL(/\/map\/c$/);
  await expect.soft(p.getByRole("heading", { name: "Why this card is stale" })).toHaveCount(1);
  const section = p.locator('[data-section="stale"], [data-section="paused"]');
  await expect(section).toHaveCount(1);
  await expect(section).toContainText("#a");
  await expect(section).toContainText("postponed");
  await expect(section).toContainText("We build the engine next quarter");
});

test("72.5 a stale mark wins over a paused mark on the same card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "x");
    card(d, "b");
    dep(d, "b", "a");
    dep(d, "b", "x");
  });
  w.werk("reopen", "x", "--reason", "postponed", "--why", "Later");
  w.werk("reopen", "a", "--reason", "rejected", "--why", "Wrong vendor");
  await p.goto(`${w.url}/map`);
  await expect(p.locator('a[data-tile="b"]')).toHaveAttribute("data-stale", "true");
  await p.locator('a[data-tile="b"]').click();
  await expect(tagOf(p, "b", "stale")).toBeVisible();
  expect(isRed(await colourOf(p, "b", "stale"))).toBe(true);
  await expect(tagOf(p, "b", "paused")).toHaveCount(0);
  await expect(p.locator('[data-section="stale"]')).toContainText("#a");
  await expect(p.locator('[data-section="stale"]')).toContainText("rejected");
});
