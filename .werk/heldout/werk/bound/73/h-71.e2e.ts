import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

/** The text of an element with every link removed. */
const unlinked = (p: Page) =>
  body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });

test("71.1 known ids link, other text stays plain", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "align");
    card(d, "notes-card", {
      body: "One #al-diff here.\n\nTwo #ghost-card here.\n\nThree al-diff here.\n\nFour align here.\n\nFive `node src/cli.ts show #al-diff` here.",
    });
  });
  await p.goto(`${w.url}/map/notes-card`);
  const para = (t: string) => body(p).locator("p").filter({ hasText: t });
  await expect(para("One").locator('a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(para("Three").locator('a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(para("Two").locator("a")).toHaveCount(0);
  await expect(para("Two")).toContainText("#ghost-card");
  await expect(para("Four").locator("a")).toHaveCount(0);
  await expect(para("Four")).toHaveText("Four align here.");
  const code = para("Five").locator("code");
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  await expect(para("Five").locator("a")).toHaveCount(0);
  expect(await unlinked(p)).toContain("align");
});

test("71.2 a click on a card link in a why line opens that card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff", why: "Diff the alignment" });
    card(d, "pr-iface", { why: "This follows #al-diff closely." });
  });
  await p.goto(`${w.url}/map/pr-iface`);
  const link = p.locator('[data-field="why"] a[href="/map/al-diff"]');
  await expect(link).toHaveText("#al-diff");
  await link.click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Alignment diff");
  await expect(p.locator('[data-field="why"]')).toContainText("Diff the alignment");
});

test("71.3 headings, URL fragments and fenced blocks keep their own form", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "doc-card", {
      body: "# al-diff\n\nSee https://example.com/page#al-diff now.\n\nSpan `#al-diff` here.\n\n```\n#al-diff\n```",
    });
  });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("p").filter({ hasText: "example.com" }).locator('a[href="/map/al-diff"]')).toHaveCount(
    0,
  );
  await expect(body(p).locator("pre")).toContainText("#al-diff");
  await expect(body(p).locator("pre a")).toHaveCount(0);
  const span = body(p).locator("p").filter({ hasText: "Span" }).locator('a[href="/map/al-diff"]');
  await expect(span).toHaveCount(1);
  await expect(span).toHaveText("#al-diff");
});

test("71.4 a tile summary holds no link, a note on the open card does", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "ref-card", { title: "Ref card", why: "Follows up on #al-diff" });
  });
  w.werk("say", "ref-card", "See al-diff first");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  const note = p.locator('[data-entry="note"]').filter({ hasText: "See" });
  await expect(note).toContainText("See");
  await expect(note.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("71.5 fenced json is boxed, highlighted, indented and scrolls sideways", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const long = "z".repeat(400);
  const json = `{\n    "outer": {\n        "inner": "${long}"\n    }\n}`;
  const w = await project(undefined, (d) => card(d, "code-card", { body: `Text.\n\n\`\`\`json\n${json}\n\`\`\`` }));
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  const colours = await box
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  const text = await box.locator("code").textContent();
  expect(text?.replace(/\n$/, "")).toBe(json);
  const pre = box.locator("pre");
  const s = await pre.evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(s.inner).toBeGreaterThan(s.outer);
  await pre.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(await pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const bodyBox = await body(p).evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(bodyBox.inner).toBeLessThanOrEqual(bodyBox.outer);
});
