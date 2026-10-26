import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { card, isGreen, isGrey, isRed, rgbOf } from "./web-c-util.ts";

test.afterEach(stop);

function chain(down: Pick<Werk, "seed">) {
  card(down, "a", { title: "Card A" });
  card(down, "b", { title: "Card B" });
  card(down, "c", { title: "Card C" });
  down.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "B builds on A" });
  down.seed("edge.added", { from: "c", to: "b", type: "depends_on", why: "C builds on B" });
}

async function view(p: Page, w: Werk, id: string) {
  await p.goto(`${w.url}/map`);
  await p.locator(`[data-tile="${id}"]`).click();
  await expect(p).toHaveURL(new RegExp(`/map/${id}$`));
  return p.locator(`article[data-card="${id}"]`);
}

test("72.1 a rejected reopen marks only the direct dependent as stale", async ({ page: p }) => {
  const w = await project(undefined, chain);
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The idea does not hold");
  await p.goto(`${w.url}/map`);
  await expect(p.locator('[data-tile="b"]')).toHaveAttribute("data-stale", "true");
  await expect(p.locator('[data-tile="c"]')).toHaveAttribute("data-stale", "false");
  const b = await view(p, w, "b");
  const tag = b.locator('[data-tag="stale"]');
  await expect(tag).toBeVisible();
  const tagColour = await rgbOf(tag, "color");
  const bg = await rgbOf(b, "background-color");
  const edge = await rgbOf(b, "border-left-color");
  console.log("72.1 B tag", tagColour, "bg", bg, "edge", edge);
  expect(isRed(tagColour.rgba)).toBe(true);
  expect(isRed(bg.rgba)).toBe(true);
  expect(isGreen(edge.rgba)).toBe(true);
  await expect(b.locator('[data-tag="status"]')).toHaveText("decided");
  const c = await view(p, w, "c");
  await expect(c).toHaveAttribute("data-stale", "false");
  await expect(c.locator('[data-tag="stale"]')).toHaveCount(0);
  await expect(c.locator('[data-tag="paused"]')).toHaveCount(0);
  await expect(p.locator('[data-section="stale"], [data-section="paused"]')).toHaveCount(0);
});

test("72.2 a postponed reopen marks every downstream card as paused", async ({ page: p }) => {
  const w = await project(undefined, chain);
  w.werk("reopen", "a", "--reason", "postponed", "--why", "Later");
  await p.goto(`${w.url}/map`);
  const tileB = await p.locator('[data-tile="b"]').innerHTML();
  console.log("72.2 tile b html", tileB);
  for (const id of ["b", "c"]) {
    const box = await view(p, w, id);
    const tag = box.locator('[data-tag="paused"]');
    await expect(tag).toBeVisible();
    const colour = await rgbOf(tag, "color");
    const border = await rgbOf(tag, "border-top-color");
    const edge = await rgbOf(box, "border-left-color");
    console.log(`72.2 ${id} paused tag`, colour, border, "edge", edge);
    expect(isGrey(colour.rgba)).toBe(true);
    expect(isGreen(edge.rgba)).toBe(true);
    await expect(box.locator('[data-tag="status"]')).toHaveText("decided");
    await expect(box.locator('[data-tag="stale"]')).toHaveCount(0);
    await expect(box).toHaveAttribute("data-stale", "false");
  }
});

test("72.3 the card view of a stale card explains the change", async ({ page: p }) => {
  const w = await project(undefined, chain);
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await view(p, w, "b");
  const section = p.locator('[data-section="stale"]');
  await expect(section.locator("h2")).toHaveText("Why this card is stale");
  const text = await section.innerText();
  console.log("72.3 section", text);
  await expect(section).toContainText("#a");
  await expect(section).toContainText("rejected");
  await expect(section).toContainText("The vendor dropped this API");
  await expect(section.locator('[data-role="link"]')).toContainText("#b");
  await expect(section.locator('[data-role="link"]')).toContainText("depends_on");
  // "Card A was reopened": the cause line names #a with its reopen reason (binder reading).
  expect(text).toMatch(/from #a[^\n]*rejected/i);
});

test("72.4 the card view of a paused card two hops away", async ({ page: p }) => {
  const w = await project(undefined, chain);
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await view(p, w, "c");
  const heads = p.locator("[data-section] h2").filter({ hasText: /^Why this card is/ });
  console.log("72.4 headings", await heads.allTextContents());
  const section = p.locator('[data-section="paused"], [data-section="stale"]');
  const text = await section.allInnerTexts();
  console.log("72.4 section", text);
  await expect(section).toContainText("#a");
  await expect(section).toContainText("postponed");
  await expect(section).toContainText("We build the engine next quarter");
  await expect(p.locator("[data-section] h2").filter({ hasText: "Why this card is stale" })).toHaveCount(1);
  expect(text.join("\n")).toMatch(/reopen/i);
});

test("72.5 a stale mark wins over a paused mark on the same card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "a", { title: "Card A" });
    card(down, "x", { title: "Card X" });
    card(down, "b", { title: "Card B" });
    down.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "B builds on A" });
    down.seed("edge.added", { from: "b", to: "x", type: "depends_on", why: "B builds on X" });
  });
  w.werk("reopen", "x", "--reason", "postponed", "--why", "Later");
  w.werk("reopen", "a", "--reason", "rejected", "--why", "Wrong idea");
  const b = await view(p, w, "b");
  await expect(b.locator('[data-tag="stale"]')).toBeVisible();
  console.log("72.5 B tags", await b.locator('[data-role="tags"] [data-tag]').allTextContents());
  const stale = p.locator('[data-section="stale"]');
  await expect(stale).toContainText("#a");
  await expect(stale).toContainText("rejected");
  await expect(b.locator('[data-tag="paused"]')).toHaveCount(0);
});
