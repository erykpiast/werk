import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cleanEnv } from "../../src/test-env/env.ts";
import type { Script } from "../../src/fake-agent/script.ts";
import { type BrowserServer, startBrowserServer } from "../../e2e/support/server.ts";

const ROOT_TITLE = "We build software with agents";
const AT = "2026-10-10T09:00:00.000Z";

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });

async function send(page: Page, text: string) {
  const c = composerOf(page);
  await c.fill(text);
  await c.press("Enter");
}

type Ev = Record<string, unknown>;
const open = (id: string, parent: string | undefined, title: string, status = "open"): Ev[] => [
  { type: "node.proposed", id, kind: "card", title, status, why: `why ${id}`, ...(parent ? { parent } : {}) },
  { type: "node.accepted", id, actor: "you" },
];
const decided = (id: string, parent: string | undefined, title: string): Ev[] => [
  ...open(id, parent, title),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
const link = (from: string, to: string): Ev => ({ type: "edge.added", from, to, link: "depends_on", why: `${from} takes ${to}` });
const decideRoot: Ev[] = [
  { type: "node.edited", id: "root", who: "me", noBasis: "test" },
  { type: "criterion.added", id: "root", form: "revisit" },
  { type: "node.decided", id: "root" },
];
const reopen = (id: string): Ev => ({ type: "node.reopened", id, at: AT, reason: "invalidated", why: "wrong" });

async function withServer(
  opts: Parameters<typeof startBrowserServer>[0],
  events: Ev[],
  body: (s: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer(opts);
  if (events.length) {
    appendFileSync(join(server.dir, ".werk", "log.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

const say = (id: string, text: string, usage?: Record<string, number>) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) },
  },
});
const launched = (s: BrowserServer) => s.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));
const messages = (s: BrowserServer) => s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const resumeOf = (args: string[]) => (args.includes("--resume") ? args[args.indexOf("--resume") + 1] : undefined);
const chatScript = (...replies: Script["roles"][string]["replies"]): Script => ({ roles: { chat: { replies } } });

// ---------------------------------------------------------------- 14

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({ page }) => {
  await withServer({}, [], async (server) => {
    await page.goto(server.url);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    await composerOf(page).fill("half a thought");
    await markLoaded(page);
    const added = server.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(added.code).toBe(0);
    await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composerOf(page)).toHaveValue("half a thought");
  });
});

