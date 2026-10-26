// Held-out user paths 15.1 to 15.5: card text, code fences and references in the map in a browser.
// Each test writes a fresh project's log, starts `werk serve` in it, and opens the map.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "src", "cli.ts");

type Card = { id: string; title: string; body?: string; why?: string; removed?: boolean };

let server: ChildProcess | undefined;
let dir: string | undefined;

test.afterEach(() => {
  server?.kill("SIGKILL");
  server = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A project whose log holds each card as a real card; a removed card is added, then discarded. */
async function serve(cards: Card[], script?: unknown): Promise<string> {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-15-")));
  mkdirSync(join(dir, ".werk"));
  const lines: string[] = [];
  let seq = 0;
  for (const c of cards) {
    const { removed, ...fields } = c;
    const payload = { kind: "card", ...fields };
    if (removed) {
      lines.push(JSON.stringify({ seq: ++seq, at: "t", actor: "agent", type: "node.proposed", payload }));
      lines.push(JSON.stringify({ seq: ++seq, at: "t", actor: "agent", type: "change.discarded", payload: { id: c.id } }));
    } else {
      lines.push(JSON.stringify({ seq: ++seq, at: "t", actor: "you", type: "node.added", payload }));
    }
  }
  writeFileSync(join(dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
  const fake = join(dir, "fake-agent");
  mkdirSync(fake);
  if (script !== undefined) writeFileSync(join(fake, "script.json"), JSON.stringify(script));
  const env = {
    ...process.env,
    PATH: `${join(ROOT, "src", "test", "fake-bin")}:${process.env.PATH}`,
    FAKE_AGENT_DIR: fake,
    PORT: "0",
  };
  const proc = spawn(process.env.BUN ?? "bun", [CLI, "serve"], { cwd: dir, env });
  server = proc;
  let output = "";
  return await new Promise<string>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const url = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/.exec(output)?.[0];
      if (url) resolve(url);
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`werk serve exited ${code} before it printed an address:\n${output}`)));
    setTimeout(() => reject(new Error(`werk serve printed no address in 15 s:\n${output}`)), 15_000);
  });
}

const body = (page: Page) => page.locator(".md, [data-card-body], .card-body").first();

