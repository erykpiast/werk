// Browser scenarios 06.x, 10.x and 15.x against a real werk server on a fresh project. The agent's
// steps run the werk command line; the person's steps run in the page.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

type Werk = {
  dir: string;
  url: string;
  werk(...args: string[]): string;
  run(...args: string[]): { code: number | null; out: string; err: string };
  seed(type: string, payload: object): void;
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

/** A fresh project whose map has a real #root card (the map's home page), and a werk server on it. */
async function project(): Promise<Werk> {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-e2e-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "t", actor: "you", type, payload })}\n`);
  const run = (...args: string[]) => {
    const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env: env(), encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const werk = (...args: string[]) => {
    const r = run(...args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
    return r.out;
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
  return { dir, url, werk, run, seed };
}

function chatLog(w: Werk, name: string, records: object[]): void {
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(w.dir, ".werk", "chats", `${name}.jsonl`),
    `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

const card = (p: Page) => p.locator("#card");
const thread = (p: Page) => p.locator('[data-section="thread"]');
const body = (p: Page) => p.locator('[data-field="body"]');

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

// ---- 06: excerpts and the ✓ ----

async function decidedCardWithExcerpt(w: Werk): Promise<void> {
  w.seed("node.added", { id: "retry", kind: "card", title: "Retry reuses the link", parent: "root" });
  w.seed("node.decided", { id: "retry" });
  chatLog(w, "design", [
    { speaker: "person", at: "2026-10-02T09:14:00.000Z", session: "s-1", kind: "spoken", text: "reuse the same link" },
  ]);
  const out = w.werk("quote", "retry", "design", "reuse the same link");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await project();
  await decidedCardWithExcerpt(w);
  await p.goto(`${w.url}/map/retry:ex0`);
  await expect(card(p).locator('article[data-proposed="true"]')).toBeVisible();
  await expect(card(p).locator('[data-tag="proposed"]')).toBeVisible();
  await p.goto(`${w.url}/map/retry`);
  await expect(card(p).locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the link");
  // The link from the card to the excerpt shows as pending on the card's page.
  await expect(card(p)).toContainText("retry:ex0");
  await expect(card(p).getByText(/pending|proposed|held/)).toBeVisible();
  // The excerpt waits for the ✓: the person has a ✓ control to give.
  await p.goto(`${w.url}/map/retry:ex0`);
  await expect(p.getByRole("button", { name: /✓|accept/i })).toBeVisible({ timeout: 3000 });
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await project();
  await decidedCardWithExcerpt(w);
  await p.goto(`${w.url}/map/retry:ex0`);
  await expect(card(p).locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: /✓|accept/i }).click({ timeout: 3000 });
  await expect(card(p).locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/retry`);
  await expect(card(p)).toContainText("reuse the same link");
  await expect(card(p).getByText(/pending|held/)).toHaveCount(0);
});

// ---- 10: notes on a card's thread ----

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = thread(p)
    .locator('[data-entry="note"]')
    .filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the agent reads the person's notes in the inbox, after a log position and capped by count", async ({
  page: p,
}) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);

  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const firstEntry = /\[(\d+)\][^\n]*#?auth-login[^\n]*\n\s*first/.exec(all) ?? /\[(\d+)\][^\n]*auth-login/.exec(all);
  expect(firstEntry).not.toBeNull();
  for (const t of ["first", "second", "third", "fourth"]) {
    expect(all).toMatch(new RegExp(`\\[\\d+\\][^\\n]*auth-login[^\\n]*\\n\\s*${t}`));
  }
  const pos = firstEntry?.[1] as string;
  const since = w.werk("inbox", "--since", pos);
  expect(since).not.toMatch(/\bfirst\b/);
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", pos, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toMatch(/\bfirst\b/);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({
  page: p,
}) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(card(p).locator('[data-tag="proposed"]')).toBeVisible();
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
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
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
  expect(w.werk("inbox")).toMatch(/cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  // The map holds a source and an excerpt taken from it. An excerpt comes only from a quote, so
  // the excerpt is quoted from a conversation, and its card cites the source.
  w.seed("node.added", {
    id: "src-rfc",
    kind: "source",
    title: "RFC 6749",
    url: "https://www.rfc-editor.org/rfc/rfc6749",
  });
  w.seed("node.added", { id: "src-rfc-card", kind: "card", title: "Retry follows RFC 6749", parent: "root" });
  w.seed("edge.added", { from: "src-rfc-card", to: "src-rfc", type: "supported_by" });
  // The excerpt "#src-rfc-quote" as a quote writes it into the log, quoted for the citing card.
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry the request.",
    card: "src-rfc-card",
    conversation: "rfc",
    session: "s-1",
    message: 0,
    start: 0,
    end: 33,
    speaker: "person",
    said_at: "t1",
  });
  expect(w.werk("show", "src-rfc-quote")).toMatch(/^excerpt src-rfc-quote/);
  const said = w.run("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(said.code).toBe(0);
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(thread(p).getByText("This quote supports the retry decision")).toBeVisible();
});

// ---- 15: rendered card text ----

function knownCards(w: Werk, ids: string[]): void {
  for (const id of ids) w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent: "root" });
}

test("15.1 every form of a card reference in a card body becomes the same link to that card", async ({ page: p }) => {
  const w = await project();
  knownCards(w, ["al-diff", "align"]);
  w.seed("node.added", {
    id: "notes-test",
    kind: "card",
    title: "Notes test",
    parent: "root",
    body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.",
  });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const link of await body(p).locator('a[href="/map/al-diff"]').all()) {
    expect(await link.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily)).toMatch(
      /mono|Menlo|Consolas/i,
    );
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(1);
  const prose = await body(p)
    .locator("p")
    .evaluate((el) => {
      const copy = el.cloneNode(true) as typeof el;
      for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
      return copy.textContent ?? "";
    });
  expect(prose).toBe("See , then , then , then , and  too.");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(card(p)).toHaveAttribute("data-card", "al-diff");
  await expect(card(p).locator("article")).toHaveAttribute("data-card", "al-diff");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project();
  knownCards(w, ["al-diff"]);
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
  w.seed("node.added", { id: "guards", kind: "card", title: "Guards", parent: "root", body: text });
  await p.goto(`${w.url}/map/guards`);
  const paragraphs = body(p).locator("p");
  for (const t of [
    "--al-diff",
    "##al-diff",
    "&al-diff",
    "see #no-such-card",
    "visit https://example.com/page#al-diff",
  ]) {
    const para = paragraphs.filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const links = body(p).locator("a");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "/map/al-diff");
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const w = await project();
  knownCards(w, ["al-diff"]);
  const text = [
    ...["```zsh", "echo $HOME | grep -v x #al-diff", "```"],
    ...["```TypeScript", "const n: number = 1 // #al-diff", "```"],
    ...["```cobol", "DISPLAY 'HELLO'. #al-diff", "```"],
    ...["```", `${"x".repeat(300)} #al-diff`, "```"],
  ].join("\n");
  w.seed("node.added", { id: "code-sample", kind: "card", title: "Code sample", parent: "root", body: text });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => body(p).locator(".codebox").nth(i);
  await expect(box(0)).toContainText("zsh");
  await expect(box(0).locator("pre")).toContainText("echo $HOME | grep -v x");
  const shellColours = await box(0)
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(2);
  const kw = box(1).locator("code span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const kwColour = await kw.evaluate((el) => getComputedStyle(el).color);
  const nameColour = await box(1)
    .locator("code")
    .evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if (/\bn\b/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
      }
      return "";
    });
  expect(nameColour).not.toBe("");
  expect(kwColour).not.toBe(nameColour);
  await expect(box(2)).toContainText("cobol");
  const cobolColours = await box(2)
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);
  const scroll = await box(3)
    .locator("pre")
    .evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const pageWidth = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client);
  await expect(body(p).locator("pre a")).toHaveCount(0);
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", {
    id: "unsafe",
    kind: "card",
    title: "Unsafe",
    parent: "root",
    body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~",
  });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).getByText("bold", { exact: true });
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).getByText("gone", { exact: true });
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const w = await project();
  knownCards(w, ["al-diff", "old-idea"]);
  w.werk("remove", "old-idea", "--actor", "you");
  // The tile shows a card's title, so the summary is the card's title here.
  w.seed("node.added", { id: "tile-card", kind: "card", title: "Depends on #al-diff", parent: "root" });

  await p.goto(`${w.url}/map`);
  const tile = card(p).locator('[data-section="subcards"] a[href="/map/tile-card"]');
  const tileText = (await tile.textContent())?.replace(/\s+/g, " ").trim() ?? "";
  const tileLinks = await tile.locator("a").count();
  console.log(`tile text: "${tileText}", links inside: ${tileLinks}`);

  // The person sends a chat message in the pane.
  const input = p.getByRole("textbox", { name: /chat|message/i });
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.fill("Compare #al-diff with #old-idea and show code");
  await input.press("Enter");
  const mine = p.locator("[data-role=user], .msg.user").last();
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine.locator("a", { hasText: "old-idea" })).toHaveCount(0);

  expect(tileText).toContain("Depends on #al-diff");
  expect(tileLinks).toBe(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});
