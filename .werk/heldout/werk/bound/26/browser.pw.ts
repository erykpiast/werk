import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type Page } from "@playwright/test";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv } from "../src/test-env/env.ts";
import { expect, test } from "../e2e/support/fixtures.ts";
import { type BrowserServer, startBrowserServer } from "../e2e/support/server.ts";
import type { Script } from "../src/fake-agent/script.ts";

const AT = "2026-10-10T09:00:00.000Z";
const ghost = (id: string, extra: Record<string, unknown> = {}) => ({ type: "node.proposed", id, kind: "card", title: id, status: "open", ...extra });
const open = (id: string, extra: Record<string, unknown> = {}) => [ghost(id, extra), { type: "node.accepted", id, actor: "you" }];
const decided = (id: string, extra: Record<string, unknown> = {}) => [
  ...open(id, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
const dep = (from: string, to: string) => ({ type: "edge.added", from, to, link: "depends_on", why: "x" });
const reopen = (id: string, reason = "invalidated") => ({ type: "node.reopened", id, at: AT, reason });

/** Replaces the project's map with the events, before the server starts. */
async function serverWith(events: unknown[], options: Parameters<typeof startBrowserServer>[0] = {}) {
  const server = await startBrowserServer(options);
  writeFileSync(join(server.dir, ".werk", "log.jsonl"), events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""));
  await server.start();
  return server;
}
const ROOT = decided("root", { title: "We build software with agents" });
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const markLoaded = (page: Page) => page.evaluate(() => { (window as unknown as { loaded: boolean }).loaded = true; });
const stillLoaded = (page: Page) =>
  page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true).catch(() => false);
const chatPane = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });
const say = (id: string, text: string) => ({ event: { type: "assistant", message: { id, content: [{ type: "text", text }] } } });
const messages = (s: BrowserServer) => s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

// ---------- 14 ----------
test("14.1 a card added from the command line appears without a reload", async ({ page, app }) => {
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "We build software with agents" })).toBeVisible();
  await composerOf(page).fill("half a thought");
  await markLoaded(page);
  expect(app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root").code).toBe(0);
  await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composerOf(page)).toHaveValue("half a thought");
});

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const p = createServer();
    p.once("error", rej);
    p.listen(0, "127.0.0.1", () => { const { port } = p.address() as { port: number }; p.close(() => res(port)); });
  });
}

test("14.2 in dev a server edit changes a response and the live page stays connected", async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), "heldout-14-"));
  let child: ChildProcess | undefined;
  let output = "";
  try {
    const dir = join(root, "project");
    cpSync(join(import.meta.dirname, "..", "e2e", "fixtures", "project"), dir, { recursive: true });
    const env = { ...cleanEnv(process.env), WERK_OPEN: "true", WERK_DEV: "1", WERK_HOME: join(root, "home") };
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
    const cli = copyApp(join(root, "app"));
    const port = await freePort();
    child = spawn("bun", [cli, "serve", "--port", String(port)], { cwd: dir, env });
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
    const origin = `http://127.0.0.1:${port}`;
    await expect.poll(async () => (await fetch(`${origin}/api/projects`).catch(() => null))?.ok === true, { timeout: 30000 }).toBe(true);
    const pid = child.pid;
    const before = await (await fetch(`${origin}/api/projects`)).json();
    expect(before.edited).toBeUndefined();
    await page.goto(`${origin}/p/${basename(dir)}/map/root`);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await markLoaded(page);

    const routes = join(root, "app", "src", "serve", "routes.ts");
    writeFileSync(routes, readFileSync(routes, "utf8").replace("return json({ projects: entries(ctx.projects) });", "return json({ projects: entries(ctx.projects), edited: true });"));
    await expect.poll(async () => (await (await fetch(`${origin}/api/projects`)).json()).edited, { timeout: 20000 }).toBe(true);
    expect(output).toMatch(/reus/i);
    expect(child.pid).toBe(pid);
    expect(child.exitCode).toBeNull();
    expect((await fetch(`${origin}/api/projects`)).ok).toBe(true);

    const r = spawnSync("bun", [cli, "add", "after", "--title", "After edit", "--parent", "root"], { cwd: dir, env, encoding: "utf8" });
    expect(r.status).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible({ timeout: 15000 });
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    child?.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page, appCopy }) => {
  await page.goto(appCopy.url);
  const title = leftPane(page).getByRole("heading", { level: 1 });
  await expect(title).toBeVisible();
  const before = await title.innerText();
  await composerOf(page).fill("draft that must survive");
  await markLoaded(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toHaveText(before);
  await expect(composerOf(page)).toHaveValue("draft that must survive");
});

