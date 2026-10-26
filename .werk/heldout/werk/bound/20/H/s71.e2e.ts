// Held-out steps 71.1-71.5: card links in bodies, why lines, tiles, notes, and fenced code.
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent: "root", ...fields });
}

test("71.1", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "align");
    card(d, "notes-card", {
      body: "First #al-diff here.\n\nThen #ghost-card there.\n\nThird al-diff word.\n\nBare align word.\n\nCode `node src/cli.ts show #al-diff` span.",
    });
  });
  await p.goto(`${w.url}/map/notes-card`);
  const para = (text: string) => body(p).locator("p").filter({ hasText: text });
  await expect(para("First").locator('a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(para("Third").locator('a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(para("ghost-card")).toContainText("#ghost-card");
  await expect(para("ghost-card").locator("a")).toHaveCount(0);
  await expect(para("Bare align")).toContainText("align");
  await expect(para("Bare align").locator("a")).toHaveCount(0);
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  await expect(para("Code").locator("a")).toHaveCount(0);
});

test("71.2", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "The diff card", why: "Diff the alignment" });
    card(d, "pr-iface", { why: "It builds on #al-diff." });
  });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"]').getByRole("link", { name: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The diff card");
  await expect(p.locator('[data-field="why"]')).toHaveText("Diff the alignment");
});

test("71.3", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "doc-card", {
      body: [
        "# al-diff",
        "Visit https://example.com/page#al-diff now.",
        "A span `#al-diff` here.",
        "```",
        "#al-diff",
        "```",
      ].join("\n\n"),
    });
  });
  await p.goto(`${w.url}/map/doc-card`);
  const h = body(p).locator("h1");
  await expect(h).toHaveText("al-diff");
  await expect(h.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "Visit" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const fence = body(p).locator("pre code");
  await expect(fence).toHaveText("#al-diff");
  await expect(body(p).locator("pre a")).toHaveCount(0);
  const span = body(p).locator("p").filter({ hasText: "A span" }).locator('a[href="/map/al-diff"]');
  await expect(span).toHaveCount(1);
  await expect(span).toHaveText("#al-diff");
});

test("71.4", async ({ page: p }) => {
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
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ref card");
  const note = p.locator('[data-entry="note"]', { hasText: "first" });
  await expect(note.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("71.5", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const long = `"note": "${"long words ".repeat(60)}end-of-line"`;
  const json = ["{", '    "outer": {', '        "inner": {', `            ${long}`, "        }", "    }", "}"];
  const w = await project(undefined, (d) =>
    card(d, "code-card", { body: ["Intro text.", "", "```json", ...json, "```"].join("\n") }),
  );
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  const code = box.locator("pre code");
  const colours = await code
    .locator("span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  const text = await code.textContent();
  expect(text?.replace(/\n$/, "")).toBe(json.join("\n"));
  expect(await code.evaluate((el) => getComputedStyle(el.closest("pre") as Element).whiteSpace)).toMatch(/pre/);
  const pre = box.locator("pre");
  const s = await pre.evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(s.inner).toBeGreaterThan(s.outer);
  await pre.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(await pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const b = await body(p).evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(b.inner).toBeLessThanOrEqual(b.outer);
  const article = await p
    .locator("article")
    .first()
    .evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(article.inner).toBeLessThanOrEqual(article.outer);
});
