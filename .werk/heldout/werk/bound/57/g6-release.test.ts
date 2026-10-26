import { beforeAll, afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const HERE = `${process.platform}-${process.arch}`;
const root = mkdtempSync(join(tmpdir(), "werk-g6-release-"));
const out = join(root, "out");
let buildResult: { code: number; stderr: string } = { code: -1, stderr: "" };
const children: Bun.Subprocess[] = [];

const freePort = () =>
  new Promise<number>((res) => {
    const p = createServer();
    p.listen(0, "127.0.0.1", () => {
      const { port } = p.address() as { port: number };
      p.close(() => res(port));
    });
  });

/** A folder with only the executable in it. */
function emptyWith(exe: string): { dir: string; exe: string; home: string } {
  const dir = mkdtempSync(join(root, "empty-"));
  const home = mkdtempSync(join(root, "home-"));
  const copy = join(dir, "werk");
  copyFileSync(exe, copy);
  Bun.spawnSync(["chmod", "+x", copy]);
  return { dir, exe: copy, home };
}
const cleanPath = "/usr/bin:/bin";
const envFor = (home: string, extra: Record<string, string> = {}) => ({
  PATH: cleanPath, HOME: home, WERK_HOME: join(home, "werk"), ...extra,
});

async function serve(dir: string, exe: string, env: Record<string, string>) {
  const port = await freePort();
  const child = Bun.spawn([exe, "serve", "--port", String(port)], {
    cwd: dir, env, stdout: "pipe", stderr: "pipe",
  });
  children.push(child);
  let output = "";
  const pump = async (s: ReadableStream<Uint8Array>) => {
    for await (const c of s) output += new TextDecoder().decode(c);
  };
  void pump(child.stdout as ReadableStream<Uint8Array>);
  void pump(child.stderr as ReadableStream<Uint8Array>);
  const end = Date.now() + 30000;
  while (!/serving on/.test(output) && Date.now() < end && child.exitCode === null) {
    await Bun.sleep(100);
  }
  return { port, child, output: () => output };
}

beforeAll(() => {
  const r = Bun.spawnSync(["bun", "src/release/build.ts", out], { cwd: REPO, stderr: "pipe", stdout: "pipe" });
  buildResult = { code: r.exitCode, stderr: r.stderr.toString() };
}, 300000);
afterAll(() => {
  for (const c of children) c.kill("SIGKILL");
  rmSync(root, { recursive: true, force: true });
});

test("49.1 release build makes four executables with matching checksums", () => {
  expect(buildResult.code, buildResult.stderr).toBe(0);
  for (const p of PLATFORMS) {
    const file = join(out, `werk-${p}`);
    expect(existsSync(file), file).toBe(true);
    const sum = `${file}.sha256`;
    expect(existsSync(sum)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(sum, "utf8")).toContain(digest);
  }
});

test("49.2 executable serves the client from an empty folder", async () => {
  const exe = join(out, `werk-${HERE}`);
  const { dir, exe: copy, home } = emptyWith(exe);
  // werk requires a git repository in the project folder, so the person runs git init first.
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir, env: envFor(home) });
  const before = readdirSync(dir).sort();
  const s = await serve(dir, copy, envFor(home));
  expect(s.output()).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
  const page = await fetch(`http://127.0.0.1:${s.port}/`);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('id="screen"');
  const src = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  expect(src).toBeTruthy();
  const asset = await fetch(`http://127.0.0.1:${s.port}${src}`);
  expect(asset.status).toBe(200);
  expect(s.output()).not.toMatch(/ENOENT|not found|missing/i);
  // The .werk folder is the project's own map store, not an unpacked copy of werk.
  const added = readdirSync(dir).filter((n) => !before.includes(n));
  expect(added.filter((n) => n !== ".werk")).toEqual([]);
  const inside = existsSync(join(dir, ".werk")) ? readdirSync(join(dir, ".werk"), { recursive: true }).map(String) : [];
  expect(inside.filter((f) => /\.(html|js|css|md)$/.test(f))).toEqual([]);
}, 60000);

test("49.3 help of the executable lists every command the checkout lists", async () => {
  const exe = join(out, `werk-${HERE}`);
  const { dir, exe: copy, home } = emptyWith(exe);
  const env = envFor(home);
  const help = Bun.spawnSync([copy, "help"], { cwd: dir, env });
  expect(help.exitCode).toBe(0);
  const text = help.stdout.toString();
  expect(text.trim().length).toBeGreaterThan(0);
  const checkout = Bun.spawnSync(["bun", "src/cli.ts", "help"], { cwd: REPO });
  const verbs = checkout.stdout.toString().split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  expect(verbs.length).toBeGreaterThan(10);
  for (const v of verbs) expect(text).toContain(v as string);
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir, env });
  const shown = Bun.spawnSync([copy, "search"], { cwd: dir, env });
  expect(shown.exitCode, shown.stderr.toString()).toBe(0);
  expect(shown.stderr.toString()).not.toMatch(/ENOENT|no such file|not found/i);
});

test("49.4 the agent is told to run werk through the executable path", async () => {
  const exe = join(out, `werk-${HERE}`);
  const { dir, exe: copy, home } = emptyWith(exe);
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir, env: envFor(home) });
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const scriptPath = join(root, "g6-script.json");
  await Bun.write(scriptPath, JSON.stringify({ roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]] } } }));
  const fake = join(REPO, "fake");
  const env = envFor(home, { PATH: `${fake}:${cleanPath}:${process.execPath.replace(/\/bun$/, "")}`, WERK_FAKE_SCRIPT: scriptPath, WERK_OPEN: "true" });
  const s = await serve(dir, copy, env);
  const page = await (await fetch(`http://127.0.0.1:${s.port}/`)).text();
  const token = /name="werk-token" content="([^"]*)"/.exec(page)?.[1] ?? "";
  const list = await (await fetch(`http://127.0.0.1:${s.port}/api/projects`)).json();
  const name = (JSON.stringify(list).match(/"name":"([^"]+)"/) ?? [])[1];
  expect(name).toBeTruthy();
  const res = await fetch(`http://127.0.0.1:${s.port}/api/projects/${name}/chat`, {
    method: "POST",
    headers: { "x-werk-token": token, "content-type": "application/json" },
    body: JSON.stringify({ text: "Show me the map", turn: "t1", card: null }),
  });
  expect(res.status).toBe(202);
  const end = Date.now() + 15000;
  let launches: unknown[] = [];
  while (Date.now() < end) {
    const f = `${scriptPath}.launches.jsonl`;
    launches = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    if (launches.length > 0) break;
    await Bun.sleep(200);
  }
  const args = JSON.stringify(launches);
  expect(launches.length).toBeGreaterThan(0);
  expect(args).toContain(copy);
  expect(args).not.toContain("src/cli.ts");
  expect(args).not.toMatch(/\\"[^"]*\/bun\\" /);
}, 90000);
