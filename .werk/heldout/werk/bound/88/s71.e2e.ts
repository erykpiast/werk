import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
function card(w: Werk, id: string, f: { title?: string; why?: string; body?: string } = {}): void {
  w.seed("node.added", { id, kind: "card", title: f.title ?? id, parent: "root", ...f });
}

test("71.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "align");
  card(w, "notes-card", {
    body: "Mentions #al-diff, #ghost-card, the bare word al-diff, the bare word align, and `node src/cli.ts show #al-diff`",
  });
  await p.goto(`${w.url}/map/notes-card`);
  const links = body(p).locator("a");
  await expect(links).toHaveCount(2);
  await expect(links).toHaveAttribute("href", ["/map/al-diff", "/map/al-diff"] as never).catch(() => undefined);
  await expect(links.nth(0)).toHaveAttribute("href", "/map/al-diff");
  await expect(links.nth(1)).toHaveAttribute("href", "/map/al-diff");
  const text = await body(p).locator("p").evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(c.querySelectorAll("a"))) a.textContent = `[${a.textContent}]`;
    return c.textContent ?? "";
  });
  expect(text).toContain("#ghost-card");
  expect(text).toContain("bare word align");
  expect(text).toContain("bare word [");
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveCount(1);
  await expect(code.locator("a")).toHaveCount(0);
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(0);
});

test("71.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { why: "Diff the alignment" });
  card(w, "pr-iface", { why: "Follows from #al-diff" });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("al-diff");
  await expect(p.locator('[data-field="why"]')).toContainText("Diff the alignment");
});

test("71.3", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", {
    body: ["# al-diff", "See https://example.com/page#al-diff here", "A span `#al-diff` here", "```", "#al-diff", "```"].join("\n\n"),
  });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const url = body(p).locator("p", { hasText: "example.com" });
  await expect(url).toHaveText("See https://example.com/page#al-diff here");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const block = body(p).locator("pre");
  await expect(block).toContainText("#al-diff");
  await expect(block.locator("a")).toHaveCount(0);
  const span = body(p).locator("p", { hasText: "A span" }).locator("a");
  await expect(span).toHaveCount(1);
  await expect(span).toHaveAttribute("href", "/map/al-diff");
});

test("71.4", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "ref-card", { title: "Ref", why: "Follows up on #al-diff" });
  w.werk("say", "ref-card", "See al-diff first");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  const note = p.locator('[data-section="thread"] [data-entry="note"]');
  await expect(note.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
});

test("71.5", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const src = `{\n    "a": {\n        "b": {\n            "c": 1,\n            "long": "${"y".repeat(500)}END"\n        }\n    }\n}`;
  card(w, "code-card", { body: "Intro text.\n\n```json\n" + src + "\n```\n\nAfter text." });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  await expect(box.locator("[class^='tok-'], [class*=' tok-']").first()).toBeVisible();
  expect(await box.locator("code").evaluate((el) => el.textContent)).toBe(src);
  const pre = box.locator("pre");
  const m = await pre.evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(m.i).toBeGreaterThan(m.o);
  const left = await pre.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  expect(left).toBeGreaterThan(0);
  const f = await body(p).evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));
  expect(f.s).toBeLessThanOrEqual(f.c);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
});
