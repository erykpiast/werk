import { beforeAll, afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dir, "..");
const root = mkdtempSync(join(tmpdir(), "werk-heldout-rel-"));
const out = join(root, "out");
const here = `${process.platform}-${process.arch}`;
let built = { code: -1, stderr: "" };

beforeAll(() => {
  const r = Bun.spawnSync(["bun", "src/release/build.ts", out], { cwd: REPO });
  built = { code: r.exitCode ?? -1, stderr: r.stderr.toString() };
}, 300_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

/** A folder holding only the executable, a git repo, and an env with no werk state. */
function emptyFolder() {
  const dir = mkdtempSync(join(root, "empty-"));
  copyFileSync(join(out, `werk-${here}`), join(dir, "werk"));
  Bun.spawnSync(["chmod", "+x", join(dir, "werk")]);
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir });
  const env: Record<string, string> = {
    PATH: "/usr/bin:/bin",
    HOME: mkdtempSync(join(root, "home-")),
    WERK_HOME: mkdtempSync(join(root, "wh-")),
    WERK_OPEN: "true",
  };
  return { dir, exe: join(dir, "werk"), env };
}

async function serve(exe: string, dir: string, env: Record<string, string>) {
  const child = Bun.spawn([exe, "serve", "--port", "0"], {
    cwd: dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const dec = new TextDecoder();
  let seen = "";
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += dec.decode(value);
    const m = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(seen);
    if (m) return { child, address: m[1] as string, seen };
  }
  child.kill();
  throw new Error(`no address: ${seen}`);
}

test("49.1 the release build makes four executables with matching checksums", () => {
  expect(built.code, built.stderr).toBe(0);
  for (const p of PLATFORMS) {
    const f = join(out, `werk-${p}`);
    expect(existsSync(f)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(f)).digest("hex");
    expect(readFileSync(`${f}.sha256`, "utf8")).toContain(digest);
  }
}, 300_000);

test("49.2 the executable alone in an empty folder serves the client page and its assets, and writes no folder", async () => {
  const { dir, exe, env } = emptyFolder();
  const before = readdirSync(dir).sort();
  const { child, address } = await serve(exe, dir, env);
  try {
    const page = await fetch(`${address}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="screen"');
    const src = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
    expect(src).toBeTruthy();
    expect((await fetch(`${address}${src}`)).status).toBe(200);
    const css = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/.exec(html)?.[1];
    if (css) expect((await fetch(`${address}${css}`)).status).toBe(200);
    // .werk is the project's own map folder; any other new entry would be extracted werk files.
    expect(
      readdirSync(dir).filter((n) => !before.includes(n) && n !== ".werk"),
    ).toEqual([]);
  } finally {
    child.kill();
  }
}, 120_000);

test("49.3 the executable help lists the same verbs as a checkout, and a listed command works", () => {
  const { dir, exe, env } = emptyFolder();
  const exeHelp = Bun.spawnSync([exe, "help"], { cwd: dir, env });
  const srcHelp = Bun.spawnSync(["bun", "src/cli.ts", "help"], { cwd: REPO });
  expect(exeHelp.exitCode).toBe(0);
  const a = exeHelp.stdout.toString();
  expect(a.trim()).not.toBe("");
  expect(a).toBe(srcHelp.stdout.toString());
  expect(a.split("\n").filter((l) => /^ {2}\S/.test(l)).length).toBeGreaterThan(10);
  mkdirSync(join(dir, ".werk"));
  const add = Bun.spawnSync([exe, "add", "root", "--title", "Root"], { cwd: dir, env });
  expect(add.stdout.toString().trim()).toBe("proposed");
  const show = Bun.spawnSync([exe, "show", "root"], { cwd: dir, env });
  expect(show.exitCode).toBe(0);
  expect(show.stderr.toString()).not.toMatch(/missing|no such|ENOENT|cannot find/i);
});

test("49.4 the chat agent is launched with instructions that name the executable path, not bun or a source file", async () => {
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
                  message: { content: [{ type: "text", text: "ok" }] },
                },
              },
              { event: { type: "result", subtype: "success", is_error: false, result: "ok" } },
            ],
          ],
        },
      },
    }),
  );
  const fakeDir = join(REPO, "fake");
  const { child, address } = await serve(exe, dir, {
    ...env,
    PATH: `${fakeDir}:${dirname(process.execPath)}:${env.PATH}`,
    WERK_FAKE_SCRIPT: script,
  });
  try {
    const name = dir.split("/").pop();
    const home = await (await fetch(`${address}/`)).text();
    const token = /name="werk-token" content="([^"]*)"/.exec(home)?.[1] ?? "";
    const res = await fetch(`${address}/api/projects/${name}/chat`, {
      method: "POST",
      headers: { "x-werk-token": token, "content-type": "application/json" },
      body: JSON.stringify({ text: "run werk help", card: null, turn: "t1" }),
    });
    expect(res.status).toBeLessThan(300);
    const logPath = `${script}.launches.jsonl`;
    const end = Date.now() + 20_000;
    while (!existsSync(logPath) && Date.now() < end) await Bun.sleep(100);
    const rec = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((r) => r.kind === "launch" && r.role === "chat");
    const i = rec.args.indexOf("--append-system-prompt");
    expect(i).toBeGreaterThan(-1);
    const prompt: string = rec.args[i + 1];
    expect(prompt).toContain(exe);
    expect(prompt).not.toMatch(/bun[^\n]*cli\.ts|src\/cli\.ts/);
    expect(prompt).not.toMatch(/"[^"]*\/bun" /);
  } finally {
    child.kill();
  }
}, 120_000);
