import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;

const root = mkdtempSync(join(tmpdir(), "heldout-49-"));
const out = join(root, "out");
let build = { code: -1, text: "" };

beforeAll(() => {
  // The build writes its client into the checkout's dist/ (gitignored); the executables go to a temp folder.
  const run = Bun.spawnSync(["bun", "src/release/build.ts", out], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
  });
  build = {
    code: run.exitCode ?? -1,
    text: run.stdout.toString() + run.stderr.toString(),
  };
}, 280_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** An empty folder that holds only a copy of the executable, with a git repo for the server. */
function emptyFolder() {
  const dir = join(root, `empty-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir);
  const exe = join(dir, "werk");
  cpSync(join(out, `werk-${here}`), exe);
  chmodSync(exe, 0o755);
  const env = { PATH: "/usr/bin:/bin", HOME: join(root, "home") };
  mkdirSync(env.HOME, { recursive: true });
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir, env });
  return { dir, exe, env };
}

async function serve(exe: string, dir: string, env: Record<string, string>) {
  const child = Bun.spawn([exe, "serve", "--port", "0"], {
    cwd: dir,
    env: { ...env, WERK_HOME: join(root, `wh-${Math.random()}`), WERK_OPEN: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  let seen = "";
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += new TextDecoder().decode(value);
    const m = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(seen);
    if (m) return { child, address: m[1] as string, seen };
  }
  child.kill();
  throw new Error(`executable did not serve: ${seen}`);
}

test("49.1 the release build makes four executables with matching checksums", () => {
  expect(build.text).not.toBe("");
  expect(build.code, build.text).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8").split(/\s+/)[0]).toBe(digest);
  }
}, 30_000);

test("49.2 the executable serves the client from an empty folder", async () => {
  const { dir, exe, env } = emptyFolder();
  const before = readdirSync(dir).sort();
  const { child, address, seen } = await serve(exe, dir, env);
  try {
    expect(seen).toContain("werk: serving on");
    const page = await fetch(`${address}/`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('id="screen"');
    const src = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
    expect(src).toBeTruthy();
    expect((await fetch(`${address}${src}`)).status).toBe(200);
    const css = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/.exec(html)?.[1];
    if (css) expect((await fetch(`${address}${css}`)).status).toBe(200);
  } finally {
    child.kill();
    await child.exited;
  }
  const after = readdirSync(dir).filter((f) => f !== ".git").sort();
  // .werk is the project's own map folder, which the server makes in the project; it holds no app files.
  const added = after.filter((f) => !before.includes(f) && f !== ".werk");
  expect(added).toEqual([]);
  const werkDir = join(dir, ".werk");
  const inside = existsSync(werkDir) ? readdirSync(werkDir) : [];
  expect(inside.filter((f) => /^(client|src|dist|node_modules|assets)$/.test(f))).toEqual([]);
}, 60_000);

test("49.3 the help of the executable lists every verb that the checkout lists", () => {
  const { dir, exe, env } = emptyFolder();
  const exeHelp = Bun.spawnSync([exe, "help"], { cwd: dir, env });
  const srcHelp = Bun.spawnSync(["bun", join(REPO, "src/cli.ts"), "help"], {
    cwd: dir,
    env: { ...env, PATH: process.env.PATH ?? "" },
  });
  expect(exeHelp.exitCode).toBe(0);
  const a = exeHelp.stdout.toString();
  const b = srcHelp.stdout.toString();
  expect(a.split("\n").filter((l) => l.startsWith("  ")).length).toBeGreaterThan(10);
  expect(a).toBe(b);
  // A listed command works with the executable and names no missing file.
  const add = Bun.spawnSync([exe, "add", "x", "--title", "T"], { cwd: dir, env });
  expect(add.exitCode, add.stderr.toString()).toBe(0);
  const show = Bun.spawnSync([exe, "show", "x"], { cwd: dir, env });
  expect(show.exitCode, show.stderr.toString()).toBe(0);
  expect(show.stderr.toString() + show.stdout.toString()).not.toMatch(
    /ENOENT|no such file|not found/i,
  );
}, 60_000);

test("49.4 the agent is told to run werk by the path of the running executable", async () => {
  const { dir, exe, env } = emptyFolder();
  const script = join(root, "script.json");
  await Bun.write(
    script,
    JSON.stringify({
      roles: {
        chat: {
          replies: [
            [
              {
                event: {
                  type: "assistant",
                  message: { id: "m1", content: [{ type: "text", text: "ok" }] },
                },
              },
            ],
          ],
        },
      },
    }),
  );
  const fake = join(REPO, "fake");
  const child = Bun.spawn([exe, "serve", "--port", "0"], {
    cwd: dir,
    env: {
      ...env,
      PATH: `${fake}:${process.env.PATH}`,
      WERK_FAKE_SCRIPT: script,
      WERK_HOME: join(root, "wh-49-4"),
      WERK_OPEN: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = child.stdout.getReader();
    let seen = "";
    let address = "";
    const end = Date.now() + 30_000;
    while (!address && Date.now() < end) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
      address = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(seen)?.[1] ?? "";
    }
    expect(address).not.toBe("");
    const html = await (await fetch(`${address}/`)).text();
    const token = /name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
    const name = dir.split("/").pop();
    const post = await fetch(`${address}/api/projects/${name}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-werk-token": token },
      body: JSON.stringify({ text: "add a card", card: null, turn: "t1" }),
    });
    expect([200, 202]).toContain(post.status);
    let records: { kind: string; args?: string[] }[] = [];
    const log = `${script}.launches.jsonl`;
    const until = Date.now() + 20_000;
    while (Date.now() < until && records.filter((r) => r.kind === "launch").length === 0) {
      await Bun.sleep(200);
      records = existsSync(log)
        ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [];
    }
    const launch = records.find((r) => r.kind === "launch");
    expect(launch).toBeTruthy();
    const args = launch?.args ?? [];
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(prompt).toContain(`"${realpathSync(exe)}" add`);
    expect(prompt).not.toContain("cli.ts");
    expect(prompt).not.toMatch(/"[^"]*\/bun"/);
  } finally {
    child.kill();
  }
}, 90_000);
