// Held-out browser steps: 06.2, 08.1 (map view), 10.x, 15.x. A real werk server on a fresh project.
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
  log: string;
  werk(...args: string[]): { code: number | null; out: string; err: string };
  ok(...args: string[]): string;
  seed(type: string, payload: object, actor?: string): void;
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
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const count = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object, actor = "you") =>
    appendFileSync(log, `${JSON.stringify({ seq: count() + 1, at: "2026-10-25T10:00:00.000Z", actor, type, payload })}\n`);
  const werk = (...args: string[]) => {
    const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env: env(), encoding: "utf8" });
    return { code: run.status, out: run.stdout, err: run.stderr };
  };
  const ok = (...args: string[]) => {
    const run = werk(...args);
    if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
    return run.out;
  };
  seed("node.added", { id: "root", kind: "card", title: "Root" });
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
  server = proc;
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    let err = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    proc.on("exit", (code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
  });
  return { dir, url, log, werk, ok, seed };
}

function decided(w: Werk, id: string, title: string, parent = "root", body?: string) {
  w.seed("node.added", { id, kind: "card", title, parent, ...(body === undefined ? {} : { body }) });
  w.seed("node.decided", { id });
}

async function typeNote(p: Page, text: string) {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}
const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

function chat(w: Werk, name: string, text: string) {
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(w.dir, ".werk", "chats", `${name}.jsonl`),
    `${JSON.stringify({ speaker: "agent", at: "2026-10-25T09:00:00Z", session: "s1", kind: "spoken", text })}\n`,
  );
}