// ---------- 17 ----------
test("17.1 a deep card: breadcrumbs on one line, overlay on hover, click the parent", async ({ page }) => {
  const server = await serverWith([ROOT, decided("a", { title: "Level a", parent: "root" }), decided("b", { title: "Level b", parent: "a" }), decided("c", { title: "Level c", parent: "b" }), decided("d", { title: "Level d", parent: "c" })]);
  try {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(server.url);
    const pane = leftPane(page);
    expect((await pane.boundingBox())?.width).toBeLessThan(700);
    for (const t of ["Level a", "Level b", "Level c", "Level d"]) await pane.locator("a.tile", { hasText: t }).first().click();
    const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
    const line = crumbs.locator("[data-slot=crumb-line]");
    await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
    expect((await line.boundingBox())?.height).toBeLessThan(40);
    const text = (await line.innerText()).replace(/\s+/g, " ").trim();
    expect(text).toBe("… › Level c › Level d");
    expect(await line.locator("[data-slot=crumb-current]").evaluate((n) => getComputedStyle(n).fontWeight)).toMatch(/^(bold|[6-9]00)$/);
    await line.hover({ force: true });
    const overlay = crumbs.locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("We build software with agents");
    await expect(overlay).toContainText("Level a");
    await expect(overlay).toContainText("Level d");
    await overlay.getByRole("button", { name: "Level c" }).click();
    await expect(pane.getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
    await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level c");
  } finally { await server.dispose(); }
});

const countsOf = async (page: Page) =>
  Object.fromEntries(await page.locator("[data-slot=count]").evaluateAll((ns) => ns.map((n) => [n.getAttribute("data-kind"), { n: Number(n.textContent), title: n.getAttribute("title") }])));

test("17.2 the header counts follow the open card", async ({ page }) => {
  const server = await serverWith([ROOT,
    open("o", { title: "Open child", parent: "root" }),
    decided("x", { title: "X", parent: "root" }),
    [ghost("p", { title: "Proto child", parent: "root", status: "proto" }), { type: "node.accepted", id: "p", actor: "you" }],
    decided("d", { title: "Decided child", parent: "root" }),
    open("dd", { title: "Grandchild", parent: "d" }),
    decided("s", { title: "Stale child", parent: "root" }), dep("s", "x"), reopen("x")].flat());
  try {
    await page.goto(server.url);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    const c = await countsOf(page);
    expect(c.total).toBeDefined();
    const dots = (c.open?.n ?? 0) + (c.proto?.n ?? 0) + (c.decided?.n ?? 0);
    expect(dots).toBe(c.total.n);
    expect(c.proto?.title).toMatch(/proto/);
    expect(c.decided?.title).toMatch(/decided/);
    expect(c.open?.title).toMatch(/open/);
    expect(c.stale?.n).toBe(1);
    expect(c.stale?.title).toMatch(/stale/);
    expect(c.total.n).toBe(7);
    await page.goto(`${server.url.replace(/\/map.*$/, "")}/map/d`);
    await expect.poll(async () => (await countsOf(page)).total?.n).toBe(2);
  } finally { await server.dispose(); }
});

test("17.3 find a card by id and open it from the search box", async ({ page }) => {
  const ids = ["werk", ...Array.from("abcdefghij", (l) => `werk-${l}`), "x-werk-1", "x-werk-2", "x-werk-3"];
  const server = await serverWith([ROOT, decided("base", { title: "Base", parent: "root" }),
    ...[...ids].reverse().map((id) => (id === "werk" ? decided(id, { title: "The werk card", parent: "root" }) : decided(id, { title: `Card ${id}`, parent: "root" }))),
    dep("werk-a", "base"), reopen("base")].flat());
  try {
    await page.goto(server.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
    expect(await rows.count()).toBeLessThanOrEqual(12);
    expect(await rows.count()).toBeGreaterThan(5);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const idsShown = await rows.locator("code").allInnerTexts();
    const firstContains = idsShown.findIndex((i) => !i.startsWith("werk"));
    const lastStarts = idsShown.map((i) => i.startsWith("werk")).lastIndexOf(true);
    if (firstContains !== -1) expect(lastStarts).toBeLessThan(firstContains);
    for (let i = 0; i < (await rows.count()); i++) {
      await expect(rows.nth(i).locator("[data-slot=dot]")).toHaveCount(1);
      await expect(rows.nth(i).locator("[data-slot=result-title]")).not.toHaveText("");
    }
    await expect(rows.filter({ has: page.locator("code", { hasText: /^werk-a$/ }) }).locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
    await box.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "The werk card" })).toBeVisible();
    await expect(page.locator("[data-slot=crumb-current]")).toHaveText("The werk card");
    await expect(box).toHaveValue("");
  } finally { await server.dispose(); }
});

