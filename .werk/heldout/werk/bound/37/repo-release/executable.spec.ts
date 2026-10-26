import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv } from "../../src/test-env/env.ts";

test("49.2/49.4 the executable serves the client in a browser and tells the agent its own path", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-49b-")));
  let child: ChildProcess | undefined;
  try {
    const app = join(root, "app");
    copyApp(app);
    const out = join(root, "out");
    const built = spawnSync("bun", ["src/release/build.ts", out, "--current"], {
      cwd: app,
      encoding: "utf8",
    });
    expect(built.status, built.stderr).toBe(0);
    const project = join(root, "project");
    mkdirSync(project);
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: project });
    const exe = join(out, `werk-${process.platform}-${process.arch}`);
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
                    message: { id: "m1", content: [{ type: "text", text: "On it" }] },
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
      WERK_OPEN: "true",
      WERK_HOME: join(root, "home"),
      WERK_FAKE_SCRIPT: scriptPath,
    };
    let output = "";
    child = spawn(exe, ["serve", "--port", "0"], { cwd: project, env });
    for (const s of [child.stdout, child.stderr])
      s?.on("data", (c) => {
        output += String(c);
      });
    await expect
      .poll(() => /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1], {
        timeout: 30000,
      })
      .toBeTruthy();
    const address = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] as string;
    const errors: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400 && !r.url().includes("/api/")) errors.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${address}/p/project`);
    await expect(page.locator("#screen")).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Show me the root card with a werk command");
    await composer.press("Enter");
    await expect(page.getByText("On it")).toBeVisible();
    expect(errors).toEqual([]);

    const launch = readRecords(logPathFor(scriptPath)).find(
      (r) => r.kind === "launch" && r.role === "chat",
    );
    expect(launch).toBeTruthy();
    const args = (launch as { args: string[] }).args;
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(prompt).toContain(`"${exe}" help`);
    expect(prompt).not.toMatch(/"[^"]*\/bun" "[^"]*cli\.ts"/);
    expect(prompt).not.toContain("cli.ts");
    expect(prompt).not.toMatch(/`bun /);

    // The command the agent is told to run works through that path.
    const ran = spawnSync("sh", ["-c", `"${exe}" help`], { cwd: project, env, encoding: "utf8" });
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("werk <verb>");
  } finally {
    child?.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});