// ---------- 06.2 ----------
test("06.2", async ({ page: p }) => {
  const w = await project();
  w.ok("add", "log-model", "--title", "The map is one append-only log", "--parent", "root");
  chat(w, "c1", "we keep one log per conversation and never rewrite it");
  w.ok("quote", "log-model", "c1", "one log per conversation");
  await p.goto(`${w.url}/map/log-model:ex0`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  // The person gives the excerpt the ✓ in the map.
  await p.getByRole("button", { name: /✓|accept/i }).click({ timeout: 5000 });
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/log-model`);
  await expect(p.locator("#card")).toContainText("one log per conversation");
  expect(w.ok("show", "log-model")).not.toMatch(/supported_by.*held/);
});

// ---------- 08.1 map view ----------
test("08.1 map view", async ({ page: p }) => {
  const w = await project();
  decided(w, "auth", "Auth");
  decided(w, "login", "Login", "auth");
  decided(w, "session", "Session", "auth");
  w.ok("remove", "auth", "--actor", "you");
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#card")).not.toContainText("#auth");
  for (const id of ["auth", "login", "session"]) {
    await p.goto(`${w.url}/map/${id}`);
    await expect(p.locator("[data-missing]")).toBeVisible();
  }
  w.ok("restore", "auth", "--actor", "you");
  await p.goto(`${w.url}/map/auth`);
  const sub = p.locator('[data-section="subcards"]');
  await expect(sub.locator('a[href="/map/login"]')).toHaveCount(1);
  await expect(sub.locator('a[href="/map/session"]')).toHaveCount(1);
});

// ---------- 10 ----------
test("10.1", async ({ page: p }) => {
  const w = await project();
  decided(w, "auth-login", "Login uses magic links");
  w.ok("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("10.2", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);
  const all = w.ok("inbox");
  const entries = [...all.matchAll(/^\[(\d+)\] #(\S+).*\n\s+(.+)$/gm)].map(([, seq, id, text]) => ({ seq, id, text }));
  expect(entries.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(entries.every((e) => e.id === "auth-login" && /^\d+$/.test(e.seq ?? ""))).toBe(true);
  const first = entries[0]?.seq as string;
  const since = w.ok("inbox", "--since", first);
  expect(since).not.toMatch(/^\s+first$/m);
  for (const t of ["second", "third", "fourth"]) expect(since).toMatch(new RegExp(`^\\s+${t}$`, "m"));
  const capped = w.ok("inbox", "--since", first, "-n", "2");
  const texts = [...capped.matchAll(/^\s+(\S+)$/gm)].map((m) => m[1]);
  expect(texts).toEqual(["second", "third"]);
});

test("10.3", async ({ page: p }) => {
  const w = await project();
  w.ok("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.ok("say", "auth-retry", "Understood, I will correct it");
  w.ok("discard", "auth-retry");
  w.ok("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(entries).toHaveCount(3);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4", async ({ page: p }) => {
  const w = await project();
  w.ok("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.ok("discard", "cache-ttl");
  expect(w.ok("inbox")).toMatch(/#cache-ttl[^\n]*\n\s+Why 60 seconds\?/);
  w.ok("add", "cache-ttl", "--title", "The cache keeps an entry for 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toHaveAttribute("data-entry", "marker");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
});

test("10.5", async ({ page: p }) => {
  const w = await project();
  w.ok("add", "retry", "--title", "Retry the request once", "--parent", "root");
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  // The excerpt #src-rfc-quote is part of the given map, written as the quote event that makes one.
  w.seed(
    "excerpt.quoted",
    {
      id: "src-rfc-quote",
      title: "The client MAY retry the request.",
      card: "retry",
      conversation: "rfc-read",
      session: "s1",
      message: 0,
      start: 0,
      end: 33,
      speaker: "agent",
      said_at: "2026-10-25T09:00:00Z",
    },
    "agent",
  );
  w.ok("show", "src-rfc-quote");
  const run = w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(run.code).toBe(0);
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});

// ---------- 15 ----------
test("15.1", async ({ page: p }) => {
  const w = await project();
  decided(w, "al-diff", "Every proposed change is a diff");
  decided(w, "align", "Align");
  decided(w, "notes-test", "Notes test", "root", "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.");
  await p.goto(`${w.url}/map/notes-test`);
  const body = p.locator('[data-field="body"]');
  const links = body.locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const code of await body.locator('a[href="/map/al-diff"]').all())
    expect(await code.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily)).toMatch(/mono/i);
  const prose = await body.locator("p").evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toBe("See , then , then , then , and  too.");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every proposed change is a diff");
});

test("15.2", async ({ page: p }) => {
  const w = await project();
  decided(w, "al-diff", "Every proposed change is a diff");
  const text = [
    "--al-diff", "", "##al-diff", "", "&al-diff", "",
    "a code span holding `node src/cli.ts show #al-diff`", "",
    "see #no-such-card", "", "visit https://example.com/page#al-diff", "",
    "# al-diff", "", "And #al-diff on its own.",
  ].join("\n");
  decided(w, "guards", "Guards", "root", text);
  await p.goto(`${w.url}/map/guards`);
  const body = p.locator('[data-field="body"]');
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card", "visit https://example.com/page#al-diff"]) {
    const para = body.locator("p").filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = body.locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveText("node src/cli.ts show #al-diff");
  await expect(cmd.locator("a")).toHaveCount(0);
  await expect(body.locator("h1")).toHaveText("al-diff");
  await expect(body.locator("h1 a")).toHaveCount(0);
  const links = body.locator("a");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "/map/al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const w = await project();
  decided(w, "al-diff", "Every proposed change is a diff");
  const text = [
    "```zsh", "echo $HOME | grep -v x #al-diff", "```", "",
    "```TypeScript", "const n: number = 1 // #al-diff", "```", "",
    "```cobol", "DISPLAY 'HELLO'. #al-diff", "```", "",
    "```", `${"x".repeat(300)} #al-diff`, "```",
  ].join("\n");
  decided(w, "code-sample", "Code sample", "root", text);
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = p.locator('[data-field="body"] .codebox');
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [0, 1, 2, 3].map((i) => boxes.nth(i));
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  const shell = await zsh.locator("code span").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const kw = ts.locator("code span").filter({ hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const kwColour = await kw.evaluate((el) => getComputedStyle(el).color);
  const nameColour = await ts.locator("code").evaluate((el) => getComputedStyle(el).color);
  expect(kwColour).not.toBe(nameColour);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  const cobolColours = await cobol.locator("code, code *").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);
  const sc = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(sc.inner).toBeGreaterThan(sc.outer);
  const pw = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pw.s).toBeLessThanOrEqual(pw.c);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  decided(w, "unsafe", "Unsafe", "root", "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~");
  await p.goto(`${w.url}/map/unsafe`);
  const body = p.locator('[data-field="body"]');
  await expect(body).toContainText("<script>window.__pwned = true</script>");
  await expect(body.locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body.locator("strong")).toHaveText("bold");
  await expect(body.locator("strong")).toHaveCSS("font-weight", "700");
  await expect(body.locator("del")).toHaveText("gone");
  await expect(body.locator("del")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5", async ({ page: p }) => {
  const w = await project();
  decided(w, "al-diff", "Every proposed change is a diff");
  decided(w, "old-idea", "An old idea");
  w.ok("remove", "old-idea", "--actor", "you");
  w.seed("node.added", { id: "tile-card", kind: "card", title: "Tile card", parent: "root", body: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);
  // The person sends a chat message in the pane.
  const input = p.getByRole("textbox", { name: /chat|message/i });
  await input.fill("Compare #al-diff with #old-idea and show code", { timeout: 5000 });
});
