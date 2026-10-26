import { spawn, spawnSync } from "node:child_process";
import { readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { cleanEnv } from "../../src/test-env/env.ts";
import {
  buildRelease,
  emptyFolderWith,
  HERE,
  NO_BUN_PATH,
} from "./release-helper.ts";

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

let rel: ReturnType<typeof buildRelease>;
test.beforeAll(() => {
  rel = buildRelease();
  if (rel.built.status !== 0) throw new Error(rel.built.stderr);
});
test.afterAll(() => rmSync(rel.root, { recursive: true, force: true }));

function start(
  exe: string,
  cwd: string,
  env: Record<string, string>,
  port: number,
) {
  let output = "";
  const child = spawn(exe, ["serve", "--port", String(port)], { cwd, env });
  for (const s of [child.stdout, child.stderr])
    s?.on("data", (c) => (output += String(c)));
  return { child, output: () => output };
}

test("49.2 the executable serves the client page in a browser from an empty folder", async ({
  page,
}) => {
  const { dir, copy } = emptyFolderWith(
    rel.root,
    join(rel.out, `werk-${HERE}`),
  );
  const before = readdirSync(dir).sort();
  const port = await freePort();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const missing: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
  });
  const { child, output } = start(
    copy,
    dir,
    {
      PATH: NO_BUN_PATH,
      HOME: join(rel.root, "home"),
      WERK_HOME: join(rel.root, "wh3"),
      WERK_OPEN: "true",
    },
    port,
  );
  try {
    await expect
      .poll(output, { timeout: 30000 })
      .toMatch(/werk: serving on http:\/\/127\.0\.0\.1:\d+/);
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await page.screenshot({ path: "/tmp/werk-heldout-infra-results/49.2.png" });
    expect(missing).toEqual([]);
    expect(errors).toEqual([]);
    const body = await page.locator("body").innerText();
    console.log("49.2 visible text:", JSON.stringify(body.slice(0, 200)));
    expect(body).not.toMatch(/ENOENT|not found|missing/i);
  } finally {
    child.kill("SIGTERM");
  }
  const added = readdirSync(dir).filter((n) => !before.includes(n));
  expect(added.every((n) => n === ".werk")).toBe(true);
});

const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});
const tool = (id: string, command: string) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [
        { type: "tool_use", id: `u-${id}`, name: "Bash", input: { command } },
      ],
    },
  },
});

test("49.4 the agent is told the running executable's path, and a command through that path works", async ({
  page,
}) => {
  const { dir, copy } = emptyFolderWith(
    rel.root,
    join(rel.out, `werk-${HERE}`),
  );
  const exePath = join(realpathSync(dir), "werk");
  const scriptPath = join(rel.root, "script-494.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      roles: {
        chat: {
          replies: [
            [
              tool("t1", `"${exePath}" search`),
              say(
                "m1",
                "The werk command worked: the map has no decided cards.",
              ),
            ],
          ],
        },
      },
    }),
  );
  const env = {
    ...cleanEnv(process.env),
    WERK_OPEN: "true",
    WERK_HOME: join(rel.root, "wh4"),
    WERK_FAKE_SCRIPT: scriptPath,
  };
  const port = await freePort();
  const { child, output } = start(copy, dir, env, port);
  try {
    await expect.poll(output, { timeout: 30000 }).toMatch(/werk: serving on/);
    await page.goto(`http://127.0.0.1:${port}/p/${basename(dir)}`);
    await expect(
      page.getByRole("complementary", { name: "Chat pane" }),
    ).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Search the map with werk");
    await composer.press("Enter");
    const chat = page.getByRole("complementary", { name: "Chat pane" });
    await expect(chat.getByText("The werk command worked")).toBeVisible();
    const shown = (await chat.textContent()) ?? "";
    console.log("49.4 chat text:", JSON.stringify(shown));
    expect(shown).toContain(exePath);
    expect(shown).not.toMatch(/src\/cli\.ts|\bbun\b/);
    await page.screenshot({ path: "/tmp/werk-heldout-infra-results/49.4.png" });

    // What the agent was told at launch: the commands in its instructions name the executable.
    const { readRecords, logPathFor } = await import(
      "../../src/fake-agent/launch-log.ts"
    );
    const launch = readRecords(logPathFor(scriptPath)).find(
      (r) => r.kind === "launch",
    );
    expect(launch).toBeTruthy();
    const args = (launch as { args: string[] }).args;
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(prompt).toContain(`"${exePath}" help`);
    expect(prompt).not.toMatch(/src\/cli\.ts/);
    expect(prompt).not.toMatch(/"[^"]*\/bun[^"]*"/);
    // The command the agent runs from those instructions works.
    const run = spawnSync(exePath, ["search"], {
      cwd: dir,
      env: { PATH: NO_BUN_PATH, WERK_HOME: join(rel.root, "wh4") },
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
  } finally {
    child.kill("SIGTERM");
  }
});
