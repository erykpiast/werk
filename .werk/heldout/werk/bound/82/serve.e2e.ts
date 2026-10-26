import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { Harness } from "../e2e/harness.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

type Proj = { dir: string; env: Record<string, string>; root: string };
const roots: string[] = [];
const procs: ChildProcess[] = [];
test.afterEach(async () => {
  for (const p of procs.splice(0)) if (p.exitCode === null) p.kill("SIGKILL");
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function make(cards: string[], extraEnv: Record<string, string> = {}): Proj {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-held-")));
  roots.push(root);
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, "script.json"), JSON.stringify({ roles: {} }));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake, ...extraEnv } as Record<string, string>;
  const lines = [{ id: "root", title: "Root" }, ...cards.map((id) => ({ id, title: `Card ${id}`, parent: "root" }))];
  writeFileSync(
    join(dir, ".werk", "log.jsonl"),
    `${lines.map((l, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload: { kind: "card", ...l } })).join("\n")}\n`,
  );
  return { dir, env, root };
}
const werk = (p: Proj, ...args: string[]) => {
  const r = spawnSync("bun", [CLI, ...args], { cwd: p.dir, env: p.env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`werk ${args.join(" ")}: ${r.stderr}`);
  return r.stdout as string;
};

type Srv = { proc: ChildProcess; out: () => string; err: () => string; url: () => string | undefined; exited: Promise<number | null> };
function serve(p: Proj, port = 0): Srv {
  const proc = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: p.dir, env: p.env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(proc);
  let out = "";
  let err = "";
  proc.stdout?.on("data", (c: Buffer) => (out += c.toString()));
  proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
  const exited = new Promise<number | null>((r) => proc.once("exit", (c) => r(c)));
  return { proc, out: () => out, err: () => err, url: () => /http:\/\/\S+/.exec(out)?.[0].replace(/\/map$/, ""), exited };
}
async function until<T>(f: () => T | undefined | false, ms = 15000): Promise<T> {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = f();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timeout");
}
const tiles = (p: Page) => p.locator("[data-tile]");

test("[13.1] a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  const proj = make(["one", "two", "three"]);
  const a = serve(proj);
  const b = serve(proj);
  const winner = await Promise.race([
    until(() => (a.url() ? a : undefined)),
    until(() => (b.url() ? b : undefined)),
  ]);
  const loser = winner === a ? b : a;
  const code = await Promise.race([loser.exited, new Promise<string>((r) => setTimeout(() => r("still running"), 12000))]);
  expect(code).not.toBe("still running");
  expect(code).not.toBe(0);
  expect(loser.url()).toBeUndefined();
  expect(loser.err()).toContain(`pid ${winner.proc.pid}`);
  const port = new URL(winner.url() as string).port;
  expect(loser.err()).toContain(port);
  await p.goto(`${winner.url()}/map`);
  await expect(tiles(p)).toHaveCount(3);
});

test("[13.2] a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const proj = make(["one", "two"]);
  const a = serve(proj);
  await until(() => a.url());
  a.proc.kill("SIGKILL");
  await a.exited;
  const t = Date.now();
  const b = serve(proj);
  const url = await until(() => b.url());
  expect(Date.now() - t).toBeLessThan(4000);
  await p.goto(`${url}/map`);
  await expect(tiles(p)).toHaveCount(2);
});

test("[13.3] a page stays in step when a card is added on the command line", async ({ browser }) => {
  const proj = make(["one"]);
  const s = serve(proj);
  const url = (await until(() => s.url())) as string;
  const pages: Page[] = [];
  for (let i = 0; i < 2; i++) {
    const pg = await (await browser.newContext()).newPage();
    await pg.goto(`${url}/map`);
    await expect(tiles(pg)).toHaveCount(1);
    await pg.evaluate(() => {
      const w = window as unknown as { __frames: string[] };
      w.__frames = [];
      const es = new EventSource("/api/events");
      es.addEventListener("changed", (e) => w.__frames.push((e as MessageEvent).data));
    });
    pages.push(pg);
  }
  await new Promise((r) => setTimeout(r, 500));
  werk(proj, "add", "two", "--title", "Second card", "--parent", "root");
  for (const pg of pages) {
    await expect(tiles(pg)).toHaveCount(2);
    const frames = await pg.evaluate(() => (window as unknown as { __frames: string[] }).__frames);
    expect(frames.length).toBe(1);
    expect(frames[0]).toBe("");
  }
});

