import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { readRecords, logPathFor } from "../src/fake-agent/launch-log.ts";
import { FAKE_DIR } from "../src/test-env/env.ts";
import { releaseBuild } from "./c-release-build.ts";

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

let build: ReturnType<typeof releaseBuild>;
let root: string;
test.beforeAll(() => {
  build = releaseBuild();
  root = realpathSync(mkdtempSync(join("/tmp", "wc49-")));
});
test.afterAll(() => {
  rmSync(build.root, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

/** A new folder with only the executable in it (and the git repository werk requires). */
function emptyFolder(name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  const exe = join(dir, "werk");
  copyFileSync(build.exeFor(), exe);
  chmodSync(exe, 0o755);
  return { dir, exe };
}

function start(exe: string, dir: string, env: Record<string, string>, port: number) {
  let output = "";
  const child: ChildProcess = spawn(exe, ["serve", "--port", String(port)], {
    cwd: dir,
    env,
  });
  for (const s of [child.stdout, child.stderr]) {
    s?.on("data", (c) => {
      output += String(c);
    });
  }
  return { child, output: () => output };
}

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  test.setTimeout(120_000);
  const { dir, exe } = emptyFolder("p2");
  // no bun on this path
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: join(root, "home2"),
    WERK_HOME: join(root, "wh2"),
    WERK_OPEN: "true",
  };
  mkdirSync(env.HOME);
  expect(spawnSync("sh", ["-c", "command -v bun"], { env }).status).not.toBe(0);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const before = readdirSync(dir).sort();
  const port = await freePort();
  const { child, output } = start(exe, dir, env, port);
  try {
    await expect.poll(output, { timeout: 30_000 }).toMatch(/werk: serving on http:\/\/\S+/);
    const address = /werk: serving on (http:\/\/\S+)/.exec(output())?.[1] as string;
    const bad: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
    });
    page.on("requestfailed", (r) => bad.push(`failed ${r.url()}`));
    page.on("pageerror", (e) => bad.push(`pageerror ${e.message}`));
    await page.goto(address);
    await expect(page.locator("#screen")).toBeVisible();
    await expect(page.getByRole("region", { name: "Map pane" })).toBeVisible();
    await expect(page.getByText("The map has no cards yet.")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(bad).toEqual([]);
    expect(output()).not.toMatch(/ENOENT|no such file|cannot find|missing/i);
    // no new folder of werk files beside the executable
    const after = readdirSync(dir).sort();
    // `.werk` is the project's own map folder. It must hold data only, no copy of werk's files.
    const created = after.filter((n) => !before.includes(n));
    expect(created.filter((n) => n !== ".werk")).toEqual([]);
    const inside = created.includes(".werk") ? readdirSync(join(dir, ".werk")) : [];
    console.log("CREATED", created, "INSIDE .werk", inside);
    expect(inside.filter((n) => !/\.(jsonl|lock|json)$/.test(n))).toEqual([]);
  } finally {
    child.kill("SIGTERM");
  }
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  test.setTimeout(120_000);
  const { dir, exe } = emptyFolder("p4");
  const command = `"${exe}" find`;
  const script = {
    roles: {
      chat: {
        replies: [
          [
            {
              event: {
                type: "assistant",
                message: {
                  id: "t1",
                  content: [{ type: "tool_use", id: "u-t1", name: "Bash", input: { command } }],
                },
              },
            },
            {
              event: {
                type: "assistant",
                message: { id: "t2", content: [{ type: "text", text: "Done" }] },
              },
            },
          ],
        ],
      },
    },
  };
  const scriptPath = join(root, "script4.json");
  writeFileSync(scriptPath, JSON.stringify(script));
  // The fake agent is a bun script, so the path used here has bun after the fake folder.
  const env = {
    PATH: [FAKE_DIR, dirname(spawnSync("sh", ["-c", "command -v bun"], { encoding: "utf8" }).stdout.trim()), "/usr/bin", "/bin"].join(delimiter),
    HOME: join(root, "home4"),
    WERK_HOME: join(root, "wh4"),
    WERK_OPEN: "true",
    WERK_FAKE_SCRIPT: scriptPath,
  };
  mkdirSync(env.HOME);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const port = await freePort();
  const { child, output } = start(exe, dir, env, port);
  try {
    await expect.poll(output, { timeout: 30_000 }).toMatch(/werk: serving on http:\/\/\S+/);
    const address = /werk: serving on (http:\/\/\S+)/.exec(output())?.[1] as string;
    await page.goto(address);
    await expect(page.locator("#screen")).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Find the open cards with werk");
    await composer.press("Enter");
    const chat = page.getByRole("complementary", { name: "Chat pane" });
    await expect(chat.getByText("Done")).toBeVisible();
    // the command the person sees names the executable and not bun or a source path
    const runs = chat.locator("details[data-slot=tool-run]");
    await expect(runs.locator("[data-slot=tool-latest]")).toContainText(exe);
    const shown = await chat.innerText();
    expect(shown).not.toMatch(/src\/cli\.ts|\bbun\b/);

    // what the product gave the agent: the instruction text names the running executable
    const records = readRecords(logPathFor(scriptPath));
    const launch = records.find((r) => r.kind === "launch");
    expect(launch).toBeDefined();
    const args = (launch as { args: string[] }).args;
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(prompt).toContain(`"${exe}" help`);
    expect(prompt).not.toMatch(/src\/cli\.ts/);
    expect(prompt).not.toMatch(/"[^"]*\/bun" /);
    // and that command works
    const ran = spawnSync(exe, ["find"], { cwd: dir, env, encoding: "utf8" });
    expect(ran.status).toBe(0);
  } finally {
    child.kill("SIGTERM");
  }
});
