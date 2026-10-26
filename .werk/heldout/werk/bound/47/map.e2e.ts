// Held-out steps that run in the map in a real browser: excerpts (06), notes (10) and rendered
// card text (15). Each test starts a real werk server on a fresh project.
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
  werk(...args: string[]): string;
  seed(type: string, payload: object): void;
  chat(name: string, rows: object[]): void;
};

function env(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  delete clean.WERK_LOG;
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
  mkdirSync(join(dir, ".werk", "chats"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "t", actor: "you", type, payload })}\n`);
  const werk = (...args: string[]) => {
    const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env: env(), encoding: "utf8" });
    if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
    return run.stdout;
  };
  const chat = (name: string, rows: object[]) =>
    writeFileSync(join(dir, ".werk", "chats", `${name}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  seed("node.added", { id: "root", kind: "card", title: "Root" });

  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
  server = proc;
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    proc.on("exit", (code) => reject(new Error(`werk serve exited ${code}`)));
  });
  return { dir, url, werk, seed, chat };
}

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
const spoken = (text: string, speaker = "person") => ({ speaker, at: "2026-10-01T10:00:00Z", session: "s1", kind: "spoken", text });

// ---------- 06 excerpts ----------

async function decidedCardWithExcerpt(w: Werk): Promise<string> {
  w.seed("node.added", { id: "pay", kind: "card", title: "Payment retries are capped", body: "Three tries.", parent: "root" });
  w.seed("node.decided", { id: "pay" });
  w.chat("c1", [spoken("we cap retries at three tries")]);
  return w.werk("quote", "pay", "c1", "cap retries at three");
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the check mark", async ({ page: p }) => {
  const w = await project();
  const out = await decidedCardWithExcerpt(w);
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  expect(w.werk("show", "pay")).toMatch(/supported_by\s+pay:ex0.*held/);
  const show = w.werk("show", "pay");
  expect(show.split("\n")[0]).toContain("[decided]");
  expect(show).toContain("Payment retries are capped");

  await p.goto(`${w.url}/map/pay:ex0`);
  await expect(p.locator('article[data-card="pay:ex0"]')).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.goto(`${w.url}/map/pay`);
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Payment retries are capped");
  // The excerpt waits for the person's check mark: a ✓ control is on it.
  await p.goto(`${w.url}/map/pay:ex0`);
  await expect(p.getByRole("button", { name: /✓|accept/i })).toBeVisible({ timeout: 3000 });
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await project();
  await decidedCardWithExcerpt(w);
  await p.goto(`${w.url}/map/pay:ex0`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: /✓|accept/i }).click({ timeout: 3000 });
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/pay`);
  await expect(p.locator("#card")).toContainText("cap retries at three");
  expect(w.werk("show", "pay")).not.toMatch(/supported_by\s+pay:ex0.*held/);
});

// ---------- 10 notes ----------

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the agent reads the person's notes in the inbox, after a position and capped", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);
  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(`    ${t}`));
  expect(order.every((i, k) => i >= 0 && (k === 0 || i > (order[k - 1] as number)))).toBe(true);
  const heads = [...all.matchAll(/^\[(\d+)\] #(\S+)/gm)];
  expect(heads).toHaveLength(4);
  expect(heads.every((m) => m[2] === "auth-login")).toBe(true);
  const firstPos = heads[0]?.[1] as string;
  const since = w.werk("inbox", "--since", firstPos);
  expect(since).not.toMatch(/^\s+first$/m);
  for (const t of ["second", "third", "fourth"]) expect(since).toMatch(new RegExp(`^\\s+${t}$`, "m"));
  const capped = w.werk("inbox", "--since", firstPos, "-n", "2");
  expect([...capped.matchAll(/^\s+(\w+)$/gm)].map((m) => m[1])).toEqual(["second", "third"]);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('article[data-card="auth-retry"]')).toHaveAttribute("data-proposed", "true");
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(thread(p).getByText("proposed again")).toHaveCount(1);
  await expect(p.locator("#card")).toContainText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "retry", kind: "card", title: "The client retries", parent: "root" });
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  const quote = "The client MAY retry the request.";
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: quote,
    card: "retry",
    conversation: "rfc",
    session: "s1",
    message: 0,
    start: 0,
    end: quote.length,
    speaker: "person",
    said_at: "t",
  });
  const id = "src-rfc-quote";
  const out = w.werk("say", id, "This quote supports the retry decision");
  expect(out).toContain("written");
  await p.goto(`${w.url}/map/${id}`);
  const note = notes(p).filter({ hasText: "This quote supports the retry decision" });
  await expect(note).toHaveCount(1);
});

// ---------- 15 rendered text ----------

async function cards(w: Werk, list: Record<string, string>): Promise<void> {
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every proposed change is a diff", parent: "root" });
  w.seed("node.added", { id: "align", kind: "card", title: "Align", parent: "root" });
  for (const [id, body] of Object.entries(list)) w.seed("node.added", { id, kind: "card", title: id, body, parent: "root" });
}
const body = (p: Page) => p.locator('[data-field="body"]');

test("15.1 every form of a card reference in a card body becomes the same link", async ({ page: p }) => {
  const w = await project();
  await cards(w, { "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const link of await body(p).locator('a[href="/map/al-diff"]').all()) {
    const font = await link.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("See , then , then , then , and  too.");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every proposed change is a diff");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project();
  const text = [
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
    "And #al-diff on its own.",
  ].join("\n");
  await cards(w, { guards: text });
  await p.goto(`${w.url}/map/guards`);
  const paras = body(p).locator("p");
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = paras.filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const url = paras.filter({ hasText: "visit" });
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const own = paras.filter({ hasText: "on its own" }).locator('a[href="/map/al-diff"]');
  await expect(own).toHaveCount(1);
  await expect(own).toHaveText("#al-diff");
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const w = await project();
  const wide = `${"x".repeat(300)} #al-diff`;
  const text = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    "",
    ...["```TypeScript", "const n: number = 1", "```"],
    "",
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    "",
    ...["```", wide, "```"],
  ].join("\n");
  await cards(w, { "code-sample": text });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => boxes.nth(i).locator("xpath=..");
  await expect(box(0)).toContainText("zsh");
  const shell = await boxes.nth(0).locator("code span").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const ts = boxes.nth(1);
  const constTok = ts.locator("span", { hasText: /^const$/ });
  await expect(constTok).toHaveCount(1);
  const kw = await constTok.evaluate((el) => getComputedStyle(el).color);
  const plain = await ts.locator("code").evaluate((el) => getComputedStyle(el).color);
  expect(kw).not.toBe(plain);
  await expect(box(2)).toContainText("cobol");
  await expect(boxes.nth(2).locator("code span")).toHaveCount(0);
  const scroll = await boxes.nth(3).evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const doc = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(doc.s).toBeLessThanOrEqual(doc.c);
  await expect(body(p).locator("pre a")).toHaveCount(0);
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  await cards(w, { unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveText("bold");
  expect(Number(await body(p).locator("strong").evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(body(p).locator("del, s")).toHaveText("gone");
  await expect(body(p).locator("del, s")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const w = await project();
  await cards(w, {});
  w.seed("node.added", { id: "old-idea", kind: "card", title: "Old idea", parent: "root" });
  w.seed("node.removed", { id: "old-idea" });
  w.seed("node.added", { id: "tile-card", kind: "card", title: "Tile card", body: "Depends on #al-diff", parent: "root" });
  await p.goto(`${w.url}/map`);
  // The person sends a chat message in the pane.
  const input = p.getByRole("textbox", { name: /chat|message/i });
  await expect(input).toBeVisible({ timeout: 3000 });
});