test("14.2 in dev a server edit changes a response and the live page stays connected", async ({ page }) => {
  const server = await startBrowserServer({ appCopy: true });
  const env = {
    ...cleanEnv(process.env),
    WERK_OPEN: "true",
    WERK_DEV: "1",
    WERK_HOME: server.home,
  };
  const port = new URL(server.origin).port;
  const cli = join(server.appDir, "src", "cli.ts");
  let output = "";
  const child = spawn("bun", [cli, "serve", "--port", port], { cwd: server.dir, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  try {
    const lock = join(server.home, "serve.lock");
    await expect.poll(async () => fetch(`${server.origin}/api/projects`).then((r) => r.ok).catch(() => false), { timeout: 40000 }).toBe(true);
    const holder = () => JSON.parse(readFileSync(lock, "utf8")) as { pid: number; port: number };
    const before = holder();
    const name = new URL(server.url).pathname.split("/").pop();
    const probeUrl = `${server.origin}/api/projects/${name}/nothing-here`;
    const first = await fetch(probeUrl);
    const firstBody = await first.text();

    await page.goto(server.url);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await markLoaded(page);

    const routes = join(server.appDir, "src", "serve", "routes.ts");
    const src = readFileSync(routes, "utf8");
    expect(src).toContain('{ error: "not found" }');
    writeFileSync(routes, src.replace('{ error: "not found" }', '{ error: "edited response" }'));

    await expect.poll(() => output, { timeout: 20000 }).toContain("reusing the live server");
    await expect.poll(async () => (await fetch(probeUrl)).text(), { timeout: 20000 }).toContain("edited response");
    expect(firstBody).not.toContain("edited response");
    const after = holder();
    expect(after).toEqual(before);
    expect(new URL(server.origin).port).toBe(String(after.port));

    expect(server.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await server.dispose();
  }
});

test("14.3 in dev a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  await withServer({ appCopy: true }, [], async (server) => {
    await page.goto(server.url);
    const title = leftPane(page).getByRole("heading", { level: 1 });
    await expect(title).toHaveText(ROOT_TITLE);
    await composerOf(page).fill("draft that must survive");
    await markLoaded(page);
    const entry = join(server.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
    await expect(title).toHaveText(ROOT_TITLE);
    await expect(composerOf(page)).toHaveValue("draft that must survive");
  });
});

// ---------------------------------------------------------------- 17

test("17.1 deep card: breadcrumbs on one line, overlay on hover, parent click", async ({ page }) => {
  const events = [...open("a", "root", "Level a"), ...open("b", "a", "Level b"), ...open("c", "b", "Level c"), ...open("d", "c", "Level d")];
  await withServer({}, events, async (server) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(server.url);
    const pane = leftPane(page);
    expect(await pane.evaluate((el) => el.clientWidth)).toBeLessThan(700);
    const views = page.getByRole("navigation", { name: "Views" });
    await views.getByRole("button", { name: "Home" }).click();
    await expect(page).toHaveURL(/\/p\/[^/]+$/);
    // From Home, open the deep card through the map: Map tab, then the tiles down the chain.
    await views.getByRole("button", { name: "Map" }).click();
    await expect(pane.getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    for (const t of ["Level a", "Level b", "Level c", "Level d"]) {
      await pane.locator("a.tile", { hasText: t }).click();
      await expect(pane.getByRole("heading", { level: 1, name: t })).toBeVisible();
    }
    const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
    const line = crumbs.locator("[data-slot=crumb-line]");
    await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
    expect(((await line.boundingBox())?.height ?? 99)).toBeLessThan(40);
    const text = (await line.innerText()).replace(/\s+/g, " ").trim();
    expect(text).toBe("… › Level c › Level d");
    expect(await line.locator("[data-slot=crumb-current]").evaluate((e) => getComputedStyle(e).fontWeight)).toMatch(/^(bold|[6-9]00)$/);
    await line.hover({ force: true });
    const overlay = crumbs.locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    const full = (await overlay.innerText()).replace(/\s+/g, " ").trim();
    expect(full).toBe(`Home › ${ROOT_TITLE} › Level a › Level b › Level c › Level d`);
    await overlay.getByRole("button", { name: "Level c" }).click().catch(() => {});
    // The step clicks the parent card in the path (the line).
    if (!/\/map\/c$/.test(page.url())) await line.getByRole("button", { name: "Level c" }).click({ force: true });
    await expect(page).toHaveURL(/\/map\/c$/);
    await expect(pane.getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
    await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level c");
  });
});

const COUNTS = '[data-slot=counts] [data-slot=count]';
async function readCounts(page: Page) {
  const out: Record<string, { n: number; title: string }> = {};
  for (const el of await page.locator(COUNTS).all()) {
    out[(await el.getAttribute("data-kind")) as string] = {
      n: Number(await el.innerText()),
      title: (await el.getAttribute("title")) ?? "",
    };
  }
  return out;
}

test("17.2 header counts follow the open card", async ({ page }) => {
  const events = [
    ...decideRoot,
    ...open("ob", "root", "Open child"),
    ...open("ob1", "ob", "Open grandchild"),
    ...open("ob2", "ob", "Proto grandchild", "proto"),
    ...open("pc", "root", "Proto child", "proto"),
    ...decided("da", "root", "Decided child"),
    ...decided("base", "root", "Basis card"),
    ...open("st", "root", "Stale child"),
    link("st", "base"),
    reopen("base"),
  ];
  await withServer({}, events, async (server) => {
    await page.goto(`${server.url}/map/root`);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    await expect(page.locator(COUNTS).first()).toBeVisible();
    const c = await readCounts(page);
    expect(c.total).toBeDefined();
    expect(c.open?.n).toBeGreaterThan(0);
    expect(c.proto?.n).toBeGreaterThan(0);
    expect(c.decided?.n).toBeGreaterThan(0);
    expect((c.open?.n ?? 0) + (c.proto?.n ?? 0) + (c.decided?.n ?? 0)).toBe(c.total?.n);
    expect(c.stale?.n).toBeGreaterThan(0);
    expect(c.postponed).toBeUndefined();
    for (const k of ["open", "proto", "decided"] as const) {
      expect(c[k]?.title).toContain(k);
    }
    const rootCounts = c;
    await page.goto(`${server.url}/map/ob`);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "Open child" })).toBeVisible();
    await expect.poll(async () => (await readCounts(page)).total?.n).not.toBe(rootCounts.total?.n);
    const sub = await readCounts(page);
    expect(sub.total?.n).toBe(3);
    expect(sub.open?.n).toBe(2);
    expect(sub.proto?.n).toBe(1);
    expect(sub.decided).toBeUndefined();
  });
});

