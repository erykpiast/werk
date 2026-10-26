// Held-out browser tests: the server, live updates, routes, dev mode, the header (steps 13, 14, 17, 69).
import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test as base } from "@playwright/test";
import { Harness, FAKE_BIN } from "../e2e/harness.ts";
import { project, stop, type Werk } from "../e2e/project.ts";
import { cleanEnv } from "../src/test/clean-env.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const test = base.extend<{ harness: Harness }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture
  harness: async ({}, use) => {
    const h = new Harness();
    await use(h);
    await h.close();
  },
});
test.afterEach(stop);

const card = (w: Pick<Werk, "seed">, id: string, f: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...f });
const flag = (p: Page) => p.evaluate(() => ((window as any).kept = true));
const same = (p: Page) => p.evaluate(() => (window as any).kept === true);
const h1 = (p: Page, name?: string) => (name ? p.getByRole("heading", { level: 1, name }) : p.getByRole("heading", { level: 1 }));

// ---------- raw project for tests that need several servers
const roots: string[] = [];
const procs: ChildProcess[] = [];
test.afterEach(async () => {
  for (const pr of procs.splice(0)) if (pr.exitCode === null) pr.kill("SIGKILL");
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});
function rawProject(titles: string[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-held-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const fake = join(root, "fake");
  mkdirSync(fake);
  const log = join(dir, ".werk", "log.jsonl");
  const ev = (type: string, payload: object) => `${JSON.stringify({ seq: readFileSync(log, "utf8").split("\n").filter(Boolean).length + 1, at: "t", actor: "you", type, payload })}\n`;
  writeFileSync(log, "");
  appendFileSync(log, ev("node.added", { id: "root", kind: "card", title: "Root" }));
  for (const t of titles) appendFileSync(log, ev("node.added", { id: t, kind: "card", title: `Card ${t}`, parent: "root" }));
  const env = { ...cleanEnv(process.env, FAKE_BIN), FAKE_AGENT_DIR: fake } as Record<string, string>;
  const serve = () => {
    const pr = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    procs.push(pr);
    const s = { pr, out: "", err: "", t0: Date.now(), up: undefined as number | undefined, url: "" };
    pr.stdout?.on("data", (c: Buffer) => {
      s.out += c;
      const m = /http:\/\/\S+/.exec(s.out);
      if (m && !s.url) {
        s.url = m[0].replace(/\/map$/, "");
        s.up = Date.now() - s.t0;
      }
    });
    pr.stderr?.on("data", (c: Buffer) => (s.err += c));
    const exited = new Promise<number | null>((r) => pr.once("exit", (c) => r(c)));
    return { ...s, get out() { return s.out; }, get err() { return s.err; }, get url() { return s.url; }, get up() { return s.up; }, exited, proc: pr, t0: s.t0 };
  };
  const werk = (...a: string[]) => {
    const r = require("node:child_process").spawnSync("bun", [CLI, ...a], { cwd: dir, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout as string;
  };
  return { dir, log, serve, werk };
}
const until = async (f: () => boolean, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !f()) await new Promise((r) => setTimeout(r, 50));
  return f();
};

test("13.1", async ({ page: p }) => {
  const w = rawProject(["a", "b"]);
  const s1 = w.serve();
  const s2 = w.serve();
  await until(() => s1.url !== "" || s2.url !== "");
  const [winner, loser] = s1.url !== "" ? [s1, s2] : [s2, s1];
  const code = await Promise.race([loser.exited, new Promise<string>((r) => setTimeout(() => r("timeout"), 30000))]);
  console.log("13.1 loser exit:", code, "stderr:", JSON.stringify(loser.err), "stdout:", JSON.stringify(loser.out));
  expect(code).not.toBe("timeout");
  expect(code).not.toBe(0);
  const msg = loser.err + loser.out;
  expect(msg).toContain(String(winner.proc.pid));
  expect(msg).toContain(String(new URL(winner.url).port));
  expect(loser.url).toBe("");
  await p.goto(`${winner.url}/map`);
  await expect(p.locator('a[data-tile="a"]')).toBeVisible();
  await expect(p.locator('a[data-tile="b"]')).toBeVisible();
});

test("13.2", async ({ page: p }) => {
  const w = rawProject(["a"]);
  const s1 = w.serve();
  await until(() => s1.url !== "");
  s1.proc.kill("SIGKILL");
  await s1.exited;
  const s2 = w.serve();
  await until(() => s2.url !== "", 20000);
  console.log("13.2 second start ms:", s2.up, "err:", JSON.stringify(s2.err));
  expect(s2.url).not.toBe("");
  expect(s2.up!).toBeLessThan(4000);
  expect(s2.err).not.toMatch(/wait/i);
  await p.goto(`${s2.url}/map`);
  await expect(p.locator('a[data-tile="a"]')).toBeVisible();
});

test("13.3", async ({ browser }) => {
  const w = await project(undefined, (d) => card(d, "one"));
  const ctx = await browser.newContext();
  const tabs = [await ctx.newPage(), await ctx.newPage()];
  for (const t of tabs) {
    await t.goto(`${w.url}/map`);
    await expect(t.locator('a[data-tile="one"]')).toBeVisible();
    await flag(t);
    await t.evaluate(() => {
      (window as any).__ev = [];
      const es = new EventSource("/api/events");
      es.addEventListener("changed", (e) => (window as any).__ev.push((e as MessageEvent).data));
      return new Promise((r) => es.addEventListener("open", () => r(null)));
    });
  }
  w.werk("add", "two", "--title", "Second", "--parent", "root");
  for (const t of tabs) {
    await expect(t.locator('a[data-tile="two"]')).toBeVisible();
    const evs = await t.evaluate(() => (window as any).__ev as string[]);
    console.log("13.3 events:", JSON.stringify(evs));
    expect(evs.length).toBe(1);
    expect(evs[0]).not.toMatch(/Second|title|two/);
    expect(await same(t)).toBe(true);
  }
});

test("13.4", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.werk("add", "invoice", "--title", "The invoice shows the seat count", "--why", "A customer checks the bill", "--body", "Each line names the seats billed", "--parent", "root");
  });
  const bodies: string[] = [];
  p.on("response", (r) => { if (r.url().includes("/api/")) void r.text().then((t) => bodies.push(t), () => undefined); });
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="invoice"]');
  await expect(tile).toContainText("The invoice shows the seat count");
  await expect(p.locator("body")).not.toContainText("Each line names the seats billed");
  expect(bodies.join("")).not.toContain("Each line names the seats billed");
  await tile.click();
  await expect(p.locator('[data-field="body"]')).toContainText("Each line names the seats billed");
  await expect(p.locator('[data-field="why"]')).toContainText("A customer checks the bill");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Root");
});

