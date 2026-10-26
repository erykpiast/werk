import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { repoCopy, tempDir } from "./p2-support.ts";

const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const HERE = `${process.platform}-${process.arch}`;
const FAKE_DIR = join(import.meta.dirname, "..", "fake");

test.describe.configure({ mode: "serial" });

let app = "";
let out = "";
let buildOutput = "";
let buildStatus: number | null = null;
const exe = () => join(out, `werk-${HERE}`);

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test.beforeAll(() => {
  // The build writes dist/ inside the repository it runs from, so it runs from a copy.
  app = repoCopy("release");
  out = tempDir("release-out");
  const r = spawnSync("bun", ["src/release/build.ts", out], {
    cwd: app,
    encoding: "utf8",
  });
  buildStatus = r.status;
  buildOutput = (r.stdout ?? "") + (r.stderr ?? "");
});

test.afterAll(() => {
  for (const d of [app, out]) if (d) rmSync(d, { recursive: true, force: true });
});

/** A folder with no source and no Bun on the program path. Returns env for the executable. */
function cleanRun(root: string) {
  const bin = join(root, "bin");
  mkdirSync(bin);
  const git = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  symlinkSync(git, join(bin, "git"));
  const home = join(root, "home");
  mkdirSync(home);
  return { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WERK_HOME: join(root, "werk-home") };
}

