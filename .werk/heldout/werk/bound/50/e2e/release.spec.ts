import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { copyRepo } from "../copy-repo.ts";

const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const HERE = `${process.platform}-${process.arch}`;
const FAKE = join(import.meta.dirname, "..", "..", "fake");

const freePort = () =>
  new Promise<number>((ok) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => ok(port));
    });
  });

test.describe.configure({ mode: "serial" });

let root: string;
let built: string;
let buildOutput = "";
let buildStatus: number | null = null;
test.beforeAll(async () => {
  test.setTimeout(900_000);
  root = mkdtempSync(join(tmpdir(), "werk-heldout-49-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  // The build runs in a copy of the checkout, so it writes its folders there.
  copyRepo(repo);
  const run = spawnSync("make", ["release-build"], { cwd: repo, encoding: "utf8" });
  buildStatus = run.status;
  buildOutput = run.stdout + run.stderr;
  built = join(repo, "dist", "release");
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

const emptyFolder = (name: string, exeName = "werk") => {
  const dir = join(root, name);
  mkdirSync(dir);
  copyFileSync(join(built, `werk-${HERE}`), join(dir, exeName), 0);
  spawnSync("chmod", ["+x", join(dir, exeName)]);
  return dir;
};
// No Bun and no source on the path: only the system folders.
const bare = (extra: Record<string, string> = {}) => ({
  PATH: "/usr/bin:/bin",
  HOME: join(root, "home"),
  ...extra,
});

test("49.1 the release build makes four executables with checksums", () => {
  expect(buildStatus, buildOutput.slice(-2000)).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(built, `werk-${platform}`);
    expect(existsSync(file), `${file} exists`).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    const sum = readFileSync(`${file}.sha256`, "utf8");
    expect(sum).toContain(digest);
    expect(sum).toContain(`werk-${platform}`);
  }
});

let child: ChildProcess | undefined;
test.afterEach(() => {
  child?.kill();
  child = undefined;
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  mkdirSync(join(root, "home"), { recursive: true });
  const dir = emptyFolder("empty2");
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env: bare() });
  const port = await freePort();
  let output = "";
  child = spawn(join(dir, "werk"), ["serve", "--port", String(port)], {
    cwd: dir,
    env: bare({ WERK_HOME: join(root, "werk-home") }),
  });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  await expect.poll(() => output, { timeout: 30000 }).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
  const address = /(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] as string;
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failed.push(String(e)));
  await page.goto(address);
  await expect(page.getByRole("region", { name: "Map pane" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("complementary", { name: "Chat pane" })).toBeVisible();
  expect(failed.filter((f) => !f.includes("favicon"))).toEqual([]);
  const listing = readdirSync(dir).filter((n) => n !== "werk");
  console.log("folder after start:", listing.join(", "));
  // .git is the project's own; .werk is the project's map folder. No folder of werk's own files appears.
  expect(listing.filter((n) => n !== ".git" && n !== ".werk")).toEqual([]);
  const inside = readdirSync(join(dir, ".werk"), { recursive: true }).map(String);
  console.log(".werk holds:", inside.join(", "));
  expect(inside.filter((n) => /\.(html|js|ts|tsx|css|md)$/.test(n))).toEqual([]);
});

test("49.3 the help of the executable lists every command", async () => {
  const dir = emptyFolder("empty3");
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env: bare() });
  const exe = spawnSync(join(dir, "werk"), ["help"], { cwd: dir, env: bare(), encoding: "utf8" });
  const checkout = spawnSync("bun", [join(import.meta.dirname, "..", "..", "src", "cli.ts"), "help"], {
    encoding: "utf8",
  });
  expect(exe.status).toBe(0);
  expect(exe.stdout.trim()).not.toBe("");
  expect(exe.stdout).toBe(checkout.stdout);
  const listed = exe.stdout.split("\n").filter((l) => /^ {2}\S/.test(l)).length;
  expect(listed).toBeGreaterThan(10);
  const ran = spawnSync(join(dir, "werk"), ["find"], { cwd: dir, env: bare(), encoding: "utf8" });
  expect(ran.status).toBe(0);
  expect(ran.stdout + ran.stderr).not.toMatch(/no such file|not found|ENOENT|missing/i);
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  mkdirSync(join(root, "home"), { recursive: true });
  const dir = emptyFolder("empty4");
  const exe = realpathSync(join(dir, "werk"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env: bare() });
  const command = `"${exe}" help`;
  const scriptPath = join(root, "script49.json");
  const script: Script = {
    roles: {
      chat: {
        replies: [
          [
            {
              event: {
                type: "assistant",
                message: { id: "t1", content: [{ type: "tool_use", id: "u1", name: "Bash", input: { command } }] },
              },
            },
            { event: { type: "assistant", message: { id: "t2", content: [{ type: "text", text: "The command worked." }] } } },
          ],
        ],
      },
    },
  };
  writeFileSync(scriptPath, JSON.stringify(script));
  const port = await freePort();
  let output = "";
  // The fake agent is a Bun script, so Bun is on the path of this test only; the executable never uses it.
  child = spawn(exe, ["serve", "--port", String(port)], {
    cwd: dir,
    env: { PATH: `${FAKE}:${process.env.PATH}`, HOME: join(root, "home"), WERK_HOME: join(root, "werk-home4"), WERK_FAKE_SCRIPT: scriptPath, WERK_OPEN: "true" },
  });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  await expect.poll(() => output, { timeout: 30000 }).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
  const address = /(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] as string;
  await page.goto(address);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("run the werk help");
  await composer.press("Enter");
  await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("The command worked.")).toBeVisible({ timeout: 20000 });
  const records = readFileSync(`${scriptPath}.launches.jsonl`, "utf8");
  // The instructions the agent got name the executable's own path, not Bun or a source file.
  const launch = JSON.parse(records.split("\n")[0] as string) as { args: string[] };
  const text = launch.args.join("\n");
  expect(text).toContain(`"${exe}" help`);
  expect(text).not.toMatch(/bun\b.*cli\.ts|src\/cli\.ts/);
  const shown = await page.getByRole("complementary", { name: "Chat pane" }).textContent();
  expect(shown).toContain(exe);
  // The command the instructions name works when it runs.
  const ran = spawnSync("sh", ["-c", `"${exe}" help`], { cwd: dir, env: bare(), encoding: "utf8" });
  expect(ran.status).toBe(0);
});