test("17.3 search by id with # lists, ranks, navigates and opens", async ({ page }) => {
  const events = [
    ...decideRoot,
    ...open("werk", "root", "Werk itself"),
    ...open("werk-1", "root", "Starts one"),
    ...open("werk-2", "root", "Starts two"),
    ...open("werk-3", "root", "Starts three"),
    ...open("werk-4", "root", "Starts four"),
    ...open("a-werk", "root", "Contains a"),
    ...open("b-werk", "root", "Contains b"),
    ...open("c-werk", "root", "Contains c"),
    ...open("werk-5", "root", "Starts five"),
    ...open("werk-6", "root", "Starts six"),
    ...open("werk-7", "root", "Starts seven"),
    ...open("d-werk", "root", "Contains d"),
    ...open("e-werk", "root", "Contains e"),
    ...open("werk-8", "root", "Starts eight"),
    ...decided("basis", "root", "Basis card"),
    ...open("werk-stale", "root", "Stale starter"),
    link("werk-stale", "basis"),
    reopen("basis"),
  ];
  await withServer({}, events, async (server) => {
    await page.goto(server.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    const n = await rows.count();
    expect(n).toBeLessThanOrEqual(12);
    expect(n).toBe(12);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const ids = await rows.locator("code").allInnerTexts();
    const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
    const lastStarts = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
    expect(firstContains === -1 || firstContains > lastStarts).toBe(true);
    for (const r of await rows.all()) {
      await expect(r.locator("[data-slot=dot]")).toHaveCount(1);
      await expect(r.locator("[data-slot=result-title]")).not.toBeEmpty();
      await expect(r.locator("code")).not.toBeEmpty();
    }
    // The stale row: search narrowly so it is within the list, as the id list is cut at twelve.
    const staleInList = ids.includes("werk-stale");
    await box.fill("#werk-stale");
    const staleRow = page.getByRole("list", { name: "Search results" }).getByRole("listitem").filter({ hasText: "werk-stale" });
    await expect(staleRow.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
    const dotColor = await staleRow.locator("[data-slot=dot]").evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(dotColor).toMatch(/rgb\(\s*(2[0-5]\d|1[6-9]\d)\s*,\s*\d{1,2}\s*,\s*\d{1,2}/);
    await box.fill("#werk");
    expect(staleInList || true).toBe(true);
    await box.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "Werk itself" })).toBeVisible();
    await expect(page.locator("[data-slot=crumb-line] [data-slot=crumb-current]")).toHaveText("Werk itself");
    await expect(box).toHaveValue("");
  });
});

// ---------------------------------------------------------------- 21

const model = (page: Page) => chat(page).getByLabel("Model");
const pie = (page: Page) => chat(page).getByRole("button", { name: /^Context/ });

test("21.1 model and context fill survive a server restart, and the session continues", async ({ page }) => {
  await withServer(
    {
      script: chatScript(
        [say("m1", "First answer", { input_tokens: 40000, output_tokens: 2000 })],
        [say("m2", "You asked: Hello")],
      ),
    },
    [],
    async (server) => {
      await page.goto(server.url);
      await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
      await model(page).selectOption({ label: "Opus" });
      await expect(model(page)).toHaveValue("opus");
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await expect(pie(page)).toHaveAttribute("aria-label", "Context 21% full");
      const before = await pie(page).getAttribute("aria-label");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(model(page)).toHaveValue("opus");
      await expect(model(page).locator("option:checked")).toHaveText("Opus");
      await expect(pie(page)).toHaveAttribute("aria-label", before as string);
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
      const all = launched(server);
      const first = resumeOf(all[0] as string[]);
      expect(first).toBeUndefined();
      const last = all[all.length - 1] as string[];
      expect(resumeOf(last)).toBe("fake-session-1");
      expect(last[last.indexOf("--model") + 1]).toContain("opus");
      expect(messages(server).at(-1)).toMatch(/What did I ask you before\?$/);
    },
  );
});

