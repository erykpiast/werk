import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, SCRIPT_FILE } from "../src/test/fake-script.ts";
import { project, stop } from "../e2e/project.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

const roots: string[] = [];
const procs: ChildProcess[] = [];
test.afterEach(async () => {
  await stop();
  for (const p of procs.splice(0)) if (p.exitCode === null) p.kill("SIGKILL");
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function plain(cards: string[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "heldout-srv-")));
  roots.push(root);
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify({ roles: {} }));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake };
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  let seq = 0;
  const seed = (type: string, payload: object) => appendFileSync(log, `${JSON.stringify({ seq: ++seq, at: "t", actor: "you", type, payload })}\n`);
  seed("node.added", { id: "root", kind: "card", title: "Root" });
  for (const c of cards) seed("node.added", { id: c, kind: "card", title: `Card ${c}`, parent: "root" });
  const serve = (extra: string[] = []) => {
    const p = spawn("bun", [CLI, "serve", "--port", "0", ...extra], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    procs.push(p);
    const o = { out: "", err: "", exited: false, code: null as number | null, at: Date.now() };
    p.stdout?.on("data", (c: Buffer) => (o.out += c.toString()));
    p.stderr?.on("data", (c: Buffer) => (o.err += c.toString()));
    p.on("exit", (code) => {
      o.exited = true;
      o.code = code;
    });
    return { proc: p, o };
  };
  const werk = (...args: string[]) => {
    const { spawnSync } = require("node:child_process");
    const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`werk ${args.join(" ")}: ${r.stderr}`);
    return r.stdout as string;
  };
  return { dir, env, log, seed, serve, werk };
}
const until = async (f: () => boolean, ms = 15000) => {
  const t = Date.now();
  while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 50));
};
const urlOf = (out: string) => /http:\/\/\S+/.exec(out)?.[0]?.replace(/\/map$/, "");

test("[13.1] a second server on the same store refuses", async ({ page: p }) => {
  const w = plain(["a", "b"]);
  const one = w.serve();
  const two = w.serve();
  await until(() => (urlOf(one.o.out) !== undefined || urlOf(two.o.out) !== undefined) && (one.o.exited || two.o.exited), 20000);
  const winner = urlOf(one.o.out) !== undefined ? one : two;
  const loser = winner === one ? two : one;
  console.log("WINNER OUT:", winner.o.out, "LOSER:", loser.o.out, loser.o.err, "code", loser.o.code, "after ms", Date.now() - loser.o.at);
  expect(urlOf(loser.o.out)).toBeUndefined();
  expect(loser.o.exited).toBe(true);
  expect(loser.o.code).not.toBe(0);
  expect(loser.o.err).toContain(String(winner.proc.pid));
  const port = new URL(urlOf(winner.o.out) as string).port;
  expect(loser.o.err).toContain(port);
  await p.goto(`${urlOf(winner.o.out)}/map`);
  await expect(p.locator('a[data-tile="a"]')).toBeVisible();
  await expect(p.locator('a[data-tile="b"]')).toBeVisible();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
});

test("[13.2] a killed server's lock does not block a new one", async ({ page: p }) => {
  const w = plain(["a", "b"]);
  const one = w.serve();
  await until(() => urlOf(one.o.out) !== undefined);
  expect(urlOf(one.o.out)).toBeDefined();
  one.proc.kill("SIGKILL");
  await until(() => one.o.exited);
  const two = w.serve();
  const t0 = Date.now();
  await until(() => urlOf(two.o.out) !== undefined || two.o.exited, 20000);
  const waited = Date.now() - t0;
  console.log("RESTART MS", waited, two.o.out, two.o.err);
  expect(urlOf(two.o.out)).toBeDefined();
  expect(waited).toBeLessThan(4000);
  await p.goto(`${urlOf(two.o.out)}/map`);
  await expect(p.locator('a[data-tile="a"]')).toBeVisible();
  await expect(p.locator('a[data-tile="b"]')).toBeVisible();
});

test("[69.4] a second server waits for the first's process id, then errors", async () => {
  const w = plain(["a"]);
  const one = w.serve();
  await until(() => urlOf(one.o.out) !== undefined);
  const two = w.serve();
  await until(() => two.o.exited, 15000);
  console.log("SECOND:", two.o.out, two.o.err, "exit", two.o.code, "ms", Date.now() - two.o.at);
  expect(two.o.exited).toBe(true);
  expect(Date.now() - two.o.at).toBeLessThan(8000);
  expect(two.o.code).not.toBe(0);
  expect(two.o.err).toContain(String(one.proc.pid));
  expect(`${two.o.out}${two.o.err}`.toLowerCase()).toMatch(/wait/);
  const r = await fetch(`${urlOf(one.o.out)}/api/card/root`);
  expect(r.status).toBe(200);
});

test("[13.3] two open tabs stay in step with a command-line add", async ({ browser }) => {
  const w = await project(undefined, () => undefined);
  const mk = async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${w.url}/map/root`);
    await page.evaluate(() => {
      const seen: { type: string; data: string }[] = [];
      (window as any).__seen = seen;
      const es = new EventSource("/api/events");
      for (const t of ["changed", "message"]) es.addEventListener(t, (e) => seen.push({ type: t, data: (e as MessageEvent).data }));
    });
    return page;
  };
  const one = await mk();
  const two = await mk();
  await new Promise((r) => setTimeout(r, 500));
  w.werk("add", "second", "--title", "Second card", "--why", "w", "--parent", "root");
  for (const pg of [one, two]) {
    await expect(pg.locator("#view")).toContainText("Second card");
    const seen = (await pg.evaluate(() => (window as any).__seen)) as { type: string; data: string }[];
    console.log("SEEN", seen);
    expect(seen.filter((s) => s.type === "changed").length).toBe(1);
    for (const s of seen) expect(s.data).not.toContain("Second card");
  }
});

test("[13.4] a card added while the server was down shows on first load", async ({ page: p }) => {
  const bodies: string[] = [];
  const w = await project(undefined, (down) => {
    down.werk("add", "second", "--title", "Second card", "--why", "Second why words", "--body", "Second body words here", "--parent", "root");
  });
  p.on("response", (r) => {
    if (r.url().includes("/api/")) void r.text().then((t) => bodies.push(t), () => undefined);
  });
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  const tile = p.locator('a[data-tile="second"]');
  await expect(tile).toContainText("Second card");
  await expect(p.locator("body")).not.toContainText("Second body words here");
  expect(bodies.join("")).not.toContain("Second body words here");
  await tile.click();
  await expect(p.locator('[data-field="body"]')).toHaveText("Second body words here");
  await expect(p.locator('[data-field="why"]')).toContainText("Second why words");
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
        headers: { host: o.host ?? `localhost:${port}`, "content-type": "application/json", ...(o.token === undefined ? {} : { "x-werk-token": o.token }) },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(o.body);
  });
}

test("[13.5] only the person's own page can write", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/retry`);
  await p.locator('button[data-action="accept"]').click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(w.url, "/api/accept", write)).status).toBeGreaterThanOrEqual(400);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  expect((await send(w.url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/retry");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card.id).toBe("retry");
});
