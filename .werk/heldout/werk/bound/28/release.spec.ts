import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../src/fake-agent/launch-log.ts";
import { cleanEnv, FAKE_DIR } from "../src/test-env/env.ts";

const REPO = join(import.meta.dirname, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/** Builds once per worker into a folder of its own; each test copies only the executable it needs. */
let built: string | undefined;
function build(): string {
  if (built) return built;
  const out = mkdtempSync(join(tmpdir(), "werk-heldout-release-"));
  const run = spawnSync("bun", ["src/release/build.ts", out], { cwd: REPO, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  built = out;
  return out;
}

/** An empty folder with only the executable, and a bare environment: no source, no Bun on the path. */
function emptyWith(exe: string) {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-empty-"));
  const folder = join(root, "empty");
  mkdirSync(folder);
  copyFileSync(exe, join(folder, "werk"));
  spawnSync("chmod", ["+x", join(folder, "werk")]);
  const home = join(root, "home");
  mkdirSync(home);
  return { root, folder, home, exe: join(folder, "werk") };
}

function startExe(exe: string, cwd: string, env: Record<string, string>, port: number) {
  let output = "";
  const child = spawn(exe, ["serve", "--port", String(port)], { cwd, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  return { child, output: () => output };
}

test("49.1 the release build makes four executables with checksums", async () => {
  test.setTimeout(180_000);
  const out = build();
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), `${file} exists`).toBe(true);
    const sumFile = `${file}.sha256`;
    expect(existsSync(sumFile)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(sumFile, "utf8")).toContain(digest);
  }
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  test.setTimeout(180_000);
  const { root, folder, home, exe } = emptyWith(join(build(), `werk-${here}`));
  let proc: { child: ChildProcess; output: () => string } | undefined;
  try {
    const port = await freePort();
    // No source folder of werk and no Bun on the path.
    const env = { PATH: "/usr/bin:/bin", HOME: home, WERK_HOME: join(root, "werk-home"), WERK_OPEN: "true" };
    proc = startExe(exe, folder, env, port);
    await expect.poll(() => proc?.output() ?? "", { timeout: 30_000 }).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
    const address = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(proc.output())?.[1] as string;
    const bad: string[] = [];
    page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) bad.push(`${r.status()} ${r.url()}`); });
    page.on("pageerror", (e) => bad.push(String(e)));
    await page.goto(address);
    await expect(page.locator("#screen")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(bad).toEqual([]);
    const entries = readdirSync(folder).filter((n) => n !== "werk");
    expect(entries.filter((n) => n !== ".werk" && n !== ".git")).toEqual([]);
  } finally {
    proc?.child.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

test("49.3 the help of the executable lists every command", async () => {
  test.setTimeout(180_000);
  const { root, folder, home, exe } = emptyWith(join(build(), `werk-${here}`));
  try {
    const env = { PATH: "/usr/bin:/bin", HOME: home, WERK_HOME: join(root, "werk-home") };
    const help = spawnSync(exe, ["help"], { cwd: folder, env, encoding: "utf8" });
    expect(help.status).toBe(0);
    const fromSource = spawnSync("bun", ["src/cli.ts", "help"], { cwd: REPO, encoding: "utf8", env: cleanEnv(process.env) });
    const verbsOf = (text: string) =>
      text.split("\n").map((l) => /^\s{2}(\S+)\s/.exec(l)?.[1]).filter((v): v is string => v !== undefined);
    const listed = verbsOf(help.stdout);
    expect(listed.length).toBeGreaterThan(10);
    expect(listed.sort()).toEqual(verbsOf(fromSource.stdout).sort());
    const add = spawnSync(exe, ["add", "root", "--title", "Root"], { cwd: folder, env, encoding: "utf8" });
    expect(add.status, add.stderr).toBe(0);
    expect(add.stderr).not.toMatch(/missing|no such file|ENOENT/i);
    const show = spawnSync(exe, ["show", "root"], { cwd: folder, env, encoding: "utf8" });
    expect(show.status, show.stderr).toBe(0);
    expect(show.stdout).toContain("Root");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  test.setTimeout(180_000);
  const { root, folder, home, exe } = emptyWith(join(build(), `werk-${here}`));
  let proc: { child: ChildProcess; output: () => string } | undefined;
  try {
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: folder });
    const script = join(root, "script.json");
    writeFileSync(
      script,
      JSON.stringify({
        roles: {
          chat: {
            replies: [
              [
                { event: { type: "assistant", message: { id: "t1", content: [{ type: "tool_use", id: "u1", name: "Bash", input: { command: `"${exe}" show root` } }] } } },
                { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "The command worked" }] } } },
              ],
            ],
          },
        },
      }),
    );
    const port = await freePort();
    const env = { ...cleanEnv(process.env), WERK_FAKE_SCRIPT: script, WERK_HOME: join(root, "werk-home"), WERK_OPEN: "true", HOME: home, PATH: `${FAKE_DIR}:/usr/bin:/bin:${process.env.PATH ?? ""}` };
    proc = startExe(exe, folder, env, port);
    await expect.poll(() => proc?.output() ?? "", { timeout: 30_000 }).toMatch(/serving on/);
    const address = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(proc.output())?.[1] as string;
    await page.goto(address);
    const composer = page.getByRole("textbox", { name: "Message" });
    await expect(composer).toBeVisible();
    await composer.fill("Run a werk command");
    await composer.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("The command worked")).toBeVisible({ timeout: 30_000 });
    const launch = readRecords(logPathFor(script)).find((r) => r.kind === "launch");
    const args = (launch?.kind === "launch" ? launch.args : []).join("\n");
    expect(args).toContain(exe);
    expect(args).not.toMatch(/bun (src\/)?cli\.ts/);
    expect(args).not.toMatch(/\bbun\b[^\n]*\.ts/);
  } finally {
    proc?.child.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});
