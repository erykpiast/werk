import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

test("71.1 known ids link, other text stays plain", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "align");
    card(d, "notes-card", {
      body: "Mentions #al-diff, #ghost-card, the bare al-diff, the bare align, and `node src/cli.ts show #al-diff`.",
    });
  });
  await p.goto(`${w.url}/map/notes-card`);
  const al = body(p).locator('a[href="/map/al-diff"]');
  await expect(al).toHaveCount(2);
  await expect(al).toHaveText(["#al-diff", "#al-diff"]);
  await expect(body(p)).toContainText("#ghost-card");
  await expect(body(p).locator("a", { hasText: "ghost-card" })).toHaveCount(0);
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(0);
  await expect(body(p)).toContainText("the bare align,");
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  expect(await code.evaluate((el) => el.closest("a") === null)).toBe(true);
});

test("71.2 a click on a card link in a why line opens that card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff", why: "Diff the alignment" });
    card(d, "pr-iface", { why: "Builds on #al-diff for the review" });
  });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(h1(p)).toHaveText("Alignment diff");
  await expect(p.locator('[data-field="why"]')).toHaveText("Diff the alignment");
});

test("71.3 headings, URL fragments and fenced blocks keep their own form", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "doc-card", {
      body: [
        "# al-diff",
        "",
        "Read https://example.com/page#al-diff today.",
        "",
        "The span `#al-diff` here.",
        "",
        "```",
        "#al-diff",
        "```",
      ].join("\n"),
    });
  });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "example.com" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const fence = body(p).locator(".codebox code, pre code");
  await expect(fence).toHaveText("#al-diff");
  await expect(body(p).locator("pre a")).toHaveCount(0);
  const span = body(p).locator("p").filter({ hasText: "The span" }).locator('a[href="/map/al-diff"]');
  await expect(span).toHaveCount(1);
  await expect(span).toHaveText("#al-diff");
});

test("71.4 a tile summary holds no link, a note on the open card does", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "ref-card", { title: "Ref card", why: "Follows up on #al-diff" });
    d.seed("note.added", { id: "ref-card", text: "See al-diff first" });
  });
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  await expect(h1(p)).toHaveText("Ref card");
  const note = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "See" });
  await expect(note.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("71.5 fenced json is boxed, highlighted, indented, and scrolls sideways", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 800 });
  const code = [
    "{",
    '    "outer": {',
    '        "inner": {',
    '            "depth": 3,',
    `            "long": "${"x".repeat(400)}"`,
    "        }",
    "    }",
    "}",
  ].join("\n");
  const w = await project(undefined, (d) =>
    card(d, "code-card", { body: `Intro text.\n\n\`\`\`json\n${code}\n\`\`\`\n\nOutro text.` }),
  );
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  const styled = await box.evaluate((el) => {
    const s = getComputedStyle(el);
    return s.borderTopStyle !== "none" || s.backgroundColor !== "rgba(0, 0, 0, 0)";
  });
  expect(styled).toBe(true);
  const colours = await box
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  expect(await box.locator("code").evaluate((el) => el.textContent)).toBe(code);
  expect(await box.locator("pre").evaluate((el) => getComputedStyle(el).whiteSpace)).toMatch(/^pre/);
  const pre = box.locator("pre");
  const before = await pre.evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));
  expect(before.s).toBeGreaterThan(before.c);
  const left = await pre.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  expect(left).toBeGreaterThan(0);
  const art = await p.locator("article[data-card='code-card']").boundingBox();
  const bd = await body(p).boundingBox();
  expect((bd?.x ?? 0) + (bd?.width ?? 0)).toBeLessThanOrEqual((art?.x ?? 0) + (art?.width ?? 0) + 1);
  const para = await body(p).locator("p").first().boundingBox();
  expect(para?.width ?? 9999).toBeLessThanOrEqual(art?.width ?? 0);
  const doc = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(doc.s).toBeLessThanOrEqual(doc.c);
});
