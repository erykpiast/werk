import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { expect, test } from "./support/fixtures.ts";
import { type BrowserServer, startBrowserServer } from "./support/server.ts";

const ROOT_TITLE = "We build software with agents";
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const chatPane = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true).catch(() => false);

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});

async function withServer(script: Script | undefined, body: (s: BrowserServer) => Promise<void>) {
  const server = await startBrowserServer(script ? { script } : {});
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

function addCard(s: BrowserServer, id: string, title: string, parent: string | null = "root", accept = true) {
  expect(s.werk("add", id, "--title", title, ...(parent ? ["--parent", parent] : [])).code).toBe(0);
  if (accept) expect(s.werk("accept", id, "--actor", "you").code).toBe(0);
}

test.describe("14 live page and hot reload", () => {
  test("14.1 a card added from the command line appears with no reload", async ({ page, app }) => {
    await page.goto(app.url);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    await composer(page).fill("half a thought");
    await markLoaded(page);
    expect(app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root").code).toBe(0);
    await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer(page)).toHaveValue("half a thought");
  });

  test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
    const server = await startBrowserServer({ appCopy: true });
    await server.start();
    try {
      await page.goto(server.url);
      await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
      await markLoaded(page);
      const pid = server.pid();
      expect(pid).toBeDefined();
      const routes = join(server.appDir, "src", "serve", "routes.ts");
      const source = readFileSync(routes, "utf8");
      const edited = source.replace(
        "return json({ projects: entries(ctx.projects) });",
        "return json({ projects: entries(ctx.projects), edited: true });",
      );
      expect(edited).not.toBe(source);
      writeFileSync(routes, edited);
      await expect.poll(() => server.output(), { timeout: 20000 }).toMatch(/reusing the live server/);
      expect(server.pid()).toBe(pid);
      expect(() => process.kill(pid as number, 0)).not.toThrow();
      await expect
        .poll(async () => (await (await fetch(`${server.origin}/api/projects`)).json()).edited, { timeout: 20000 })
        .toBe(true);
      expect(server.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
      await expect(leftPane(page).getByText("After edit")).toBeVisible();
      expect(await stillLoaded(page)).toBe(true);
    } finally {
      await server.dispose();
    }
  });

  test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page, appCopy }) => {
    await page.goto(appCopy.url);
    const title = leftPane(page).getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    const before = await title.innerText();
    await composer(page).fill("draft that must survive");
    await markLoaded(page);
    const entry = join(appCopy.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
    await expect(title).toHaveText(before);
    await expect(composer(page)).toHaveValue("draft that must survive");
  });
});