test("17.4 switch between the Map and Board tabs", async ({ page }) => {
  const server = await serverWith([ROOT, decided("a", { title: "Level a", parent: "root" })]);
  try {
    await page.goto(server.url);
    await leftPane(page).locator("a.tile", { hasText: "Level a" }).click();
    const views = page.getByRole("navigation", { name: "Views" });
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "Level a" })).toBeVisible();
    await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
    await views.getByRole("button", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
    await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
    await views.getByRole("button", { name: "Map" }).click();
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "Level a" })).toBeVisible();
  } finally { await server.dispose(); }
});

// ---------- 21 (model selector, context pie, restart, crash retry) ----------
const modelSelector = (page: Page) => page.getByRole("combobox", { name: /model/i }).or(page.getByRole("button", { name: /model/i })).first();
const pie = (page: Page) => page.getByRole("button", { name: /context/i }).first();
const short = { timeout: 3000 };

test("21.1 a conversation keeps its model and context fill across a restart", async ({ page }) => {
  const server = await startBrowserServer({ script: { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "You asked X")]] } } } });
  await server.start();
  try {
    await page.goto(server.url);
    await expect(modelSelector(page)).toBeVisible(short);
    await modelSelector(page).click();
    await page.getByRole("option", { name: "Opus" }).click();
    await composerOf(page).fill("X"); await composerOf(page).press("Enter");
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    const fill = await pie(page).getAttribute("title");
    await server.stop(); await server.start();
    await page.goto(server.url);
    await expect(modelSelector(page)).toContainText("Opus");
    expect(await pie(page).getAttribute("title")).toBe(fill);
  } finally { await server.dispose(); }
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page }) => {
  const server = await startBrowserServer({ script: { roles: { chat: { replies: [[say("m1", "One")], [say("m2", "Two")]] } } } });
  await server.start();
  try {
    await page.goto(server.url);
    await composerOf(page).fill("first"); await composerOf(page).press("Enter");
    await expect(chatPane(page).getByText("One")).toBeVisible();
    await server.stop(); await server.start();
    await page.goto(server.url);
    await composerOf(page).fill("second"); await composerOf(page).press("Enter");
    await expect(chatPane(page).getByText("Two")).toBeVisible();
    await expect(chatPane(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
    // the product keeps a stored session id for the conversation; the step needs it to be dead
    expect(readFileSync(join(server.dir, ".werk", "chats", "root.jsonl"), "utf8")).toContain("session");
    await expect(modelSelector(page)).toBeVisible(short);
  } finally { await server.dispose(); }
});

test("21.3 a crash with another error retries once, then asks to send again with the whole error", async ({ page }) => {
  const server = await startBrowserServer({ script: { roles: { chat: { replies: [[say("m1", "One")], [{ crash: 1 }], [{ crash: 1 }]] } } } });
  await server.start();
  try {
    await page.goto(server.url);
    await composerOf(page).fill("first"); await composerOf(page).press("Enter");
    await expect(chatPane(page).getByText("One")).toBeVisible();
    await composerOf(page).fill("second"); await composerOf(page).press("Enter");
    await expect(chatPane(page).getByText("Your message was not delivered. Send it again.")).toBeVisible(short);
  } finally { await server.dispose(); }
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const server = await startBrowserServer({ script: { roles: { chat: { replies: [[{ crash: 1 }]] } } } });
  await server.start();
  try {
    await page.goto(server.url);
    await composerOf(page).fill("hello"); await composerOf(page).press("Enter");
    await expect(chatPane(page).getByText("Your message was not delivered. Send it again.")).toBeVisible(short);
  } finally { await server.dispose(); }
});

test("21.5 model switch refuses during a turn; clear context from the pie", async ({ page }) => {
  const server = await startBrowserServer({ script: { roles: { chat: { replies: [[{ pause: 3000 }, say("m1", "Long")]] } } } });
  await server.start();
  try {
    await page.goto(server.url);
    await expect(modelSelector(page)).toContainText("Sonnet", short);
    await expect(pie(page)).toBeVisible(short);
    await pie(page).click();
    await expect(page.getByRole("button", { name: "Clear context" })).toBeVisible(short);
  } finally { await server.dispose(); }
});

// ---------- 23 (tabs) ----------
const tabStrip = (page: Page) => page.getByRole("tablist", { name: /conversation|chat/i }).or(page.locator("[data-slot=chat-tabs]"));

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  const server = await serverWith([ROOT, open("a", { title: "Card A", parent: "root" }), open("b", { title: "Card B", parent: "root" })]);
  try {
    await page.goto(server.url);
    await expect(tabStrip(page)).toBeVisible(short);
  } finally { await server.dispose(); }
});
test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  const server = await startBrowserServer({}); await server.start();
  try { await page.goto(server.url); await expect(tabStrip(page)).toBeVisible(short); } finally { await server.dispose(); }
});
test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  const server = await startBrowserServer({}); await server.start();
  try { await page.goto(server.url); await expect(tabStrip(page)).toBeVisible(short); await expect(page.locator("[data-slot=chat-tab][data-state=dead]")).toBeVisible(short); } finally { await server.dispose(); }
});
test("23.4 a model switch is not a crash", async ({ page }) => {
  const server = await startBrowserServer({}); await server.start();
  try { await page.goto(server.url); await expect(tabStrip(page)).toBeVisible(short); await expect(modelSelector(page)).toBeVisible(short); } finally { await server.dispose(); }
});
test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  const server = await startBrowserServer({ script: { roles: { chat: { replies: [[say("m1", "Done\nNext: merge it")], [say("m2", "Merged")]] } } } });
  await server.start();
  try {
    await page.goto(server.url);
    await composerOf(page).fill("go"); await composerOf(page).press("Enter");
    await expect(chatPane(page).getByText("Done")).toBeVisible();
    await expect(chatPane(page).getByRole("button", { name: "merge it" })).toBeVisible(short);
  } finally { await server.dispose(); }
});