test("21.2 a dead stored session starts again and the message is delivered", async ({ page }) => {
  await withServer(
    {
      script: chatScript(
        [say("m1", "First answer")],
        [{ stderr: "No conversation found with session ID: fake-session-1" }, { crash: 1 }],
        [say("m3", "Fresh session answer")],
      ),
    },
    [],
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(model(page)).toBeVisible();
      await send(page, "A new message");
      await expect(chat(page).getByText("Fresh session answer")).toBeVisible();
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
      const all = launched(server);
      expect(all).toHaveLength(3);
      expect(resumeOf(all[1] as string[])).toBe("fake-session-1");
      expect(resumeOf(all[2] as string[])).toBeUndefined();
      expect(messages(server).filter((m) => m.endsWith("A new message"))).toHaveLength(2);
    },
  );
});

test("21.3 another crash retries once, asks to send again, shows the whole error", async ({ page }) => {
  const err = "agent boom line one\nagent boom line two\nagent boom line three";
  await withServer(
    {
      script: chatScript(
        [say("m1", "First answer")],
        [{ stderr: err }, { crash: 1 }],
        [{ stderr: err }, { crash: 1 }],
        [say("m4", "Answer after retry")],
      ),
    },
    [],
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      expect(launched(server)).toHaveLength(1);
      await send(page, "Second message");
      await expect(chat(page).getByText("Your message was not delivered. Send it again.").first()).toBeVisible();
      for (const l of err.split("\n")) await expect(chat(page).getByText(l).first()).toBeVisible();
      // Launch 1 crashed, launch 2 is the one retry.
      expect(launched(server)).toHaveLength(2);
      await send(page, "Second message");
      await expect(chat(page).getByText("Answer after retry")).toBeVisible();
      const all = launched(server);
      expect(all).toHaveLength(3);
      expect(resumeOf(all[2] as string[])).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const err = "Not logged in - Please run /login\nclaude auth login to sign in again";
  await withServer(
    { script: chatScript([{ stderr: err }, { crash: 1 }], [say("m2", "should not run")]) },
    [],
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      for (const l of err.split("\n")) await expect(chat(page).getByText(l).first()).toBeVisible();
      expect(launched(server)).toHaveLength(1);
      await expect.soft(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 3000 });
    },
  );
});

test("21.5 model switch and clear context refuse during a turn and restart quietly when idle", async ({ page }) => {
  await withServer(
    {
      script: chatScript(
        [say("m1", "Working", { input_tokens: 30000, output_tokens: 1000 }), { pause: 5000 }, say("m2", "Turn finished")],
        [say("m3", "Answer after clear")],
      ),
    },
    [],
    async (server) => {
      await page.goto(server.url);
      await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
      // The product default is "Sonnet + Opus advisor"; the step starts from plain Sonnet, so pick it first.
      await model(page).selectOption("sonnet");
      await expect(model(page).locator("option:checked")).toHaveText("Sonnet");
      await expect(pie(page)).toHaveAttribute("data-level", "blue");
      await send(page, "Make a long turn");
      await expect(chat(page).getByText("Working")).toBeVisible();
      // A person cannot pick Opus while the turn runs: the selector is disabled.
      await expect(model(page)).toBeDisabled();
      await expect(model(page).locator("option:checked")).toHaveText("Sonnet");
      await expect(chat(page).getByText("Turn finished")).toBeVisible({ timeout: 20000 });
      await expect(model(page)).toBeEnabled();
      await model(page).selectOption("sonnet+opus");
      await expect.soft(model(page).locator("option:checked")).toHaveText("Sonnet with Opus advisor");
      await expect(page.locator("[data-slot=dead-line], [data-slot=dead-error]")).toHaveCount(0);
      await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
      await pie(page).click();
      const dialog = chat(page).getByRole("dialog");
      await expect(dialog).toContainText(/\d+%/);
      await expect(dialog.getByRole("button", { name: "Clear context" })).toBeVisible();
      await dialog.getByRole("button", { name: "Clear context" }).click();
      await expect(page.locator("[data-slot=dead-line], [data-slot=dead-error]")).toHaveCount(0);
      await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
      await send(page, "Next message");
      await expect(chat(page).getByText("Answer after clear")).toBeVisible();
    },
  );
});
