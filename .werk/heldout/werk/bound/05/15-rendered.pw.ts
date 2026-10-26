/// <reference lib="dom" />
// 15.x: the person opens a card in the map. The product path starts werk's map server the way
// `make dev` does (`bun --hot src/cli.ts serve`) on a project whose log holds the cards, then
// opens /map/<id>. A second test per step mounts the renderer's HTML alone, for the report detail.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { renderMarkdown, renderTileInline } from "../web/md";

const ROOT = join(new URL(".", import.meta.url).pathname, "..");
const CSS = readFileSync(join(ROOT, "web/md.css"), "utf8");

type Card = { id: string; title: string; body?: string; removed?: boolean };

/** Start werk's map on a fresh project; resolves to the base URL or throws with werk's output. */
async function openMap(cards: Card[]): Promise<{ base: string; stop: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-pw-"));
  mkdirSync(join(dir, ".werk"));
  const log = join(dir, ".werk", "log.jsonl");
  let seq = 0;
  for (const c of cards) {
    seq++;
    const payload: Record<string, string> = { id: c.id, kind: "card", title: c.title };
    if (c.body !== undefined) payload.body = c.body;
    appendFileSync(log, `${JSON.stringify({ seq, at: "t", actor: "you", type: "node.added", payload })}\n`);
  }
  const proc = spawn("bun", ["--hot", join(ROOT, "src/cli.ts"), "serve"], { cwd: dir, env: { ...process.env, PORT: "0" } });
  let output = "";
  const base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`werk serve printed no address in 15s: ${output}`)), 15_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const url = /https?:\/\/[^\s]+/.exec(output);
      if (url) {
        clearTimeout(timer);
        resolve(url[0].replace(/\/$/, ""));
      }
    };
    proc.stdout.on("data", read);
    proc.stderr.on("data", read);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`werk serve exited ${code}: ${output.split("\n")[0]}`));
    });
  });
  return { base, stop: () => (proc.kill(), rmSync(dir, { recursive: true, force: true })) };
}

const KNOWN = new Set(["al-diff", "align", "notes-test", "guards", "code-sample", "unsafe", "tile-card"]);
async function mount(p: Page, html: string) {
  await p.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body><article>${html}</article></body></html>`);
}

const B151 = "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.";
const B152 = [
  "--al-diff", "", "##al-diff", "", "&al-diff", "", "a code span holding `node src/cli.ts show #al-diff`", "",
  "see #no-such-card", "", "visit https://example.com/page#al-diff", "", "# al-diff", "", "And #al-diff alone.",
].join("\n");
const WIDE = "y".repeat(400);
const B153 = [
  "```zsh", "echo $HOME | grep -v x", "```", "```TypeScript", "const n: number = 1", "```",
  "```cobol", "DISPLAY 'HELLO'.", "```", "```", `${WIDE} #al-diff`, "```",
].join("\n");
const B154 = "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~";

const AL = { id: "al-diff", title: "Al diff", body: "Every proposed change is a diff." };