test("15.1 every form of a card reference in a card body becomes the same link to that card", async ({ page }) => {
  const base = await serve([
    { id: "al-diff", title: "Al diff" },
    { id: "align", title: "Align" },
    { id: "notes-test", title: "Notes test", body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." },
  ]);
  await page.goto(`${base}/map/notes-test`);
  const refs = body(page).locator("a");
  const diff = body(page).locator("a", { hasText: /^#al-diff$/ });
  await expect(diff).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const font = await diff.nth(i).evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono|courier|menlo|consolas/i);
  }
  await expect(body(page).locator("a", { hasText: /^#align$/ })).toHaveCount(1);
  await expect(refs).toHaveCount(5);
  await expect(body(page).locator("a", { hasText: /^(then|and)$/ })).toHaveCount(0);
  await diff.nth(1).click();
  await expect(page).toHaveURL(/\/map\/al-diff$/);
  await expect(page.getByText("Al diff").first()).toBeVisible();
});

test("15.2 text that only looks like a reference stays text", async ({ page }) => {
  const base = await serve([
    { id: "al-diff", title: "Al diff" },
    {
      id: "guards",
      title: "Guards",
      body: [
        "--al-diff",
        "",
        "##al-diff",
        "",
        "&al-diff",
        "",
        "a code span holding `node src/cli.ts show #al-diff`",
        "",
        "see #no-such-card",
        "",
        "visit https://example.com/page#al-diff",
        "",
        "# al-diff",
        "",
        "The real one: #al-diff",
      ].join("\n"),
    },
  ]);
  await page.goto(`${base}/map/guards`);
  const b = body(page);
  for (const t of ["--al-diff", "##al-diff", "&al-diff"]) await expect(b.getByText(t, { exact: true })).toBeVisible();
  await expect(b.locator("code", { hasText: "node src/cli.ts show #al-diff" }).locator("a")).toHaveCount(0);
  await expect(b.getByText("see #no-such-card")).toBeVisible();
  await expect(b.locator("a", { hasText: "no-such-card" })).toHaveCount(0);
  await expect(b.getByText("visit https://example.com/page#al-diff")).toBeVisible();
  await expect(b.locator("h1", { hasText: "al-diff" }).locator("a")).toHaveCount(0);
  const links = b.locator('a[href$="/map/al-diff"]');
  await expect(links).toHaveCount(1);
  await expect(links).toHaveText("#al-diff");
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const base = await serve([
    { id: "al-diff", title: "Al diff" },
    {
      id: "code-sample",
      title: "Code sample",
      body: [
        "```zsh",
        "echo $HOME | grep -v x # see #al-diff",
        "```",
        "```TypeScript",
        "const n: number = 1",
        "```",
        "```cobol",
        "DISPLAY 'HELLO'.",
        "```",
        "```",
        `${"x".repeat(400)} #al-diff`,
        "```",
      ].join("\n"),
    },
  ]);
  await page.goto(`${base}/map/code-sample`);
  const boxes = body(page).locator("pre");
  await expect(boxes).toHaveCount(4);
  const zsh = boxes.nth(0).locator("xpath=..");
  await expect(zsh).toContainText("zsh");
  const colour = (loc: ReturnType<Page["locator"]>) => loc.evaluate((el) => getComputedStyle(el).color);
  const echo = boxes.nth(0).locator("span", { hasText: /^echo$/ });
  const home = boxes.nth(0).locator("span", { hasText: /^\$HOME$/ });
  expect(await colour(echo)).not.toBe(await colour(home));
  const ts = boxes.nth(1);
  const constTok = ts.locator("span", { hasText: /^const$/ });
  await expect(constTok).toHaveCount(1);
  expect(await colour(constTok)).not.toBe(await colour(ts.locator("code")));
  const cobol = boxes.nth(2);
  await expect(cobol.locator("xpath=..")).toContainText("cobol");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const wide = boxes.nth(3);
  const overflow = await wide.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  expect(overflow.sw).toBeGreaterThan(overflow.cw);
  expect(["auto", "scroll"]).toContain(overflow.ox);
  const pageWide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(pageWide).toBe(true);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page }) => {
  const base = await serve([
    { id: "unsafe", title: "Unsafe", body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" },
  ]);
  await page.goto(`${base}/map/unsafe`);
  await expect(body(page)).toContainText("<script>window.__pwned = true</script>");
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(body(page).locator("strong", { hasText: "bold" })).toBeVisible();
  await expect(body(page).locator("del, s", { hasText: "gone" })).toBeVisible();
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page }) => {
  const reply = [
    { event: { type: "assistant", message: { content: [{ type: "text", text: 'Here:\n```json\n{"a": 1,' }] } } },
    { pause: 1500 },
    { event: { type: "assistant", message: { content: [{ type: "text", text: '\n "b": true}\n```' }] } } },
    { event: { type: "result", subtype: "success", result: 'Here:\n```json\n{"a": 1,\n "b": true}\n```' } },
  ];
  const base = await serve(
    [
      { id: "al-diff", title: "Al diff" },
      { id: "old-idea", title: "Old idea", removed: true },
      { id: "tile-card", title: "Tile card", why: "Depends on #al-diff" },
    ],
    { roles: { chat: { replies: [reply], exit: 0 } } },
  );
  await page.goto(`${base}/map`);
  const input = page.getByRole("textbox").last();
  await input.fill("Compare #al-diff with #old-idea and show code");
  await input.press("Enter");
  const mine = page.locator("[data-role=user], .message.user, .chat-user").last();
  await expect(mine.locator('a[href$="/map/al-diff"]', { hasText: "#al-diff" })).toHaveCount(1);
  await expect(mine).toContainText("#old-idea");
  await expect(mine.locator("a", { hasText: "old-idea" })).toHaveCount(0);
  const theirs = page.locator("[data-role=assistant], .message.assistant, .chat-assistant").last();
  await expect(theirs.locator(".codebox, pre").first()).toContainText('{"a": 1,');
  await expect(theirs).toContainText("json");
  await expect(theirs.locator("pre")).toContainText('"b": true');
  await expect(theirs.locator("pre span").first()).toBeVisible();
  await page.goto(`${base}/map`);
  const tile = page.locator("a, [role=link]", { hasText: "Depends on #al-diff" }).first();
  await expect(tile).toBeVisible();
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(page).toHaveURL(/\/map\/tile-card$/);
});