test("49.1 the release build makes four executables with matching checksums", () => {
  expect(buildStatus, buildOutput).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), `${file} exists`).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    const sum = readFileSync(`${file}.sha256`, "utf8");
    expect(sum).toBe(`${digest}  werk-${platform}\n`);
  }
  // the checkout got no dist/
  expect(existsSync(join(import.meta.dirname, "..", "dist"))).toBe(false);
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  expect(buildStatus, buildOutput).toBe(0);
  const root = tempDir("run49-2");
  const empty = join(root, "empty");
  mkdirSync(empty);
  const env = cleanRun(root);
  // check that no bun is reachable on this path
  expect(spawnSync("sh", ["-c", "command -v bun"], { env, encoding: "utf8" }).status).not.toBe(0);
  copyFileSync(exe(), join(empty, "werk"));
  chmodSync(join(empty, "werk"), 0o755);

  // literal empty folder (no git repository): record what happens
  const literal = spawnSync(join(empty, "werk"), ["serve", "--port", "0"], {
    cwd: empty, env, encoding: "utf8", timeout: 8000,
  });
  const literalText = `${literal.stdout}${literal.stderr}`;
  console.log(`49.2 literal empty folder (no git): status=${literal.status} output=${literalText.slice(0, 200)}`);

  // an empty project folder: git init only, as the release smoke does
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: empty, env });
  const before = readdirSync(empty).sort();
  let output = "";
  const port = await freePort();
  const child = spawn(join(empty, "werk"), ["serve", "--port", String(port)], { cwd: empty, env });
  try {
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
    await expect.poll(() => output, { timeout: 30000 }).toContain("werk: serving on");
    expect(output).toContain(`http://127.0.0.1:${port}`);
    const errors: string[] = [];
    page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    page.on("requestfailed", (r) => errors.push(`failed ${r.url()}`));
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
    const after = readdirSync(empty).sort();
    // werk keeps its map in the project's .werk folder only after a project is opened; list what is new
    console.log(`49.2 folder before=${before} after=${after}`);
    const added = after.filter((n) => !before.includes(n));
    console.log(`49.2 new next to the executable: ${added}; .werk holds: ${existsSync(join(empty, ".werk")) ? readdirSync(join(empty, ".werk")) : "-"}`);
    // only the project map folder may appear; no unpacked client, verbs or subagents
    expect(added.filter((n) => n !== ".werk")).toEqual([]);
    expect(readdirSync(empty, { recursive: true }).map(String).filter((n) => /\.(html|js|css|md)$/.test(n))).toEqual([]);
  } finally {
    child.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

const verbsOf = (text: string) =>
  text.split("\n").filter((l) => /^  \S/.test(l)).map((l) => l.trim().split(/\s+/)[0]);

test("49.3 the executable help lists the same verbs as a checkout and a listed command works", () => {
  expect(buildStatus, buildOutput).toBe(0);
  const root = tempDir("run49-3");
  const empty = join(root, "empty");
  mkdirSync(empty);
  const env = cleanRun(root);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: empty, env });
  copyFileSync(exe(), join(empty, "werk"));
  chmodSync(join(empty, "werk"), 0o755);
  try {
    const help = spawnSync(join(empty, "werk"), ["help"], { cwd: empty, env, encoding: "utf8" });
    expect(help.status, help.stderr).toBe(0);
    const checkout = spawnSync("bun", [join(app, "src/cli.ts"), "help"], {
      cwd: root, env: { ...process.env, WERK_HOME: join(root, "h2") }, encoding: "utf8",
    });
    expect(checkout.status, checkout.stderr).toBe(0);
    const exeVerbs = verbsOf(help.stdout);
    const srcVerbs = verbsOf(checkout.stdout);
    expect(srcVerbs.length).toBeGreaterThan(10);
    expect(exeVerbs).toContain("help");
    expect(exeVerbs).toEqual(srcVerbs);
    // run listed commands with the executable
    for (const args of [["inbox"], ["search", "anything"], ["stale"]]) {
      expect(exeVerbs).toContain(args[0] as string);
      const r = spawnSync(join(empty, "werk"), args, { cwd: empty, env, encoding: "utf8" });
      const text = `${r.stdout}${r.stderr}`;
      console.log(`49.3 ${args.join(" ")}: status=${r.status} ${text.slice(0, 160).replace(/\n/g, " | ")}`);
      expect(text).not.toMatch(/ENOENT|no such file|cannot find|not found|missing/i);
      expect(r.status).toBe(0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("49.4 the agent is told to run the executable path, and that command works", async ({ page }) => {
  expect(buildStatus, buildOutput).toBe(0);
  const root = tempDir("run49-4");
  const project = join(root, "proj");
  mkdirSync(project);
  const base = cleanRun(root);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: project, env: base });
  const run = join(root, "run");
  mkdirSync(run);
  copyFileSync(exe(), join(run, "werk"));
  chmodSync(join(run, "werk"), 0o755);
  const exePath = realpathSync(join(run, "werk"));
  const command = `"${exePath}" help`;
  const scriptPath = join(root, "script.json");
  const reply = [
    { event: { type: "assistant", message: { id: "t1", content: [{ type: "tool_use", id: "u-t1", name: "Bash", input: { command } }] } } },
    { event: { type: "assistant", message: { id: "t2", content: [{ type: "text", text: "The werk command worked" }] } } },
  ];
  writeFileSync(scriptPath, JSON.stringify({ roles: { chat: { replies: [reply] } } }));
  const env = {
    ...base,
    // the fake agent is a Bun script, so Bun is on the path for the fake only
    PATH: `${FAKE_DIR}:${base.PATH}:${join(root, "bunbin")}`,
    WERK_FAKE_SCRIPT: scriptPath,
    WERK_OPEN: "true",
  };
  const bunPath = spawnSync("sh", ["-c", "command -v bun"], { encoding: "utf8" }).stdout.trim();
  mkdirSync(join(root, "bunbin"));
  symlinkSync(bunPath, join(root, "bunbin", "bun"));
  const port = await freePort();
  let output = "";
  const child: ChildProcess = spawn(exePath, ["serve", "--port", String(port)], { cwd: project, env });
  try {
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
    await expect.poll(() => output, { timeout: 30000 }).toContain("werk: serving on");
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.goto(`http://127.0.0.1:${port}/p/${"proj"}`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Run the werk help command");
    await composer.press("Enter");
    const chat = page.getByRole("complementary", { name: "Chat pane" });
    await expect(chat.getByText("The werk command worked")).toBeVisible({ timeout: 30000 });
    // the command shown to the person
    const shown = await chat.innerText();
    const details = await chat.locator("details").evaluateAll((els) => els.map((e) => e.textContent));
    console.log(`49.4 chat text: ${shown.slice(0, 300).replace(/\n/g, " | ")} details=${JSON.stringify(details).slice(0, 300)}`);
    // what the launch told the agent
    const records = readFileSync(`${scriptPath}.launches.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const launch = records.find((r) => r.kind === "launch");
    const args: string[] = launch.args;
    const i = args.indexOf("--append-system-prompt");
    expect(i, `launch args: ${JSON.stringify(args).slice(0, 400)}`).toBeGreaterThan(-1);
    const prompt = args[i + 1] as string;
    expect(prompt).toContain(command);
    expect(prompt).not.toMatch(/src\/cli\.ts/);
    expect(prompt).not.toMatch(/"[^"\n]*\/bun" /);
    // run the very command that the prompt names, through a shell, in the project folder
    const named = /`("[^"]+") help`/.exec(prompt)?.[1];
    expect(named).toBe(`"${exePath}"`);
    const ran = spawnSync("sh", ["-c", `${named} help`], { cwd: project, env: base, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain("werk <verb>");
    expect(`${ran.stdout}${ran.stderr}`).not.toMatch(/ENOENT|no such file/i);
  } finally {
    child.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});
