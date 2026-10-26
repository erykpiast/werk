// Held-out steps 71.1–71.5: card links and code in the rendered card text.
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: (fields.title as string) ?? id, parent: "root", ...fields });
}

test("71.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "align");
  card(w, "notes-card", {
    body: "Mentions #al-diff and #ghost-card.\n\nThe bare al-diff here.\n\nThe bare align here.\n\nRun `node src/cli.ts show #al-diff` now.",
  });
  await p.goto(`${w.url}/map/notes-card`);
  const first = body(p).locator("p").nth(0);
  await expect(first.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(first).toContainText("#ghost-card");
  await expect(body(p).locator('a[href="/map/ghost-card"]')).toHaveCount(0);
  await expect(first.locator("a")).toHaveCount(1);
  await expect(body(p).locator("p").nth(1).locator('a[href="/map/al-diff"]')).toHaveCount(1);
  const alignPara = body(p).locator("p").nth(2);
  await expect(alignPara).toContainText("align");
  await expect(alignPara.locator("a")).toHaveCount(0);
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
});

test("71.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "The diff card", why: "Diff the alignment" });
  card(w, "pr-iface", { title: "The PR interface", why: "It builds on #al-diff." });
  await p.goto(`${w.url}/map/pr-iface`);
  const link = p.locator('[data-field="why"] a', { hasText: "#al-diff" });
  await link.click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The diff card");
  await expect(p.getByText("Diff the alignment")).toBeVisible();
});

test("71.3", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", {
    body: [
      "# al-diff",
      "Visit https://example.com/page#al-diff today.",
      "A span `#al-diff` here.",
      "```",
      "#al-diff",
      "```",
    ].join("\n\n"),
  });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "example.com" });
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
  const w = await project();
  card(w, "al-diff");
  card(w, "ref-card", { title: "The ref card", why: "Follows up on #al-diff" });
  w.werk("say", "ref-card", "See al-diff first");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The ref card");
  const note = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "See" });
  await expect(note.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("71.5", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const long = "y".repeat(400);
  const json = [
    "{",
    '    "outer": {',
    '        "inner": {',
    `            "long": "${long}"`,
    "        }",
    "    }",
    "}",
  ];
  card(w, "code-card", { body: ["Before the code.", "```json", ...json, "```", "After the code."].join("\n") });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  const code = box.locator("code");
  await expect(code.locator("span")).not.toHaveCount(0);
  const colours = await code
    .locator("span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  const text = await code.evaluate((el) => el.textContent ?? "");
  expect(text.split("\n").filter(Boolean)).toEqual(json);
  const pre = box.locator("pre");
  const before = await pre.evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(before.inner).toBeGreaterThan(before.outer);
  await pre.hover();
  await p.mouse.wheel(5000, 0);
  await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const article = await p.locator("article").first().boundingBox();
  const bodyBox = await body(p).boundingBox();
  expect((bodyBox?.x ?? 0) + (bodyBox?.width ?? 0)).toBeLessThanOrEqual((article?.x ?? 0) + (article?.width ?? 0) + 1);
  const bodyScroll = await body(p).evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(bodyScroll.inner).toBeLessThanOrEqual(bodyScroll.outer);
});