test("13.5", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/retry`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const send = (path: string, o: { method?: string; host?: string; token?: string; body?: string } = {}) => {
    const { port } = new URL(w.url);
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path, method: o.method ?? "GET", headers: { host: o.host ?? `localhost:${port}`, "content-type": "application/json", ...(o.token ? { "x-werk-token": o.token } : {}) } }, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end(o.body);
    });
  };
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send("/api/accept", write)).status).toBe(403);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect((await send("/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send("/api/card/retry");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card.id).toBe("retry");
});

// ---------- 14
test("14.1", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "child", { title: "Child" }));
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
  await p.goto(`${w.url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");
  await p.goto(`${w.url}/map/no-card-here`);
  await expect(p.locator('[data-missing="no-card-here"]')).toBeVisible();
  await expect(h1(p, "Root")).toHaveCount(0);
  await expect(h1(p, "Child")).toHaveCount(0);
});

test("14.2", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await flag(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await same(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toBeVisible();
  await flag(p);
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--why", "x", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline", { timeout: 30000 });
});

const edit = (file: string, from: string, to: string) => {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${from}`);
  writeFileSync(file, text.replace(from, to));
};

test("14.4", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator("article")).toBeVisible();
  await flag(p);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited here\\n"');
  await expect.poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 20000 }).toBe("werk: edited here\n");
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  w.werk("add", "after", "--title", "After edit", "--why", "w", "--parent", "root");
  await p.goto(`${w.url}/map/root`);
  await expect(p.locator("#view")).toContainText("After edit");
});

test("14.4b live channel survives the edit", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toBeVisible();
  await flag(p);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited again\\n"');
  await expect.poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 20000 }).toBe("werk: edited again\n");
  w.werk("add", "after2", "--title", "After edit", "--why", "w", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await same(p)).toBe(true);
});

test("14.5", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true });
  await p.goto(`${w.url}/map/retry`);
  const title = await h1(p).textContent();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await flag(p);
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 20000 });
  expect(await same(p)).toBe(false);
  await expect(h1(p)).toHaveText(title ?? "");
  await expect(composer).toHaveValue("draft that must survive");
});

// ---------- 17
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, n: string) => p.locator(`#header [data-count="${n}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("17.1", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 700 });
  const w = await project(undefined, (d) => {
    card(d, "a", { title: "Card a" });
    card(d, "b", { title: "Card b", parent: "a" });
    card(d, "c", { title: "Card c", parent: "b" });
    card(d, "d", { title: "Card d", parent: "c" });
  });
  await p.goto(`${w.url}/`);
  await p.goto(`${w.url}/map/c`);
  await p.goto(`${w.url}/map/b`);
  await p.locator('a[data-tile="c"]').click();
  await p.locator('a[data-tile="d"]').click();
  const pane = await crumbs(p).boundingBox();
  console.log("17.1 crumbs width", pane?.width);
  await expect(crumbs(p).locator('[data-role="cut"]')).toHaveText("…");
  await expect(crumbs(p)).toContainText("›");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card d");
  expect(await crumbs(p).locator('[aria-current="page"]').evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(crumbs(p)).toContainText("Card c");
  await crumbs(p).hover();
  const full = p.locator('[data-role="crumbs-full"]');
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);
  await crumbs(p).getByRole("button", { name: "Card c" }).click();
  await expect(p).toHaveURL(/\/map\/c$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", { status: "open" });
    card(d, "b", { status: "proto" });
    card(d, "c");
    card(d, "e");
    card(d, "base");
    d.seed("edge.added", { from: "e", to: "base", type: "depends_on", why: "w" });
    d.seed("node.reopened", { id: "base", reason: "invalidated", why: "x" });
    card(d, "k1", { parent: "a" });
  });
  await p.goto(`${w.url}/map/root`);
  const total = Number(await count(p, "total").textContent());
  console.log("17.2 total", total, await p.locator("#header [data-count]").evaluateAll((e) => e.map((x) => [x.getAttribute("data-count"), x.textContent, x.getAttribute("title")])));
  let sum = 0;
  for (const s of ["open", "proto", "decided"]) if ((await count(p, s).count()) > 0) sum += Number(await count(p, s).textContent());
  expect(sum).toBe(total);
  await expect(count(p, "open")).toHaveAttribute("title", /open/);
  await expect(count(p, "proto")).toHaveAttribute("title", /proto/);
  await expect(count(p, "decided")).toHaveAttribute("title", /decided/);
  await p.locator('a[data-tile="a"]').click();
  await expect(count(p, "total")).toHaveText("2");
  await expect(count(p, "proto")).toHaveCount(0);
});

