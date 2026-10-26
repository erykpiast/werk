import { request } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import { project, served, stop } from "./e2e-project.ts";

test.afterEach(stop);

/** Records every message of each EventSource that the page opens, before any page script runs. */
async function recordSignals(p: Page): Promise<void> {
  await p.addInitScript(() => {
    const seen: { type: string; data: string }[] = [];
    (window as unknown as { __signals: typeof seen }).__signals = seen;
    const Original = window.EventSource;
    class Recording extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("changed", (event) => seen.push({ type: "changed", data: (event as MessageEvent).data }));
        this.addEventListener("message", (event) => seen.push({ type: "message", data: (event as MessageEvent).data }));
      }
    }
    window.EventSource = Recording as typeof EventSource;
  });
}

const signals = (p: Page) =>
  p.evaluate(() => (window as unknown as { __signals: { type: string; data: string }[] }).__signals);

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = await served();
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await recordSignals(tab);
    await tab.goto(`${w.url}/map`);
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Root");
  }
  // Each tab's live channel is open before the add.
  await Promise.all(
    tabs.map((tab) =>
      tab.waitForFunction(() => performance.getEntriesByType("resource").some((e) => e.name.includes("/api/card/"))),
    ),
  );

  w.werk("add", "second", "--title", "Second card arrives", "--parent", "root");
  for (const tab of tabs) {
    await expect(tab.locator('[data-section="subcards"]')).toContainText("Second card arrives");
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Root");
  }
  // A short look for any extra signal after the first.
  await tabs[0]?.waitForTimeout(1000);
  for (const tab of tabs) {
    const got = (await signals(tab)).filter((s) => s.type === "changed");
    expect(got.length).toBe(1);
    expect(got[0]?.data ?? "").toBe("");
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.werk(
    "add",
    "late",
    "--title",
    "Late card",
    "--why",
    "The why of the late card.",
    "--body",
    "The body of the late card.",
    "--parent",
    "root",
  );
  await w.serve();

  const bodies: string[] = [];
  p.on("response", async (response) => {
    try {
      bodies.push(await response.text());
    } catch {
      // A streamed response has no text.
    }
  });
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.getByRole("link", { name: /Late card/ })).toBeVisible();
  await expect(p.locator("body")).not.toContainText("The body of the late card.");
  expect(bodies.some((body) => body.includes("The body of the late card."))).toBe(false);

  await p.getByRole("link", { name: /Late card/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Late card");
  await expect(p.locator("article")).toContainText("The body of the late card.");
  await expect(p.locator("article")).toContainText("The why of the late card.");
  await expect(p.locator('article [data-tag="status"]')).toHaveText("open");
  // Its one neighbour is the card it refines.
  await expect(p.locator("main")).toContainText("Root");
});

function raw(
  url: string,
  options: { method: string; path: string; host?: string; token?: string; body?: string },
): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.host !== undefined) headers.host = options.host;
    if (options.token !== undefined) headers["x-werk-token"] = options.token;
    const req = request(
      { hostname: u.hostname, port: u.port, method: options.method, path: options.path, headers },
      (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => {
          text += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = project();
  w.werk("add", "root", "--title", "Root waits for the check");
  await w.serve();

  await p.goto(`${w.url}/map`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");

  const before = w.lines();
  const noToken = await raw(w.url, {
    method: "POST",
    path: "/api/notes",
    body: JSON.stringify({ id: "root", text: "sneaky note" }),
  });
  expect(noToken.status).toBeGreaterThanOrEqual(400);
  expect(w.lines()).toBe(before);

  const badHost = await raw(w.url, {
    method: "POST",
    path: "/api/notes",
    host: "evil.example",
    token,
    body: JSON.stringify({ id: "root", text: "sneaky note" }),
  });
  expect(badHost.status).toBeGreaterThanOrEqual(400);
  expect(w.lines()).toBe(before);

  const read = await raw(w.url, { method: "GET", path: "/api/card/root" });
  expect(read.status).toBe(200);
  expect(read.text).toContain("Root waits for the check");
});