test("15.1 product: open notes-test in the map", async ({ page: p }) => {
  const map = await openMap([AL, { id: "align", title: "Align" }, { id: "notes-test", title: "Notes", body: B151 }]);
  try {
    await p.goto(`${map.base}/map/notes-test`);
    const links = p.locator("a", { hasText: /^#al-diff$/ });
    await expect(links).toHaveCount(4);
    await expect(p.locator("a", { hasText: /^#align$/ })).toHaveCount(1);
    await links.nth(1).click();
    await expect(p).toHaveURL(/\/map\/al-diff$/);
  } finally { map.stop(); }
});
test("15.1 renderer only", async ({ page: p }) => {
  await mount(p, renderMarkdown(B151, KNOWN));
  await expect(p.locator("article a")).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const a of await p.locator('article a[href="/map/al-diff"]').all())
    expect(await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily)).toMatch(/mono/i);
  const prose = await p.locator("article p").evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
    return c.textContent;
  });
  expect(prose).toBe("See , then , then , then , and  too.");
  expect(await p.locator("article a").nth(1).getAttribute("href")).toBe("/map/al-diff");
});

test("15.2 product: open guards in the map", async ({ page: p }) => {
  const map = await openMap([AL, { id: "guards", title: "Guards", body: B152 }]);
  try {
    await p.goto(`${map.base}/map/guards`);
    await expect(p.locator('a[href$="/map/al-diff"]')).toHaveCount(1);
  } finally { map.stop(); }
});
test("15.2 renderer only", async ({ page: p }) => {
  await mount(p, renderMarkdown(B152, KNOWN));
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card", "visit https://example.com/page#al-diff"]) {
    const para = p.locator("article p").filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = p.locator("article code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveText("node src/cli.ts show #al-diff");
  await expect(cmd.locator("a")).toHaveCount(0);
  await expect(p.locator("article h1")).toHaveText("al-diff");
  await expect(p.locator("article h1 a")).toHaveCount(0);
  await expect(p.locator("article a")).toHaveCount(1);
  await expect(p.locator("article a")).toHaveAttribute("href", "/map/al-diff");
});

test("15.3 product: open code-sample in the map", async ({ page: p }) => {
  const map = await openMap([AL, { id: "code-sample", title: "Code", body: B153 }]);
  try {
    await p.goto(`${map.base}/map/code-sample`);
    await expect(p.locator("pre")).toHaveCount(4);
  } finally { map.stop(); }
});
test("15.3 renderer only", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  await mount(p, renderMarkdown(B153, KNOWN));
  const boxes = p.locator("article pre");
  await expect(boxes).toHaveCount(4);
  const html = await p.locator("article").innerHTML();
  console.log(html.slice(0, 1500));
  const box = (n: number) => p.locator("article .codebox").nth(n);
  await expect(box(0)).toContainText("zsh");
  expect(await box(0).locator("code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size)).toBeGreaterThanOrEqual(2);
  const kw = box(1).locator("span", { hasText: /^const$/ });
  const nm = await box(1).locator("code").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) if (/\bn\b/.test(t.textContent ?? "")) return getComputedStyle(t.parentElement as Element).color;
    return "";
  });
  expect(await kw.evaluate((el) => getComputedStyle(el).color)).not.toBe(nm);
  await expect(box(2)).toContainText("cobol");
  expect(await box(2).locator("code *").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size)).toBeLessThanOrEqual(1);
  const sc = await box(3).locator("pre").evaluate((el) => [el.scrollWidth, el.clientWidth, getComputedStyle(el).overflowX]);
  expect(sc[0] as number).toBeGreaterThan(sc[1] as number);
  expect(["auto", "scroll"]).toContain(sc[2]);
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(p.locator("article pre a")).toHaveCount(0);
});

test("15.4 product: open unsafe in the map", async ({ page: p }) => {
  const map = await openMap([{ id: "unsafe", title: "Unsafe", body: B154 }]);
  try {
    await p.goto(`${map.base}/map/unsafe`);
    await expect(p.getByText("<script>window.__pwned = true</script>")).toBeVisible();
  } finally { map.stop(); }
});
test("15.4 renderer only", async ({ page: p }) => {
  await mount(p, renderMarkdown(B154, KNOWN));
  await expect(p.locator("article p")).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(p.locator("article strong")).toHaveText("bold");
  await expect(p.locator("article strong")).toHaveCSS("font-weight", "700");
  await expect(p.locator("article del")).toHaveText("gone");
  await expect(p.locator("article del")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 product: chat pane and grid tile in the map", async ({ page: p }) => {
  const map = await openMap([AL, { id: "old-idea", title: "Old idea" }, { id: "tile-card", title: "Tile card", body: "Depends on #al-diff" }]);
  try {
    await p.goto(`${map.base}/map`);
    await expect(p.getByRole("textbox")).toBeVisible();
  } finally { map.stop(); }
});
test("15.5 renderer only", async ({ page: p }) => {
  const known = new Set(["al-diff", "tile-card"]);
  await mount(p, renderMarkdown("Compare #al-diff with #old-idea and show code", known));
  await expect(p.locator("article a")).toHaveCount(1);
  await expect(p.locator("article a")).toHaveAttribute("href", "/map/al-diff");
  await expect(p.locator("article p")).toContainText("#old-idea");
  const reply = 'Here:\n```json\n{"a": "b", "n": 2}\n```';
  await mount(p, renderMarkdown(reply.slice(0, reply.indexOf("2")), known));
  await expect(p.locator("article .codebox")).toContainText("json");
  await expect(p.locator("article .codebox code")).toHaveText('{"a": "b", "n": ');
  await mount(p, renderMarkdown(reply, known));
  await expect(p.locator("article .codebox code")).toHaveText('{"a": "b", "n": 2}');
  expect(await p.locator("article .codebox code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size)).toBeGreaterThanOrEqual(2);
  await mount(p, `<a class="tile" href="#tile-card">${renderTileInline("Depends on #al-diff", known)}</a>`);
  await expect(p.locator("a.tile")).toHaveText("Depends on #al-diff");
  await expect(p.locator("a.tile a")).toHaveCount(0);
});