test("17.3", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "vi-werk", { title: "Notes on werk" });
    card(d, "werk", { title: "werk v0" });
    card(d, "werk-stack", { title: "The stack", parent: "werk" });
    for (let i = 0; i < 12; i++) card(d, `werk-x${i}`, { title: `X${i}` });
    d.seed("edge.added", { from: "werk-stack", to: "werk", type: "depends_on", why: "w" });
    d.seed("node.reopened", { id: "werk", reason: "invalidated", why: "x" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows).toHaveCount(12);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id")));
  expect(ids[0]).toBe("werk");
  expect(ids.indexOf("vi-werk")).toBe(-1);
  await expect(rows.first().locator('[data-role="dot"]')).toBeVisible();
  await expect(rows.first().locator("code")).toHaveText("werk");
  await expect(rows.first()).toContainText("werk v0");
  expect(await p.locator('[role="option"][data-id="werk-stack"] [data-role="dot"]').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(220, 38, 38)");
  await search(p).press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(search(p)).toHaveValue("");
});

test("17.4", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  const tab = (n: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name: n });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(h1(p)).toHaveText("The invoice");
});

test("17.5", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "pay", { title: "Customers pay online", why: "Because" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How we build", status: "decided", who: "me" });
    card(d, "tests", { title: "Tests run on Bun", parent: "how" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(what).toContainText("Because");
  await expect(how).toContainText("How we build");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await expect(what.locator("[data-count], [data-role='rollup']").first()).toBeVisible();
  await expect(how.locator("[data-count], [data-role='rollup']").first()).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
});

test("17.5b no how card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "pay", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  await expect(how.locator('article[data-empty="true"]')).toContainText(/build rules/i);
  expect(await how.locator("[data-tile]").count()).toBe(0);
});

// ---------- 69
test("69.1", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "c1", { title: "Child one" });
    card(d, "c2", { title: "Child two" });
    card(d, "g1", { title: "Grand child", parent: "c1" });
  });
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="c1"]')).toBeVisible();
  await expect(p.locator('a[data-tile="c2"]')).toBeVisible();
  await expect(p.locator('a[data-tile="g1"]')).toHaveCount(0);
  await p.locator('a[data-tile="c1"]').click();
  await expect(p.locator('a[data-tile="g1"]')).toBeVisible();
});

test("69.2", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await flag(p);
  w.werk("add", "log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  await expect(p.locator('a[data-tile="log"]')).toBeVisible({ timeout: 10000 });
  expect(await same(p)).toBe(true);
});

test("69.3", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "c1", { title: "Child one" }));
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="c1"]').click();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(h1(p)).toHaveText("Child one");
  await expect(p.locator("[contenteditable]")).toHaveCount(0);
  await expect(p.getByRole("button", { name: /edit|rename|retitle/i })).toHaveCount(0);
  await expect(p.getByRole("textbox", { name: /title|body/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(h1(p)).toHaveText("Child one");
});

test("69.4", async () => {
  const w = rawProject(["a"]);
  const s1 = w.serve();
  await until(() => s1.url !== "");
  const s2 = w.serve();
  const t0 = Date.now();
  await until(() => /wait/i.test(s2.err + s2.out), 5000);
  const waitMsg = s2.err + s2.out;
  const code = await Promise.race([s2.exited, new Promise<string>((r) => setTimeout(() => r("timeout"), 15000))]);
  const took = Date.now() - t0;
  console.log("69.4 msg:", JSON.stringify(waitMsg), "code", code, "took", took, "final", JSON.stringify(s2.err + s2.out));
  expect(waitMsg).toMatch(/wait/i);
  expect(waitMsg).toContain(String(s1.proc.pid));
  expect(code).not.toBe("timeout");
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(8000);
  expect(s2.err + s2.out).toContain(String(s1.proc.pid));
  const res = await fetch(`${s1.url}/api/home`);
  expect(res.status).toBe(200);
});
