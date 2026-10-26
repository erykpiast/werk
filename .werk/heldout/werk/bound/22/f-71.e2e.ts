// Held-out: 71.1-71.5 card links and code in the map.
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
function card(w: Werk, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

test("71.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "align");
  card(w, "notes-card", {
    body: "Refs: #al-diff, #ghost-card, al-diff, align and `node src/cli.ts show #al-diff`.",
  });
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="notes-card"]').click();
  await expect(p).toHaveURL(/\/map\/notes-card$/);
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(2);
  await expect(body(p).locator("a")).toHaveCount(2);
  await expect(body(p)).toContainText("#ghost-card");
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(0);
  await expect(body(p)).toContainText("align");
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveText("node src/cli.ts show #al-diff");
  await expect(cmd.locator("a")).toHaveCount(0);
});

test("71.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Alignment diff", why: "Diff the alignment" });
  card(w, "pr-iface", { why: "It builds on #al-diff" });
  await p.goto(`${w.url}/map/pr-iface`);
  const why = p.locator('[data-field="why"]');
  await why.locator('a[href="/map/al-diff"]').click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Alignment diff");
  await expect(p.locator('[data-field="why"]')).toContainText("Diff the alignment");
});

test("71.3", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", {
    body: [
      "# al-diff",
      "Link: https://example.com/page#al-diff",
      "Span: `#al-diff`",
      "```",
      "#al-diff",
      "```",
    ].join("\n\n"),
  });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "Link:" });
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("pre code")).toHaveText("#al-diff");
  await expect(body(p).locator("pre a")).toHaveCount(0);
  const span = body(p).locator("p").filter({ hasText: "Span:" });
  await expect(span.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
});

test("71.4", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "ref-card", { why: "Follows up on #al-diff" });
  w.seed("note.added", { id: "ref-card", text: "See al-diff first" });
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  const thread = p.locator('[data-section="thread"]');
  await expect(thread).toContainText("See");
  await expect(thread.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("71.5", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const json = [
    "{",
    '    "outer": {',
    '        "inner": {',
    `            "long": "${"y".repeat(400)}"`,
    "        }",
    "    }",
    "}",
  ];
  card(w, "code-card", { body: ["Before.", "```json", ...json, "```", "After."].join("\n") });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  expect(await box.locator("code span").count()).toBeGreaterThan(0);
  const text = await box.locator("code").textContent();
  expect(text?.split("\n").filter(Boolean)).toEqual(json);
  const s = await box.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  expect(s.inner).toBeGreaterThan(s.outer);
  expect(["auto", "scroll"]).toContain(s.ox);
  await box.locator("pre").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(await box.locator("pre").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const art = await p.locator('article[data-card="code-card"]').evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));
  expect(art.s).toBeLessThanOrEqual(art.c);
  const b = await body(p).evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));
  expect(b.s).toBeLessThanOrEqual(b.c);
});
