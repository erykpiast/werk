import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { FAKE_DIR } from "../src/test-env/env.ts";
import { freePort } from "./browser.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

test.describe.configure({ mode: "serial" });

let root = "";
let out = "";
let buildResult: { status: number | null; stderr: string } | undefined;
let exe = "";

/** The build runs in a copy of the checkout, so its dist folder never lands in the checkout. */
test.beforeAll(() => {
  test.setTimeout(600_000);
  root = mkdtempSync(join(tmpdir(), "werk-heldout-49-"));
  const copy = join(root, "repo");
  mkdirSync(copy);
  const copied = spawnSync("rsync", ["-a", "--exclude", "/.git", "--exclude", "/.werk-heldout", "--exclude", "/test-results", "--exclude", "/dist", "--exclude", "/coverage", `${CHECKOUT}/`, `${copy}/`], { encoding: "utf8" });
  if (copied.status !== 0) throw new Error(`rsync failed: ${copied.stderr}`);
  out = join(root, "out");
  const built = spawnSync("bun", ["src/release/build.ts", out], {
    cwd: copy,
    encoding: "utf8",
  });
  buildResult = {
    status: built.status,
    stderr: `${built.stdout}\n${built.stderr}`,
  };
  exe = join(out, `werk-${process.platform}-${process.arch}`);
});

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// An environment with no Bun on the path and no werk state.
const bareEnv = (home: string, extra: Record<string, string> = {}) => ({
  PATH: "/usr/bin:/bin",
  HOME: home,
  ...extra,
});

function emptyFolder(name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  const home = join(root, `${name}-home`);
  mkdirSync(home);
  spawnSync("git", ["init", "-q", "-b", "main"], {
    cwd: dir,
    env: bareEnv(home),
  });
  return { dir, home };
}

test("49.1 the release build makes four executables with checksums", () => {
  expect(buildResult?.stderr).toBeDefined();
  expect(buildResult?.status, buildResult?.stderr.slice(-2000)).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), `${file} exists`).toBe(true);
    expect(existsSync(`${file}.sha256`)).toBe(true);
    const digest = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8")).toContain(digest);
  }
});

test("49.2 the executable serves the client from an empty folder", async ({
  page,
}) => {
  const { dir, home } = emptyFolder("empty");
  // Only the executable goes into the new empty folder.
  const lone = join(dir, "werk");
  cpSync(exe, lone);
  const before = readdirSync(dir).sort();
  const port = await freePort();
  let output = "";
  const child: ChildProcess = spawn(lone, ["serve", "--port", String(port)], {
    cwd: dir,
    env: bareEnv(home, {
      WERK_HOME: join(root, "werk-home"),
      WERK_OPEN: "true",
    }),
  });
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (c) => {
      output += String(c);
    });
  try {
    await expect
      .poll(() => output, { timeout: 30_000 })
      .toMatch(/werk: serving on/);
    expect(output).toMatch(/127\.0\.0\.1:\d+|localhost:\d+/);
    const missing: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("[data-slot=header-row-1]")).toBeVisible({
      timeout: 20_000,
    });
    expect(missing.filter((m) => !m.includes("favicon"))).toEqual([]);
    const after = readdirSync(dir).sort();
    expect(after.filter((n) => !before.includes(n) && n !== ".werk")).toEqual(
      [],
    );
  } finally {
    child.kill("SIGTERM");
  }
});

test("49.3 the help of the executable lists every command", () => {
  const { dir, home } = emptyFolder("empty-help");
  const exeHelp = spawnSync(exe, ["help"], {
    cwd: dir,
    env: bareEnv(home),
    encoding: "utf8",
  });
  expect(exeHelp.status).toBe(0);
  const checkoutHelp = spawnSync(
    "bun",
    [join(CHECKOUT, "src/cli.ts"), "help"],
    {
      cwd: dir,
      env: { ...process.env, WERK_HOME: home } as Record<string, string>,
      encoding: "utf8",
    },
  );
  expect(checkoutHelp.status).toBe(0);
  const verbs = (text: string) =>
    text
      .split("\n")
      .filter((l) => /^ {2}\S/.test(l))
      .map((l) => l.trim().split(/\s+/)[0]);
  expect(verbs(exeHelp.stdout).length).toBeGreaterThan(10);
  expect(verbs(exeHelp.stdout)).toEqual(verbs(checkoutHelp.stdout));
  const run = spawnSync(exe, ["add", "first", "--title", "First card"], {
    cwd: dir,
    env: bareEnv(home),
    encoding: "utf8",
  });
  expect(`${run.stdout}${run.stderr}`).not.toMatch(
    /no such file|not found|ENOENT|missing/i,
  );
  expect(run.status).toBe(0);
  const list = spawnSync(exe, ["show", "first"], {
    cwd: dir,
    env: bareEnv(home),
    encoding: "utf8",
  });
  expect(list.status).toBe(0);
  expect(list.stdout).toContain("First card");
});

test("49.4 the agent and the commands name the executable that is running", async ({
  page,
}) => {
  const { dir, home } = emptyFolder("empty-chat");
  const lone = join(dir, "werk");
  cpSync(exe, lone);
  const script = join(root, "script.json");
  writeFileSync(
    script,
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
                    content: [{ type: "text", text: "ok" }],
                  },
                },
              },
            ],
          ],
        },
      },
    }),
  );
  const port = await freePort();
  let output = "";
  const child: ChildProcess = spawn(lone, ["serve", "--port", String(port)], {
    cwd: dir,
    env: {
      ...bareEnv(home, {
        WERK_HOME: join(root, "werk-home-chat"),
        WERK_OPEN: "true",
        WERK_FAKE_SCRIPT: script,
      }),
      PATH: `${FAKE_DIR}:${dirname(spawnSync("sh", ["-c", "command -v bun"], { encoding: "utf8" }).stdout.trim())}:/usr/bin:/bin`,
    },
  });
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (c) => {
      output += String(c);
    });
  try {
    await expect
      .poll(() => output, { timeout: 30_000 })
      .toMatch(/werk: serving on/);
    await page.goto(`http://127.0.0.1:${port}/`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("add a card with werk");
    await composer.press("Enter");
    await expect(page.getByText("ok").first())
      .toBeVisible({ timeout: 20_000 })
      .catch(async (e) => {
        throw new Error(`${e.message}\nPAGE: ${await page.locator("body").innerText()}\nSERVER: ${output}`);
      });
    const records = readFileSync(`${script}.launches.jsonl`, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { kind: string; args?: string[] });
    const launch = records.find((r) => r.kind === "launch");
    expect(launch).toBeDefined();
    const prompt = (launch?.args ?? []).join("\n");
    expect(prompt).toContain(lone);
    expect(prompt).not.toMatch(/bun[^\n]*src\/cli\.ts/);
    expect(prompt).not.toMatch(/"[^"\n]*\/bun" "/);
  } finally {
    child.kill("SIGTERM");
  }
});
