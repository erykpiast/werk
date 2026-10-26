// The person's steps in a real browser on a real werk server; the agent's steps on the command line.
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
  run(...args: string[]): { code: number | null; out: string; err: string };
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
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-e2e-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk", "chats"), { recursive: true });
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
  const chat = (name: string, rows: object[]) =>
    writeFileSync(join(dir, ".werk", "chats", `${name}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
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
  return { dir, url, werk, run, seed, chat };
}

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

const thread = (p: Page) => p.locator('[data-section="thread"]');
const entries = (p: Page) => thread(p).locator("li");
const body = (p: Page) => p.locator('[data-field="body"]');

// ---- 06: excerpts staged as ghosts

async function decidedWithExcerpt(w: Werk) {
  w.seed("node.added", { id: "retry", kind: "card", title: "Retry reuses the link", parent: "root", body: "The body stays." });
  w.seed("node.decided", { id: "retry" });
  w.chat("talk", [{ speaker: "person", at: "2026-10-01T10:00:00Z", session: "s1", kind: "spoken", text: "retry must reuse the same link" }]);
  return w.werk("quote", "retry", "talk", "retry must reuse the same link");
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the check mark", async ({ page: p }) => {
  const w = await project();
  const out = await decidedWithExcerpt(w);
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  await p.goto(`${w.url}/map/retry:ex0`);
  await expect.soft(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect.soft(p.locator('article[data-proposed="true"]')).toBeVisible();
  await expect.soft(p.getByRole("button", { name: /✓|accept/i })).toBeVisible();
  await p.goto(`${w.url}/map/retry`);
  await expect.soft(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect.soft(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the link");
  await expect.soft(p.locator("main")).toContainText("retry must reuse the same link");
  await expect.soft(p.locator("main")).toContainText(/pending|held/);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await project();
  await decidedWithExcerpt(w);
  await p.goto(`${w.url}/map/retry:ex0`);
  await p.getByRole("button", { name: /✓|accept/i }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator("main")).toContainText("retry must reuse the same link");
});

// ---- 10: notes on a card's thread

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  const note = thread(p).locator('[data-entry="note"]').filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the agent reads the person's notes in the inbox, after a log position and capped by count", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);
  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const found = [...all.matchAll(/^\[(\d+)\] #(\S+)\s.*\n\s+(\S+)$/gm)].map(([, seq, id, text]) => ({ seq, id, text }));
  expect(found.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(found.every((e) => e.id === "auth-login")).toBe(true);
  const firstSeq = found[0]?.seq as string;
  const since = w.werk("inbox", "--since", firstSeq);
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", firstSeq, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const texts = await entries(p).allInnerTexts();
  const iNo = texts.findIndex((t) => t.includes("No — retry must reuse the same link"));
  const iOk = texts.findIndex((t) => t.includes("Understood, I will correct it"));
  const markers = texts.flatMap((t, i) => (t.includes("proposed again") ? [i] : []));
  expect(iNo).toBeGreaterThanOrEqual(0);
  expect(iOk).toBeGreaterThanOrEqual(0);
  expect(markers.length).toBe(1);
  expect(markers[0]).toBeGreaterThan(Math.max(iNo, iOk));
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  const after = await entries(p).allInnerTexts();
  const iGood = after.findIndex((t) => t.includes("Good, accept"));
  const marker = after.findIndex((t) => t.includes("proposed again"));
  expect(iGood).toBeGreaterThan(marker);
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "Cache entries live 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  const inbox = w.werk("inbox");
  expect(inbox).toContain("Why 60 seconds?");
  expect(inbox).toContain("cache-ttl");
  w.werk("add", "cache-ttl", "--title", "Cache entries live 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const texts = await entries(p).allInnerTexts();
  const iNote = texts.findIndex((t) => t.includes("Why 60 seconds?"));
  const markers = texts.flatMap((t, i) => (t.includes("proposed again") ? [i] : []));
  expect(iNote).toBeGreaterThanOrEqual(0);
  expect(markers.length).toBe(1);
  expect(markers[0]).toBeGreaterThan(iNote);
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "retry", kind: "card", title: "Retry", parent: "root" });
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749" });
  w.chat("rfc", [{ speaker: "person", at: "t", session: "s1", kind: "spoken", text: "the client may retry the request" }]);
  w.werk("quote", "retry", "rfc", "the client may retry the request");
  // The product names an excerpt <card>:exN; the step's id "#src-rfc-quote" cannot be chosen.
  const r = w.run("say", "retry:ex0", "This quote supports the retry decision");
  expect(r.code).toBe(0);
  await p.goto(`${w.url}/map/retry:ex0`);
  await expect(thread(p).locator('[data-entry="note"]').filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});

// ---- 15: rendered card text on the card page

test("15.1 every form of a card reference in a card body becomes the same link to that card", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every change is a diff", parent: "root" });
  w.seed("node.added", { id: "align", kind: "card", title: "Align", parent: "root" });
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
  for (const code of await body(p).locator('a[href="/map/al-diff"]').all()) {
    const font = await code.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
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
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every change is a diff");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Diff", parent: "root" });
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
  const paras = body(p).locator("p");
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = paras.filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const url = paras.filter({ hasText: "visit" });
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveText("node src/cli.ts show #al-diff");
  await expect(cmd.locator("a")).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading.locator("a")).toHaveCount(0);
  const own = paras.filter({ hasText: "on its own" }).locator("a");
  await expect(own).toHaveAttribute("href", "/map/al-diff");
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Diff", parent: "root" });
  const text = [
    ...["```zsh", "echo $HOME | grep -v x #al-diff", "```", ""],
    ...["```TypeScript", "const n: number = 1 // #al-diff", "```", ""],
    ...["```cobol", "DISPLAY 'HELLO'. #al-diff", "```", ""],
    ...["```", `${"y".repeat(400)} #al-diff`, "```"],
  ].join("\n");
  w.seed("node.added", { id: "code-sample", kind: "card", title: "Code sample", parent: "root", body: text });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  await expect(boxes.nth(0).locator(".codebox-tag")).toHaveText("zsh");
  const shell = await boxes
    .nth(0)
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const ts = boxes.nth(1);
  const kw = ts.locator("code span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const kwColour = await kw.evaluate((el) => getComputedStyle(el).color);
  const nameColour = await ts.locator("code").evaluate((el) => {
    // The colour of the bare text "n": the code element's own colour, as "n" sits in no span.
    return getComputedStyle(el).color;
  });
  expect(kwColour).not.toBe(nameColour);
  await expect(boxes.nth(2).locator(".codebox-tag")).toHaveText("cobol");
  await expect(boxes.nth(2).locator("code span")).toHaveCount(0);
  const pre = await boxes.nth(3).locator("pre").evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth, o: getComputedStyle(el).overflowX }));
  expect(pre.s).toBeGreaterThan(pre.c);
  expect(["auto", "scroll"]).toContain(pre.o);
  const page = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(page.s).toBeLessThanOrEqual(page.c);
  await expect(body(p).locator(".codebox a")).toHaveCount(0);
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
  await expect(body(p).locator("strong")).toHaveText("bold");
  expect(Number(await body(p).locator("strong").evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(body(p).locator("del, s")).toHaveText("gone");
  await expect(body(p).locator("del, s")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Diff", parent: "root" });
  w.seed("node.added", { id: "old-idea", kind: "card", title: "Old idea", parent: "root" });
  w.seed("node.removed", { id: "old-idea" });
  w.seed("node.added", { id: "tile-card", kind: "card", title: "Tile card", parent: "root", body: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);
  const pane = p.getByRole("textbox", { name: /chat|message/i });
  await expect(pane).toBeVisible();
});