test.describe("17 header", () => {
  test.use({ viewport: { width: 1200, height: 800 } });
  test.beforeEach(() => {
    test.setTimeout(30000);
  });

  async function deep(s: BrowserServer) {
    addCard(s, "l1", "Level one");
    addCard(s, "l2", "Level two", "l1");
    addCard(s, "l3", "Level three", "l2");
    addCard(s, "l4", "Level four", "l3");
  }
  const header = (page: Page) => leftPane(page).locator("header");

  test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page, app }) => {
    await deep(app);
    await page.goto(app.origin);
    await page.goto(`${app.url}/map/l4`);
    const head = header(page);
    await expect(head).toContainText("›", { timeout: 4000 });
    await expect(head).toContainText("…", { timeout: 4000 });
    await expect(head.locator("b, strong").filter({ hasText: "Level four" })).toBeVisible({ timeout: 4000 });
    await head.hover();
    await expect(page.getByText("Home", { exact: true })).toBeVisible({ timeout: 4000 });
    await head.getByText("Level three").first().click({ timeout: 4000 });
    await expect(head.locator("b, strong").filter({ hasText: "Level three" })).toBeVisible({ timeout: 4000 });
  });

  test("17.2 the header counts follow the open card", async ({ page, app }) => {
    expect(app.werk("add", "o", "--title", "Open child", "--parent", "root").code).toBe(0);
    expect(app.werk("add", "p", "--title", "Proto child", "--parent", "root", "--status", "proto").code).toBe(0);
    await page.goto(app.url);
    const head = header(page);
    await expect(head.getByTitle(/open/i).first()).toBeVisible({ timeout: 4000 });
    await expect(head.getByTitle(/proto/i).first()).toBeVisible({ timeout: 4000 });
    await expect(head.getByTitle(/decided/i)).toHaveCount(0, { timeout: 4000 });
  });

  test("17.3 a person finds a card by id and opens it from the search box", async ({ page, app }) => {
    addCard(app, "werk", "The werk card");
    addCard(app, "werk-shots", "Shots");
    addCard(app, "a-werk", "Contains");
    await page.goto(app.url);
    const box = page.getByRole("searchbox").or(page.getByPlaceholder(/search/i));
    await box.first().fill("#werk", { timeout: 4000 });
    const rows = page.getByRole("option");
    await expect(rows.first()).toContainText("#werk", { timeout: 4000 });
    await box.first().press("ArrowDown");
    await box.first().press("ArrowUp");
    await box.first().press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/, { timeout: 4000 });
    await expect(box.first()).toHaveValue("");
  });

  test("17.4 a person switches between the Map and Board tabs", async ({ page, app }) => {
    await page.goto(app.url);
    await header(page).getByRole("link", { name: "Board" }).or(header(page).getByRole("tab", { name: "Board" })).first().click({ timeout: 4000 });
    await expect(page).toHaveURL(/\/board$/, { timeout: 4000 });
    await page.reload();
    await expect(page).toHaveURL(/\/board$/);
    await header(page).getByRole("link", { name: "Map" }).or(header(page).getByRole("tab", { name: "Map" })).first().click({ timeout: 4000 });
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("17.5 the first screen shows the requirements and the build rules side by side", async ({ page, app }) => {
    addCard(app, "how", "How we build", null);
    addCard(app, "how1", "A build rule", "how");
    addCard(app, "req1", "A requirement", "root");
    await page.goto(app.url);
    const root = leftPane(page).getByText(ROOT_TITLE).first();
    const how = leftPane(page).getByText("How we build").first();
    await expect(root).toBeVisible({ timeout: 4000 });
    await expect(how).toBeVisible({ timeout: 4000 });
    const a = (await root.boundingBox())!;
    const b = (await how.boundingBox())!;
    expect(b.x).toBeGreaterThan(a.x + a.width / 2);
    expect(Math.abs(a.y - b.y)).toBeLessThan(40);
    await expect(leftPane(page).getByText("A requirement")).toBeVisible();
    await expect(leftPane(page).getByText("A build rule")).toBeVisible();
  });
});

const chatScript = (...replies: Script["roles"][string]["replies"]): Script => ({ roles: { chat: { replies } } });

test.describe("23 conversation tabs", () => {
  test.beforeEach(() => {
    test.setTimeout(30000);
  });
  const chips = (page: Page) => chatPane(page).getByRole("tab");
  async function send(page: Page, text: string) {
    await composer(page).fill(text);
    await composer(page).press("Enter");
  }

  test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
    await withServer(chatScript([say("m1", "Reply for A")], [say("m2", "Reply for B")]), async (s) => {
      addCard(s, "a", "Card A");
      addCard(s, "b", "Card B");
      await page.goto(`${s.url}/map/a`);
      await send(page, "message in A");
      await expect(chatPane(page).getByText("Reply for A")).toBeVisible();
      await page.goto(`${s.url}/map/b`);
      await send(page, "message in B");
      await expect(chips(page)).toHaveCount(2, { timeout: 4000 });
      await expect(chips(page).nth(0)).toContainText("Card A");
      await expect(chips(page).nth(1)).toContainText("Card B");
    });
  });

  test("23.2 switching to a tab shows its newest message", async ({ page }) => {
    await withServer(chatScript([say("m1", "one")], [say("m2", "two")]), async (s) => {
      addCard(s, "a", "Card A");
      await page.goto(`${s.url}/map/a`);
      await send(page, "hello");
      await expect(chips(page)).toHaveCount(2, { timeout: 4000 });
      await chips(page).nth(1).click({ timeout: 4000 });
      const scroll = chatPane(page).locator("[data-slot=chat-scroll]");
      const atBottom = await scroll.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight < 2);
      expect(atBottom).toBe(true);
    });
  });

  test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
    await withServer(chatScript([say("m1", "ok")], [{ crash: 1 }]), async (s) => {
      addCard(s, "a", "Card A");
      await page.goto(`${s.url}/map/a`);
      await send(page, "go");
      await expect(chips(page)).toHaveCount(2, { timeout: 4000 });
      await expect(chips(page).first()).toHaveAttribute("data-state", /dead|crash|red/, { timeout: 4000 });
    });
  });

  test("23.4 a model switch is not a crash", async ({ page }) => {
    await withServer(chatScript([say("m1", "ok")], [say("m2", "still ok")]), async (s) => {
      await page.goto(s.url);
      await send(page, "hello");
      await chatPane(page).getByRole("combobox", { name: /model/i }).selectOption({ index: 1 }, { timeout: 4000 });
      await send(page, "next");
      await expect(chatPane(page).getByText("still ok")).toBeVisible();
    });
  });

  test("23.5 a running background agent and a suggested next action", async ({ page }) => {
    await withServer(chatScript([say("m1", "Done.\nNext: say \"merge it\""), ], [say("m2", "merged")]), async (s) => {
      await page.goto(s.url);
      await send(page, "go");
      const button = chatPane(page).getByRole("button", { name: "merge it" });
      await expect(button).toBeVisible({ timeout: 4000 });
      await button.click();
      await expect(chatPane(page).getByText("merged")).toBeVisible();
      await expect(button).toHaveCount(0);
    });
  });
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
).toString("base64");

