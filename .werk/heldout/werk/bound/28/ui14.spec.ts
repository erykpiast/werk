import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv } from "../src/test-env/env.ts";
import { expect, leftPane, markLoaded, composerOf, stillLoaded, test } from "./pw.ts";

const FIXTURE = join(import.meta.dirname, "..", "e2e", "fixtures", "project");

test("14.1 a card added from the command line appears on the open page without a reload", async ({ page, app }) => {
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await composerOf(page).fill("half a thought");
  await markLoaded(page);
  const added = app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(added.code).toBe(0);
  await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composerOf(page)).toHaveValue("half a thought");
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-14-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true", WERK_HOME: join(root, "home") };
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const appDir = join(root, "app");
  const cli = copyApp(appDir);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  let child: ChildProcess | undefined;
  try {
    child = spawn("bun", [cli, "serve", "--port", String(port)], { cwd: dir, env: { ...env, WERK_DEV: "1" } });
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
    await expect.poll(async () => (await fetch(`${origin}/api/projects`).catch(() => null))?.ok === true, { timeout: 40_000 }).toBe(true);
    const pid = child.pid;
    await page.goto(`${origin}/p/${basename(dir)}`);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await markLoaded(page);

    const routes = join(appDir, "src", "serve", "routes.ts");
    const source = readFileSync(routes, "utf8");
    const needle = "return json({ projects: entries(ctx.projects) });";
    expect(source).toContain(needle);
    writeFileSync(routes, source.replace(needle, "return json({ projects: entries(ctx.projects), edited: true });"));

    await expect
      .poll(async () => (await (await fetch(`${origin}/api/projects`)).json()).edited, { timeout: 40_000 })
      .toBe(true);
    expect(output).toMatch(/reusing the live server/);
    expect(child.pid).toBe(pid);
    expect(child.exitCode).toBeNull();
    expect((await fetch(`${origin}/api/projects`)).ok).toBe(true);

    const added = spawnSync("bun", [cli, "add", "after", "--title", "After edit", "--parent", "root"], { cwd: dir, env, encoding: "utf8" });
    expect(added.status, added.stderr).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible({ timeout: 20_000 });
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    child?.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page, appCopy }) => {
  await page.goto(appCopy.url);
  const title = await leftPane(page).getByRole("heading", { level: 1 }).innerText();
  await composerOf(page).fill("draft that must survive");
  await markLoaded(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 20_000 }).toBe(false);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(composerOf(page)).toHaveValue("draft that must survive");
});