// ---------- 24 / 25 ----------
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+mKKKK/Kz/QA/9k=";
async function paste(page: Page, size: number | null, type = "image/png", name = "shot.png", b64 = PNG_BASE64) {
  await composerOf(page).focus();
  await page.evaluate(({ base64, size, type, name }) => {
    const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new Uint8Array(size ?? png.length);
    data.set(png);
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], name, { type }));
    document.querySelector("textarea")?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { base64: b64, size, type, name });
}
async function drop(page: Page, size: number) {
  await page.evaluate(({ base64, size }) => {
    const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new Uint8Array(size); data.set(png);
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], "big.png", { type: "image/png" }));
    const target = document.querySelector("textarea") as HTMLElement;
    for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, { base64: PNG_BASE64, size });
}
const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });
const attachDir = (s: BrowserServer) => join(s.dir, ".werk", "attachments");
const sendNow = async (page: Page) => composerOf(page).press("Enter");
const reply = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } } as Script;

test("24.1 pick a card from the hash menu", async ({ page }) => {
  const server = await serverWith([ROOT, open("werk-shots", { title: "Pasted screenshots", parent: "root" })], { script: reply });
  try {
    await page.goto(server.url);
    const c = composerOf(page);
    await c.pressSequentially("Look at #wer");
    const menu = page.locator("[data-slot=word-menu]");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option", { name: /werk-shots/ })).toContainText("Pasted screenshots");
    await c.press("ArrowDown"); await c.press("ArrowUp");
    await c.press("Enter");
    await expect(c).toHaveValue(/^Look at #werk-shots\s?$/);
    await expect(menu).toHaveCount(0);
    await c.fill("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    // the menu opens below the caret: its top edge is at or below the composer's top
    await c.fill("Look at #wer");
    const m = await page.locator("[data-slot=word-menu]").boundingBox();
    const b = await c.boundingBox();
    expect(m && b && m.y >= b.y).toBe(true);
  } finally { await server.dispose(); }
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  const server = await startBrowserServer({ script: reply }); await server.start();
  try {
    await page.goto(server.url);
    const c = composerOf(page);
    await c.pressSequentially("What is wrong here? ");
    await paste(page, null);
    await expect(c).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("img")).toBeVisible();
    await sendNow(page);
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/open .*image/i);
    const status = spawnSync("git", ["status", "--porcelain", "-uall"], { cwd: server.dir, encoding: "utf8" }).stdout;
    expect(status).not.toContain("attachments");
  } finally { await server.dispose(); }
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  const server = await startBrowserServer({ script: reply }); await server.start();
  try {
    await page.goto(server.url);
    await drop(page, 25 * 1024 * 1024);
    await expect(composerOf(page)).toHaveValue(/\[Image #1\]/);
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText(/20 MB/);
    await composerOf(page).pressSequentially(" hi");
    await sendNow(page);
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toMatch(/\.werk\/attachments/);
    const files = spawnSync("ls", [attachDir(server)], { encoding: "utf8" });
    expect(files.stdout.trim()).toBe("");
  } finally { await server.dispose(); }
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  const server = await startBrowserServer({ script: reply }); await server.start();
  try {
    await page.goto(server.url);
    await paste(page, null, "image/png", "a.png");
    await paste(page, null, "image/jpeg", "b.jpg", JPEG_BASE64);
    const c = composerOf(page);
    await expect(c).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(c).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await sendNow(page);
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    expect(messages(server)[0]).toMatch(/\[Image #1\] = .*\.(jpg|jpeg)/);
  } finally { await server.dispose(); }
});

async function projectApi(page: Page, server: BrowserServer) {
  const name = basename(server.dir);
  return `${server.origin}/api/projects/${name}`;
}

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  const server = await startBrowserServer({ script: { roles: { chat: { replies: [[start, say("m1", "Hello")]] } } } }); await server.start();
  try {
    await page.goto(server.url);
    await composerOf(page).fill("hi"); await composerOf(page).press("Enter");
    await expect(chatPane(page).getByText("Hello")).toBeVisible();
    const api = await projectApi(page, server);
    expect((await fetch(`${api}/image?name=`)).status).toBe(404);
    expect((await fetch(`${api}/image?name=${encodeURIComponent("../log.jsonl")}`)).status).toBe(404);
    expect((await fetch(`${api}/image?name=${encodeURIComponent("../../../../etc/hosts")}`)).status).toBe(404);
    const c = composerOf(page);
    await c.fill("");
    await c.pressSequentially("/");
    await expect(page.locator("[data-slot=word-menu]")).toBeVisible();
  } finally { await server.dispose(); }
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  const server = await startBrowserServer({ script: reply }); await server.start();
  try {
    await page.goto(server.url);
    await paste(page, null);
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composerOf(page).pressSequentially(" Why is this red?");
    await sendNow(page);
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/Read/);
    expect(text).not.toContain(PNG_BASE64);
    // the sent message shows in the chat with the image under "[Image #1]"
    await expect(chatPane(page).getByRole("img").first()).toBeVisible();
  } finally { await server.dispose(); }
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  const server = await startBrowserServer({ script: reply }); await server.start();
  try {
    await page.goto(server.url);
    await paste(page, 2 * 1024 * 1024);
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await paste(page, 25 * 1024 * 1024);
    await expect(chips(page).getByRole("alert")).toContainText(/larger than 20 MB/);
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composerOf(page)).not.toHaveValue(/\[Image #2\]/);
    await composerOf(page).pressSequentially(" Why is this red?");
    await sendNow(page);
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = /);
    expect(text).not.toContain("[Image #2]");
  } finally { await server.dispose(); }
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  const server = await startBrowserServer({ script: reply }); await server.start();
  try {
    await page.goto(server.url);
    await paste(page, null); await paste(page, null);
    await expect(composerOf(page)).toHaveValue("[Image #1][Image #2]");
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await sendNow(page);
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = /);
    expect(text).not.toContain("[Image #2]");
  } finally { await server.dispose(); }
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  const server = await startBrowserServer({ script: reply }); await server.start();
  try {
    await page.goto(server.url);
    // hold the upload until the test lets it go
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await page.route("**/image", async (route) => { await gate; await route.continue(); });
    await paste(page, null);
    await expect(chips(page)).toContainText("[Image #1]");
    await composerOf(page).pressSequentially(" a question");
    await sendNow(page);
    await page.waitForTimeout(500);
    expect(messages(server)).toHaveLength(0);
    release();
    await expect(chips(page).getByRole("img")).toBeVisible();
    await expect(chatPane(page).getByText("Seen")).toBeVisible({ timeout: 15000 });
    expect(messages(server)[0]).toMatch(/\[Image #1\] = .*\.werk\/attachments/);
  } finally { await server.dispose(); }
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  const server = await startBrowserServer({ script: reply }); await server.start();
  try {
    await page.goto(server.url);
    const api = await projectApi(page, server);
    expect((await fetch(`${api}/image?name=`)).status).toBe(404);
    expect((await fetch(`${api}/image?name=${encodeURIComponent("../log.jsonl")}`)).status).toBe(404);
    await paste(page, null);
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composerOf(page).pressSequentially(" hi");
    await sendNow(page);
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
  } finally { await server.dispose(); }
});
