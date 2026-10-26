// Held-out steps in a real browser on a real werk server: excerpts (06), threads (10), card text (15).
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

type Werk = {
  dir: string;
  url: string;
  werk(...args: string[]): { code: number; out: string; err: string };
  seed(type: string, payload: object): void;
  count(): number;
};

function env(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  for (const name of Object.keys(clean)) if (name.startsWith("WERK_")) delete clean[name];
  return clean;
}

let server: ChildProcess | undefined;
let root: string | undefined;

test.afterEach(() => {
  server?.kill("SIGTERM");
  server = undefined;
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

async function project(): Promise<Werk> {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const count = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: count() + 1, at: "t", actor: "you", type, payload })}\n`);
  const werk = (...args: string[]) => {
    const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env: env(), encoding: "utf8" });
    return { code: run.status ?? -1, out: run.stdout, err: run.stderr };
  };
  seed("node.added", { id: "root", kind: "card", title: "Root" });
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
  server = proc;
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    let err = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    proc.on("exit", (code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
  });
  return { dir, url, werk, seed, count };
}

function ok(w: Werk, ...args: string[]): string {
  const run = w.werk(...args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run.out;
}

function chat(w: Werk, name: string, lines: object[]): void {
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(w.dir, ".werk", "chats", `${name}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

const cardPath = (w: Werk, id: string) => `${w.url}/map/${encodeURIComponent(id)}`;
const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
const article = (p: Page) => p.locator("article[data-card]");

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

// ---------- 06 ----------

function decidedWithChat(w: Werk): void {
  w.seed("node.added", {
    id: "pricing",
    kind: "card",
    title: "We bill per seat",
    why: "Seats track value.",
    status: "decided",
    parent: "root",
  });
  chat(w, "talk", [{ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "seats are the unit we bill" }]);
}

test("06.1", async ({ page: p }) => {
  const w = await project();
  decidedWithChat(w);
  const out = ok(w, "quote", "pricing", "talk", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  const id = /^(\S+):\s/.exec(out)?.[1] as string;
  await p.goto(cardPath(w, id));
  await expect(article(p)).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  // The card's own view: status and words unchanged, and a pending link to the excerpt.
  await p.goto(cardPath(w, "pricing"));
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  const link = p.locator(`a[href="/map/${encodeURIComponent(id)}"], a[href="/map/${id}"]`);
  await expect(link).toHaveCount(1, { timeout: 5000 });
  await expect(link.locator("xpath=..")).toContainText(/proposed|pending|held/);
});

test("06.2", async ({ page: p }) => {
  const w = await project();
  decidedWithChat(w);
  const out = ok(w, "quote", "pricing", "talk", "seats are the unit");
  const id = /^(\S+):\s/.exec(out)?.[1] as string;
  await p.goto(cardPath(w, id));
  await expect(article(p)).toHaveAttribute("data-proposed", "true");
  const check = p.getByRole("button", { name: /✓|accept/i });
  await expect(check).toHaveCount(1, { timeout: 5000 });
  await check.click();
  await expect(article(p)).toHaveAttribute("data-proposed", "false");
  await p.goto(cardPath(w, "pricing"));
  await expect(p.getByText("seats are the unit")).toBeVisible();
  expect(ok(w, "show", "pricing")).not.toMatch(/supported_by.*held/);
});

// ---------- 10 ----------

test("10.1", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", {
    id: "auth-login",
    kind: "card",
    title: "Login uses magic links",
    status: "decided",
    parent: "root",
  });
  ok(w, "say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login", parent: "root" });
  await p.goto(cardPath(w, "auth-login"));
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);
  await expect(notes(p)).toHaveCount(4);
  const all = ok(w, "inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Each note shows its card id and its log position.
  const head = all.split("\n").find((l, i, arr) => arr[i + 1]?.includes("first") || l.includes("first")) ?? "";
  expect(head).toContain("auth-login");
  const seq = /\[(\d+)\]|\b(\d+)\b/.exec(head);
  expect(seq).not.toBeNull();
  const first = (seq?.[1] ?? seq?.[2]) as string;
  const since = ok(w, "inbox", "--since", first);
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  expect(since).not.toContain("first");
  const capped = ok(w, "inbox", "--since", first, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3", async ({ page: p }) => {
  const w = await project();
  ok(w, "add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(cardPath(w, "auth-retry"));
  await expect(article(p)).toHaveAttribute("data-proposed", "true");
  await typeNote(p, "No — retry must reuse the same link");
  ok(w, "say", "auth-retry", "Understood, I will correct it");
  ok(w, "discard", "auth-retry");
  ok(w, "add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(cardPath(w, "auth-retry"));
  const entries = thread(p).locator("[data-entry]");
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(thread(p).getByText(/proposed again/)).toHaveCount(1);
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(article(p)).toContainText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4", async ({ page: p }) => {
  const w = await project();
  ok(w, "add", "cache-ttl", "--title", "The cache keeps entries for 60 seconds", "--parent", "root");
  await p.goto(cardPath(w, "cache-ttl"));
  await typeNote(p, "Why 60 seconds?");
  ok(w, "discard", "cache-ttl");
  expect(ok(w, "inbox")).toMatch(/cache-ttl[\s\S]*Why 60 seconds\?/);
  ok(w, "add", "cache-ttl", "--title", "The cache keeps entries for 30 seconds", "--parent", "root");
  await p.goto(cardPath(w, "cache-ttl"));
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org" });
  chat(w, "rfc", [{ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "The client MAY retry." }]);
  // An excerpt can only come from a quote; seed the quote event as an existing map would hold it.
  w.seed("node.added", { id: "retry", kind: "card", title: "Retry", parent: "root" });
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry.",
    card: "retry",
    conversation: "rfc",
    session: "s1",
    message: 0,
    start: 0,
    end: 21,
    speaker: "person",
    said_at: "t1",
  });
  expect(ok(w, "show", "src-rfc-quote")).toContain("excerpt");
  const run = w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(run.code).toBe(0);
  await p.goto(cardPath(w, "src-rfc-quote"));
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});

