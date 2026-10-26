import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import { FAKE_DIR } from "../../src/test-env/env.ts";

const REPO = join(import.meta.dirname, "..", "..");
const here = `${process.platform}-${process.arch}`;
const BUN_DIR = dirname(Bun_path());

function Bun_path(): string {
  return spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim();
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/** Builds the executable of this machine into a temp folder, copies only it into a new empty folder, and makes the folder a git repository (the product requires one). */
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g49e-")));
  const out = join(root, "out");
  const built = spawnSync("bun", ["src/release/build.ts", out, "--current"], {
    cwd: REPO,
    encoding: "utf8",
  });
  expect(built.status, built.stderr).toBe(0);
  const folder = join(root, "empty");
  mkdirSync(folder);
  copyFileSync(join(out, `werk-${here}`), join(folder, "werk"));
  spawnSync("chmod", ["+x", join(folder, "werk")]);
  const env0 = { PATH: "/usr/bin:/bin", HOME: join(root, "home") };
  mkdirSync(env0.HOME);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: folder, env: env0 });
  return { root, folder, exe: join(folder, "werk") };
}

async function start(
  exe: string,
  folder: string,
  env: Record<string, string>,
) {
  const port = await freePort();
  let output = "";
  const child: ChildProcess = spawn(exe, ["serve", "--port", String(port)], {
    cwd: folder,
    env,
  });
  for (const s of [child.stdout, child.stderr])
    s?.on("data", (c) => {
      output += String(c);
    });
  await expect.poll(() => output, { timeout: 30_000 }).toContain("werk: serving on");
  return { child, port, output: () => output };
}

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  test.setTimeout(120_000);
  const { root, folder, exe } = setup();
  let child: ChildProcess | undefined;
  try {
    // No bun on the path; no werk variable except the stored-state folder and no browser.
    const env = {
      PATH: "/usr/bin:/bin",
      HOME: join(root, "home"),
      WERK_HOME: join(root, "werk-home"),
      WERK_OPEN: "true",
    };
    expect(spawnSync("which", ["bun"], { env, encoding: "utf8" }).status).not.toBe(0);
    const before = readdirSync(folder).sort();
    expect(before).toEqual([".git", "werk"]);
    const s = await start(exe, folder, env);
    child = s.child;
    expect(s.output()).toMatch(/werk: serving on http:\/\/127\.0\.0\.1:\d+/);
    const missing: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${s.port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await page.goto(`http://127.0.0.1:${s.port}/p/${basename(folder)}`);
    await expect(page.getByRole("complementary", { name: "Chat pane" })).toBeVisible();
    expect(missing.filter((m) => !m.includes("favicon"))).toEqual([]);
    expect(errors).toEqual([]);
    // No folder of werk files (client, verbs, packages) appears next to the executable.
    const after = readdirSync(folder).sort();
    const extra = after.filter((n) => !before.includes(n));
    expect(extra.filter((n) => n !== ".werk")).toEqual([]);
    // The map folder of the project is the only addition, and it holds no werk program files.
    expect(readdirSync(join(folder, ".werk")).filter((n) => /\.(js|ts|html|css)$/.test(n))).toEqual([]);
  } finally {
    child?.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

test("49.4 the agent is told to run werk through the executable that runs", async ({ page }) => {
  test.setTimeout(120_000);
  const { root, folder, exe } = setup();
  let child: ChildProcess | undefined;
  try {
    const scriptPath = join(root, "script.json");
    // The fake cannot run a command. It plays a command line and an answer.
    writeFileSync(
      scriptPath,
      JSON.stringify({
        roles: {
          chat: {
            replies: [
              [
                {
                  event: {
                    type: "assistant",
                    message: {
                      id: "m1",
                      content: [
                        { type: "tool_use", id: "u1", name: "Bash", input: { command: `"${exe}" show root` } },
                      ],
                    },
                  },
                },
                {
                  event: {
                    type: "assistant",
                    message: { id: "m2", content: [{ type: "text", text: "The command worked" }] },
                  },
                },
              ],
            ],
          },
        },
      }),
    );
    // The fake agent starts with bun's shebang, so bun is on the path after the fake folder. The werk executable itself needs no bun.
    const env = {
      PATH: `${FAKE_DIR}:${BUN_DIR}:/usr/bin:/bin`,
      HOME: join(root, "home"),
      WERK_HOME: join(root, "werk-home"),
      WERK_OPEN: "true",
      WERK_FAKE_SCRIPT: scriptPath,
    };
    const s = await start(exe, folder, env);
    child = s.child;
    await page.goto(`http://127.0.0.1:${s.port}/p/${basename(folder)}`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Show me the root card");
    await composer.press("Enter");
    const chat = page.getByRole("complementary", { name: "Chat pane" });
    await expect(chat.getByText("The command worked")).toBeVisible();

    const launch = readRecords(logPathFor(scriptPath)).find((r) => r.kind === "launch");
    expect(launch).toBeDefined();
    const args = (launch as { args: string[] }).args;
    const at = args.indexOf("--append-system-prompt");
    expect(at, `launch args: ${args.join(" ").slice(0, 300)}`).toBeGreaterThan(-1);
    const prompt = args[at + 1] as string;
    const named = realpathSync(exe);
    // Every command in the instructions names the running executable.
    expect(prompt).toContain(`"${named}" help`);
    expect(prompt).not.toMatch(/src\/cli\.ts|\bbun\b/i);
    const agents = args[args.indexOf("--agents") + 1] ?? "";
    expect(agents).toContain(named);
    expect(agents).not.toMatch(/src\/cli\.ts|\bbun\b/i);
    // The command that the person sees in the pane names that executable, not bun or a source path.
    const pane = (await chat.locator("[data-slot=tool-call]").first().textContent()) ?? "";
    expect(pane).toContain(basename(exe));
    expect(pane).not.toMatch(/src\/cli\.ts|\bbun\b/i);
    // Run the instructed command the way an agent would: it works.
    const run = spawnSync("sh", ["-c", `"${named}" help`], { cwd: folder, env: { PATH: "/usr/bin:/bin", HOME: join(root, "home") }, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("show");
    void readFileSync;
  } finally {
    child?.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});
