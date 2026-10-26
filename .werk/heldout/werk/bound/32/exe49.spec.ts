import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../src/fake-agent/launch-log.ts";
import { cleanEnv } from "../src/test-env/env.ts";

const REPO = join(import.meta.dirname, "..");

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/** Builds the executable of this machine from a copy of the committed files, so the checkout stays untouched. */
function buildExecutable(root: string): string {
  const copy = join(root, "copy");
  mkdirSync(copy);
  spawnSync("sh", ["-c", `git archive HEAD | tar -x -C "${copy}"`], {
    cwd: REPO,
  });
  symlinkSync(join(REPO, "node_modules"), join(copy, "node_modules"));
  const out = join(root, "out");
  const built = spawnSync("bun", ["src/release/build.ts", out, "--current"], {
    cwd: copy,
    encoding: "utf8",
  });
  expect(built.status, built.stderr).toBe(0);
  return join(out, `werk-${process.platform}-${process.arch}`);
}

/** An empty project folder that holds only the executable, and a git repository (werk requires one). */
function emptyFolder(root: string, exe: string) {
  const folder = join(root, "empty");
  mkdirSync(folder);
  cpSync(exe, join(folder, "werk"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: folder });
  return folder;
}

async function start(
  folder: string,
  env: Record<string, string>,
): Promise<{ child: ChildProcess; port: number; output: () => string }> {
  const port = await freePort();
  let output = "";
  const child = spawn(join(folder, "werk"), ["serve", "--port", String(port)], {
    cwd: folder,
    env,
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output += String(chunk);
    });
  }
  await expect.poll(() => output, { timeout: 30_000 }).toContain("serving on");
  return { child, port, output: () => output };
}

test("49.2 the executable serves the client from an empty folder", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-exe-"));
  let child: ChildProcess | undefined;
  try {
    const exe = buildExecutable(root);
    const folder = emptyFolder(root, exe);
    const before = readdirSync(folder).sort();
    const env = {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: join(root, "home"),
      WERK_HOME: join(root, "werk-home"),
      WERK_OPEN: "true",
    };
    mkdirSync(env.HOME);
    const started = await start(folder, env);
    child = started.child;
    expect(started.output()).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
    const failures: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(String(e)));
    await page.goto(`http://127.0.0.1:${started.port}/p/${basename(folder)}`);
    await expect(page.locator("#screen")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(failures).toEqual([]);
    // Nothing of werk's own is unpacked next to the executable. The project keeps its own .werk folder.
    const added = readdirSync(folder)
      .sort()
      .filter((name) => !before.includes(name));
    expect(added.filter((name) => name !== ".werk")).toEqual([]);
  } finally {
    child?.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

test("49.4 the agent and the commands name the executable that is running", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-exe-"));
  let child: ChildProcess | undefined;
  try {
    const exe = buildExecutable(root);
    const folder = emptyFolder(root, exe);
    const scriptPath = join(root, "script.json");
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
                      content: [{ type: "text", text: "Done" }],
                    },
                  },
                },
              ],
            ],
          },
        },
      }),
    );
    const env = {
      ...cleanEnv(process.env),
      HOME: join(root, "home"),
      WERK_HOME: join(root, "werk-home"),
      WERK_OPEN: "true",
      WERK_FAKE_SCRIPT: scriptPath,
    };
    mkdirSync(env.HOME);
    const started = await start(folder, env);
    child = started.child;
    await page.goto(`http://127.0.0.1:${started.port}/p/${basename(folder)}`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Add a card called test");
    await composer.press("Enter");
    await expect(page.getByText("Done")).toBeVisible();
    const launch = readRecords(logPathFor(scriptPath)).find(
      (r) => r.kind === "launch",
    );
    expect(launch).toBeDefined();
    const text = (launch?.args ?? []).join("\n");
    const exePath = join(folder, "werk");
    // resolve symlinks in the temp path the same way the running process does
    const real = spawnSync("sh", ["-c", `cd "${folder}" && pwd -P`], {
      encoding: "utf8",
    }).stdout.trim();
    expect(
      text.includes(`"${exePath}" help`) ||
        text.includes(`"${join(real, "werk")}" help`),
    ).toBe(true);
    expect(text).not.toMatch(/"[^"\n]*\/bun" "[^"\n]*cli\.ts"/);
    expect(text).not.toContain("src/cli.ts");
  } finally {
    child?.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});
