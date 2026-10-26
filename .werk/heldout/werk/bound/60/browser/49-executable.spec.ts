import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import { cleanEnv } from "../../src/test-env/env.ts";

const REPO = join(import.meta.dirname, "..", "..");
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test.describe.configure({ mode: "serial" });

let root = "";
let folder = "";
let exe = "";
let env: Record<string, string> = {};
let scriptPath = "";
let child: ChildProcess | undefined;
let origin = "";
let output = "";

test.beforeAll(async () => {
  test.setTimeout(180_000);
  root = mkdtempSync(join(tmpdir(), "werk-49-exe-"));
  const out = join(root, "out");
  const built = spawnSync("bun", ["src/release/build.ts", out, "--current"], { cwd: REPO, encoding: "utf8" });
  expect(built.status, built.stderr).toBe(0);
  folder = join(root, "empty");
  mkdirSync(folder);
  exe = join(folder, "werk");
  copyFileSync(join(out, `werk-${process.platform}-${process.arch}`), exe);
  scriptPath = join(root, "script.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      roles: {
        chat: {
          replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "done" }] } } }]],
        },
      },
    }),
  );
  env = {
    ...cleanEnv(process.env),
    WERK_HOME: join(root, "home"),
    WERK_OPEN: "true",
    WERK_FAKE_SCRIPT: scriptPath,
  };
});

test.afterAll(() => {
  child?.kill("SIGTERM");
  rmSync(root, { recursive: true, force: true });
});

test("49.2 literal empty folder (no git) — what the user sees", () => {
  const run = spawnSync(exe, ["serve", "--port", "0"], { cwd: folder, env, encoding: "utf8", timeout: 20000 });
  // Recorded for the report: a folder with no git repository is refused.
  console.log("LITERAL EMPTY FOLDER:", run.status, run.stdout + run.stderr);
});

test("49.2 the executable serves the client from an empty (git-initialised) folder", async ({ page }) => {
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: folder, env });
  const before = readdirSync(folder).sort();
  const port = await freePort();
  child = spawn(exe, ["serve", "--port", String(port)], { cwd: folder, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  await expect.poll(() => output, { timeout: 30_000 }).toContain("werk: serving on");
  expect(output).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
  origin = `http://127.0.0.1:${port}`;
  const errors: string[] = [];
  const missing: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${origin}/p/${basename(folder)}`);
  await expect(page.locator("#screen")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  expect(errors).toEqual([]);
  expect(missing.filter((m) => !m.includes("favicon"))).toEqual([]);
  const after = readdirSync(folder).sort();
  console.log("FOLDER BEFORE/AFTER", before, after);
  expect(after.filter((n) => !before.includes(n) && n !== ".werk")).toEqual([]);
});

test("49.3 help lists every verb that the checkout lists, and a listed command works", () => {
  const exeHelp = spawnSync(exe, ["help"], { cwd: folder, env, encoding: "utf8" });
  const srcHelp = spawnSync("bun", ["src/cli.ts", "help"], { cwd: REPO, env, encoding: "utf8" });
  expect(exeHelp.status).toBe(0);
  const verbs = (s: string) => s.split("\n").filter((l) => /^  \S/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
  expect(verbs(exeHelp.stdout).length).toBeGreaterThan(10);
  expect(verbs(exeHelp.stdout)).toEqual(verbs(srcHelp.stdout));
  const add = spawnSync(exe, ["add", "root", "--title", "Root"], { cwd: folder, env, encoding: "utf8" });
  expect(add.status, add.stderr).toBe(0);
  const show = spawnSync(exe, ["show", "root"], { cwd: folder, env, encoding: "utf8" });
  expect(show.status, show.stderr).toBe(0);
  expect(show.stdout).toContain("Root");
  expect(show.stderr).not.toMatch(/no such file|ENOENT|not found|missing/i);
});

test("49.4 the agent is told to run werk by the executable path", async ({ page }) => {
  await page.goto(`${origin}/p/${basename(folder)}`);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("add a card");
  await composer.press("Enter");
  await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("done")).toBeVisible();
  const launch = readRecords(logPathFor(scriptPath)).find((r) => r.kind === "launch");
  expect(launch).toBeDefined();
  const args = (launch as { args: string[] }).args;
  const at = args.indexOf("--append-system-prompt");
  expect(at).toBeGreaterThan(-1);
  const prompt = args[at + 1] as string;
  const exePath = process.platform === "darwin" ? `"${(await import("node:fs")).realpathSync(exe)}"` : `"${exe}"`;
  console.log("PROMPT HEAD:", prompt.slice(0, 400));
  expect(prompt).toContain(`${exePath} help`);
  expect(prompt).toContain(`${exePath} add`);
  expect(prompt).not.toMatch(/\bbun\b/);
  expect(prompt).not.toContain("cli.ts");
  // The command the prompt names works.
  const run = spawnSync(exe, ["search", "Root"], { cwd: folder, env, encoding: "utf8" });
  expect(run.status).toBe(0);
});
