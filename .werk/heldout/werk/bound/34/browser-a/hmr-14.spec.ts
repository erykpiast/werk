import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv } from "../../src/test-env/env.ts";
import { spawnSync } from "node:child_process";

const FIXTURE = join(import.meta.dirname, "..", "..", "e2e", "fixtures", "project");

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test("14.2 in dev, a server edit changes a response, reuses the live server, and the live page stays connected", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-hmr-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true", WERK_DEV: "1", WERK_HOME: join(root, "home") };
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const cli = copyApp(join(root, "app"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let log = "";
  const child = spawn("bun", [cli, "serve", "--port", String(port)], { cwd: dir, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { log += String(c); });
  try {
    await expect
      .poll(async () => (await fetch(`${origin}/api/projects`).catch(() => null))?.ok === true, { timeout: 30000 })
      .toBe(true);
    const lock = () => JSON.parse(readFileSync(join(root, "home", "serve.lock"), "utf8")) as { pid: number; port: number };
    const before = lock();
    const first = await (await fetch(`${origin}/api/projects`)).json();
    expect(first.edited).toBeUndefined();
    const name = "project";

    await page.goto(`${origin}/p/${name}`);
    await expect(page.getByRole("region", { name: "Map pane" }).getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });

    const routes = join(root, "app", "src", "serve", "routes.ts");
    const text = readFileSync(routes, "utf8");
    const edited = text.replace(
      "return json({ projects: entries(ctx.projects) });",
      "return json({ projects: entries(ctx.projects), edited: true });",
    );
    expect(edited).not.toBe(text);
    writeFileSync(routes, edited);

    await expect
      .poll(async () => (await (await fetch(`${origin}/api/projects`)).json()).edited, { timeout: 30000 })
      .toBe(true);
    expect(log).toContain("reusing the live server");
    expect(lock()).toEqual(before);

    const added = spawnSync("bun", [cli, "add", "after", "--title", "After edit", "--parent", "root"], { cwd: dir, env, encoding: "utf8" });
    expect(added.status).toBe(0);
    await expect(page.getByText("After edit")).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true).catch(() => false),
    ).toBe(true);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => (child.exitCode === null ? child.once("exit", r) : r(null)));
    rmSync(root, { recursive: true, force: true });
  }
});
