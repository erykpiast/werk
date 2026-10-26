// Held-out browser steps 06, 10, 13.3-13.5, 15.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

function card(w: Werk, id: string, fields: { title?: string; why?: string; body?: string } = {}): void {
  w.seed("node.added", { id, kind: "card", title: fields.title ?? id, parent: "root", ...fields });
}

// ---------- 06 ----------
async function decidedWithChat(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", why: "Seats scale", parent: "root" });
  w.seed("node.decided", { id: "billing" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}
const evidence = (p: Page) => p.locator('[data-section="evidence"] [data-link="supported_by"]');

test("06.1", async ({ page: p }) => {
  const w = await decidedWithChat();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  await p.goto(`${w.url}/map/billing`);
  const row = evidence(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row.locator('[data-mark="pending"]')).toHaveText("pending");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-field="why"]')).toContainText("Seats scale");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await row.getByRole("link").click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();
});

test("06.2", async ({ page: p }) => {
  const w = await decidedWithChat();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing`);
  await evidence(p).getByRole("link").click();
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/billing`);
  const row = evidence(p);
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "false");
  await expect(row.locator('[data-mark="pending"]')).toHaveCount(0);
});

// ---------- 10 ----------
test("10.1", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("10.2", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);
  const entries = (out: string) =>
    [...out.matchAll(/^\[(\d+)\] #(\S+)\s.*\n\s+(\S+)$/gm)].map(([, seq, id, text]) => ({ seq, id, text }));
  const all = entries(w.werk("inbox"));
  expect(all.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(all.every((e) => e.id === "auth-login" && /^\d+$/.test(e.seq))).toBe(true);
  const first = all[0]?.seq as string;
  expect(entries(w.werk("inbox", "--since", first)).map((e) => e.text)).toEqual(["second", "third", "fourth"]);
  expect(entries(w.werk("inbox", "--since", first, "-n", "2")).map((e) => e.text)).toEqual(["second", "third"]);
});

test("10.3", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
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
  await expect(thread(p).locator("[data-entry]", { hasText: "proposed again" })).toHaveCount(1);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://example.com/rfc" });
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry the request.",
    card: "root",
    conversation: "oauth",
    session: "s1",
    message: 0,
    start: 0,
    end: 33,
    speaker: "person",
    said_at: "t0",
  });
  w.werk("say", "src-rfc-quote", "This quote supports the retry decision"); // throws on non-zero exit
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});

// ---------- 13 ----------
test("13.3", async ({ browser }) => {
  const w = await project();
  card(w, "first", { title: "First card" });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    const g = globalThis as unknown as { __changed: string[]; __open: number; EventSource: typeof EventSource };
    g.__changed = [];
    g.__open = 0;
    const Orig = g.EventSource;
    g.EventSource = class extends Orig {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("open", () => g.__open++);
        this.addEventListener("changed", (e) => g.__changed.push((e as MessageEvent).data));
      }
    };
  });
  const tabs = [await ctx.newPage(), await ctx.newPage()];
  for (const t of tabs) {
    await t.goto(`${w.url}/map`);
    await expect(t.locator('a[data-tile="first"]')).toBeVisible();
    await expect.poll(() => t.evaluate(() => (globalThis as unknown as { __open: number }).__open)).toBe(1);
  }
  w.werk("add", "second", "--title", "Second card", "--parent", "root");
  for (const t of tabs) {
    await expect(t.locator('a[data-tile="second"]')).toBeVisible();
    await expect(t.locator('a[data-tile="first"]')).toBeVisible();
    const got = await t.evaluate(() => (globalThis as unknown as { __changed: string[] }).__changed);
    expect(got).toHaveLength(1);
    expect(got[0]).toBe("");
  }
  await ctx.close();
});

test("13.4", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.added", { id: "first", kind: "card", title: "First card", parent: "root" });
    down.werk("add", "second", "--title", "Second card title", "--why", "Second why text", "--body",
      "Second body text here", "--parent", "root");
  });
  await p.goto(`${w.url}/map`);
  await expect(p.locator('a[data-tile="first"]')).toContainText("First card");
  await expect(p.locator('a[data-tile="second"]')).toContainText("Second card title");
  await expect(p.locator("body")).not.toContainText("Second body text here");
  await p.locator('a[data-tile="second"]').click();
  await expect(p.locator('[data-field="body"]')).toHaveText("Second body text here");
  await expect(p.locator('[data-field="why"]')).toContainText("Second why text");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Root");
});

function send(url: string, path: string, o: { method?: string; host?: string; token?: string; body?: string } = {}) {
  const { port } = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: o.method ?? "GET",
        headers: {
          host: o.host ?? `localhost:${port}`,
          "content-type": "application/json",
          ...(o.token === undefined ? {} : { "x-werk-token": o.token }),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c: Buffer) => {
          b += c.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", reject);
    req.end(o.body);
  });
}

test("13.5", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/retry`);
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(w.url, "/api/accept", write)).status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect((await send(w.url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/retry");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "retry", title: "Retry sends a new link" });
});

// ---------- 15 ----------
test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Al diff card" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  const al = body(p).locator('a[href="/map/al-diff"]');
  await expect(al).toHaveCount(4);
  for (const a of await al.all())
    expect(await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily)).toContain(
      "monospace",
    );
  await expect(body(p).locator('a[href="/map/align"]')).toHaveText("#align");
  const prose = await body(p)
    .locator("p")
    .evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement;
      for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
      return c.textContent ?? "";
    });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Al diff card");
});

test("15.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  const lines = [
    "--al-diff",
    "##al-diff",
    "&al-diff",
    "a code span holding `node src/cli.ts show #al-diff`",
    "see #no-such-card",
    "visit https://example.com/page#al-diff",
    "# al-diff",
    "Then #al-diff alone.",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toContainText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "visit" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const alone = body(p).locator("p").filter({ hasText: "alone" }).locator("a");
  await expect(alone).toHaveAttribute("href", "/map/al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"x".repeat(400)}`, "see #al-diff", "```"],
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const shell = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const kw = ts.locator("code span", { hasText: /^const$/ }).first();
  await expect(kw).toHaveText("const");
  const nameColour = await ts.locator("code").evaluate((code) => {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode())
      if (/\bn\b/.test(n.textContent ?? "") && !/const|number/.test(n.textContent ?? ""))
        return getComputedStyle(n.parentElement as Element).color;
    return "none";
  });
  expect(await colour(kw)).not.toBe(nameColour);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const sc = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(sc.inner).toBeGreaterThan(sc.outer);
  const pg = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(pg.scroll).toBeLessThanOrEqual(pg.client);
  await expect(boxes.locator("a")).toHaveCount(0);
  await expect(plain.locator("code")).toContainText("#al-diff");
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong, b")).toHaveText("bold");
  expect(Number(await body(p).locator("strong, b").evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(body(p).locator("del, s")).toHaveText("gone");
  await expect(body(p).locator("del, s")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5", async ({ page: p }) => {
  const head = 'Here:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            stream({ type: "message_start", message: { id: "msg-1" } }),
            stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
            { pause: 2000 },
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
            { event: { type: "assistant", message: { id: "msg-1", content: [{ type: "text", text: head + tail }] } } },
          ],
        ],
      },
    },
  });
  card(w, "al-diff");
  card(w, "old-idea");
  w.seed("node.removed", { id: "old-idea" });
  card(w, "tile-card", { title: "A tile", why: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine).toContainText("#old-idea");
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  const code = reply.locator(".codebox code");
  await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const spans = await code.locator("span").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(spans).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("A tile");
});