async function pasteImage(page: Page, type: string, base64: string, kind: "paste" | "drop" = "paste") {
  await page.evaluate(
    ({ type, base64, kind }) => {
      const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bin], type === "image/png" ? "shot.png" : "shot.jpg", { type });
      const data = new DataTransfer();
      data.items.add(file);
      const target = document.querySelector("[data-composer]") as HTMLElement;
      target.focus();
      const event =
        kind === "paste"
          ? new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })
          : new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    },
    { type, base64, kind },
  );
}

test.describe("24 composer", () => {
  test.beforeEach(() => {
    test.setTimeout(30000);
  });

  test("24.1 pick a card from the hash menu", async ({ page, app }) => {
    addCard(app, "werk-shots", "Pasted screenshots");
    await page.goto(app.url);
    await composer(page).click();
    await composer(page).pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible({ timeout: 4000 });
    await expect(menu.getByText("Pasted screenshots")).toBeVisible();
    await composer(page).press("ArrowDown");
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue("Look at #werk-shots");
    await expect(menu).toHaveCount(0);
    await composer(page).fill("");
    await composer(page).pressSequentially("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });

  test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
    await withServer(chatScript([say("m1", "seen")]), async (s) => {
      await page.goto(s.url);
      await composer(page).fill("What is wrong here? ");
      await pasteImage(page, "image/png", PNG);
      await expect(composer(page)).toHaveValue(/\[Image #1\]/, { timeout: 4000 });
      await expect(chatPane(page).getByRole("img").first()).toBeVisible({ timeout: 4000 });
      await composer(page).press("Enter");
      await expect(chatPane(page).getByText("seen")).toBeVisible();
      const text = s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []))[0] ?? "";
      expect(text).toMatch(/\[Image #1\]/);
      expect(text).toMatch(/attachments/);
    });
  });

  test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
    await withServer(chatScript([say("m1", "seen")]), async (s) => {
      await page.goto(s.url);
      const big = Buffer.alloc(25 * 1024 * 1024, 1).toString("base64");
      await pasteImage(page, "image/png", big, "drop");
      await expect(composer(page)).toHaveValue(/\[Image #1\]/, { timeout: 4000 });
      await expect(chatPane(page).getByText(/limit|too large|MB/i)).toBeVisible({ timeout: 4000 });
    });
  });

  test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
    await page.goto((await startBrowserServerOnce()).url);
    await pasteImage(page, "image/png", PNG);
    await pasteImage(page, "image/jpeg", PNG);
    await expect(composer(page)).toHaveValue(/\[Image #1\].*\[Image #2\]/s, { timeout: 4000 });
    await chatPane(page).getByRole("button", { name: /remove/i }).first().click({ timeout: 4000 });
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
  });

  test("24.5 a bad image request does not harm the server", async ({ page, app }) => {
    await page.goto(app.url);
    const name = app.url.split("/p/")[1];
    for (const path of ["", "..%2F..%2Fpackage.json", "%2e%2e/%2e%2e/package.json"]) {
      const res = await fetch(`${app.origin}/api/projects/${name}/attachments/${path}`);
      expect(res.status).toBe(404);
    }
    await composer(page).click();
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox")).toBeVisible({ timeout: 4000 });
  });
});

const servers: BrowserServer[] = [];
async function startBrowserServerOnce() {
  const s = await startBrowserServer({});
  await s.start();
  servers.push(s);
  return s;
}
test.afterAll(async () => {
  for (const s of servers) await s.dispose();
});