// ---------- 15 ----------

function card(w: Werk, id: string, body: string, extra: object = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, body, parent: "root", ...extra });
}
const body = (p: Page) => p.locator('[data-field="body"]');

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", "Every change is a diff.");
  card(w, "align", "Align.");
  card(w, "notes-test", "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.");
  await p.goto(cardPath(w, "notes-test"));
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const a of await body(p).locator('a[href="/map/al-diff"]').all()) {
    const font = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(article(p)).toHaveAttribute("data-card", "al-diff");
});

test("15.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", "Every change is a diff.");
  card(
    w,
    "guards",
    [
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
      "and #al-diff on its own",
    ].join("\n"),
  );
  await p.goto(cardPath(w, "guards"));
  const b = body(p);
  for (const text of ["--al-diff", "##al-diff", "&al-diff"]) {
    const para = b.locator("p", { hasText: text });
    await expect(para.first()).toBeVisible();
    await expect(para.first().locator("a")).toHaveCount(0);
  }
  const code = b.locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveCount(1);
  await expect(code.locator("a")).toHaveCount(0);
  const missing = b.locator("p", { hasText: "see #no-such-card" });
  await expect(missing).toHaveText("see #no-such-card");
  await expect(missing.locator("a")).toHaveCount(0);
  const url = b.locator("p", { hasText: "visit" });
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = b.locator("h1, h2, h3, h4, h5, h6", { hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading.locator("a")).toHaveCount(0);
  const own = b.locator("p", { hasText: "on its own" });
  await expect(own.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("15.3", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", "x");
  const long = `${"x".repeat(400)} #al-diff`;
  card(
    w,
    "code-sample",
    [
      "```zsh",
      "echo $HOME | grep -v x # #al-diff",
      "```",
      "",
      "```TypeScript",
      "const n: number = 1",
      "```",
      "",
      "```cobol",
      "DISPLAY 'HELLO'.",
      "```",
      "",
      "```",
      long,
      "```",
    ].join("\n"),
  );
  await p.setViewportSize({ width: 800, height: 900 });
  await p.goto(cardPath(w, "code-sample"));
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const zsh = boxes.nth(0);
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  expect(await zsh.locator("[class^='tok-'], [class*=' tok-']").count()).toBeGreaterThan(0);
  const ts = boxes.nth(1);
  const kwColour = await ts.getByText("const", { exact: true }).evaluate((el) => getComputedStyle(el).color);
  const nColour = await ts.locator("code").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (/\bn\b/.test(t.textContent ?? "")) return getComputedStyle(t.parentElement as Element).color;
    }
    return "";
  });
  expect(kwColour).not.toBe(nColour);
  const cobol = boxes.nth(2);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  expect(await cobol.locator("[class^='tok-'], [class*=' tok-']").count()).toBe(0);
  const pre = boxes.nth(3).locator("pre");
  const scroll = await pre.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(scroll.sw).toBeGreaterThan(scroll.cw);
  const page = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: window.innerWidth }));
  expect(page.sw).toBeLessThanOrEqual(page.cw);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~");
  await p.goto(cardPath(w, "unsafe"));
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong, b", { hasText: "bold" })).toHaveCount(1);
  await expect(body(p).locator("del, s, strike", { hasText: "gone" })).toHaveCount(1);
});

test("15.5", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", "x");
  card(w, "old-idea", "y");
  ok(w, "remove", "old-idea", "--actor", "you");
  w.seed("node.added", { id: "tile-card", kind: "card", title: "Depends on #al-diff", parent: "root" });
  await p.goto(`${w.url}/map`);
  // The chat pane: a text box to send a chat message.
  const input = p.getByRole("textbox", { name: /chat|message/i });
  await expect(input).toHaveCount(1, { timeout: 5000 });
});