test("[13.4] a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const proj = make(["one"]);
  werk(proj, "add", "two", "--title", "Second card", "--why", "Because", "--body", "The secret body words", "--parent", "root");
  const s = serve(proj);
  const url = (await until(() => s.url())) as string;
  const bodies: string[] = [];
  p.on("response", (r) => {
    if (r.url().includes("/api/")) void r.text().then((t) => bodies.push(t), () => undefined);
  });
  await p.goto(`${url}/map`);
  await expect(tiles(p)).toHaveCount(2);
  await expect(p.locator("body")).not.toContainText("The secret body words");
  expect(bodies.join("")).not.toContain("The secret body words");
  await p.locator('[data-tile="two"]').click();
  await expect(p.locator('[data-field="body"]')).toHaveText("The secret body words");
  await expect(p.locator('[data-field="why"]')).toContainText("Because");
  await expect(p.locator('[data-tag="status"]')).toBeVisible();
  await expect(p.locator('[data-section="refines"]')).toContainText("Root");
});

function send(url: string, path: string, o: { method?: string; host?: string; token?: string; body?: string } = {}) {
  const { port } = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: o.method ?? "GET", headers: { host: o.host ?? `localhost:${port}`, "content-type": "application/json", ...(o.token ? { "x-werk-token": o.token } : {}) } },
      (res) => {
        let b = "";
        res.on("data", (c: Buffer) => (b += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", reject);
    req.end(o.body);
  });
}

test("[13.5] only the person's own page can write to the map", async ({ page: p }) => {
  const proj = make(["one"]);
  werk(proj, "add", "ghost", "--title", "A ghost", "--parent", "root");
  werk(proj, "add", "ghost2", "--title", "A second ghost", "--parent", "root");
  const s = serve(proj);
  const url = (await until(() => s.url())) as string;
  const log = join(proj.dir, ".werk", "log.jsonl");
  await p.goto(`${url}/map/ghost`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "ghost2" }) };
  expect((await send(url, "/api/accept", write)).status).toBeGreaterThanOrEqual(400);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect((await send(url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(url, "/api/card/one");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card.id).toBe("one");
});

test("[69.4] a second server on the same project waits, then refuses", async ({ page: p }) => {
  const proj = make(["one", "two"]);
  const a = serve(proj);
  const url = (await until(() => a.url())) as string;
  const t = Date.now();
  const b = serve(proj);
  await until(() => /wait/i.test(b.out() + b.err()) || b.proc.exitCode !== null);
  const code = await Promise.race([b.exited, new Promise<string>((r) => setTimeout(() => r("running"), 12000))]);
  expect(code).not.toBe("running");
  expect(code).not.toBe(0);
  expect(Date.now() - t).toBeLessThan(9000);
  expect(b.out() + b.err()).toMatch(/wait/i);
  expect(b.err()).toContain(`pid ${a.proc.pid}`);
  await p.goto(`${url}/map`);
  await expect(tiles(p)).toHaveCount(2);
});

// ---------- 14.3-14.5, with the harness
const heading = (p: Page, title: string) => p.getByRole("heading", { name: title, level: 1 });
test("[14.3] a write made while the server was down shows after the page reconnects", async ({ page: p }) => {
  const h = new Harness();
  try {
    const w = await h.start();
    await p.goto(`${w.url}/map/root`);
    await expect(heading(p, "Ship the checkout")).toBeVisible();
    await w.stop();
    w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
    await w.restart();
    await expect(p.locator("#view")).toContainText("Written offline");
  } finally {
    await h.close();
  }
});
