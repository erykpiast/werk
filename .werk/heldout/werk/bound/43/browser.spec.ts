import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { appendEvents } from "../src/map/log-store.ts";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv } from "../src/test-env/env.ts";

const ROOT = resolve(import.meta.dirname, "..");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.once("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => res(port));
    });
  });
}

type Server = {
  url: string;
  port: number;
  dir: string;
  appDir: string;
  output: () => string;
  werk: (...args: string[]) => { code: number; stdout: string; stderr: string };
  stop: () => Promise<void>;
};

async function start(appCopy: boolean): Promise<Server> {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-e2e-"));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const logPath = join(dir, ".werk", "log.jsonl");
  const seeded = appendEvents(logPath, [
    { type: "node.proposed", id: "root", kind: "card", title: "Root", status: "open" },
    { type: "node.accepted", id: "root", actor: "you" },
  ]);
  if (!seeded.ok) throw new Error("seed refused");
  const appDir = appCopy ? join(root, "app") : ROOT;
  const cli = appCopy ? copyApp(appDir) : join(ROOT, "src", "cli.ts");
  const env = { ...cleanEnv(process.env), WERK_DEV: "1" };
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let out = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], { cwd: dir, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { out += String(c); });
  const end = Date.now() + 45000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${out}`);
    const res = await fetch(`${url}/api/graph?shape=1`).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > end) throw new Error(`server did not answer:\n${out}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    port,
    dir,
    appDir,
    output: () => out,
    werk(...args) {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise((d) => child.once("exit", d));
        child.kill("SIGTERM");
        await exited;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
// A page that is mid-reload has no context to read: that counts as "not the same page any more".
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

test("14.1 a card added from the command line appears on the open page without a reload", async ({ page }) => {
  const s = await start(false);
  try {
    await page.goto(s.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await composer(page).fill("half a thought");
    await markLoaded(page);
    const added = s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(added.code, added.stderr).toBe(0);
    await expect(pane(page).getByText("Fresh idea")).toBeVisible({ timeout: 15000 });
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer(page)).toHaveValue("half a thought");
  } finally {
    await s.stop();
  }
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
  const s = await start(true);
  try {
    const first = /serving on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\)/.exec(s.output());
    expect(first, s.output()).not.toBeNull();
    const pid = Number(first?.[2]);
    await page.goto(s.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await markLoaded(page);

    const file = join(s.appDir, "src", "serve", "routes.ts");
    writeFileSync(file, readFileSync(file, "utf8").replace("the graph is read with shape=1", "the graph is read with shape=1 (edited)"));

    await expect.poll(() => s.output(), { timeout: 20000 }).toMatch(/reus(e|es|ing) the live server/);
    await expect
      .poll(async () => (await (await fetch(`${s.url}/api/graph`)).text()), { timeout: 20000 })
      .toContain("(edited)");
    expect(() => process.kill(pid, 0)).not.toThrow();
    expect(s.output()).toContain(`127.0.0.1:${s.port}`);
    expect((await fetch(`${s.url}/api/graph?shape=1`)).ok).toBe(true);

    const added = s.werk("add", "after", "--title", "After edit", "--parent", "root");
    expect(added.code, added.stderr).toBe(0);
    await expect(pane(page).getByText("After edit")).toBeVisible({ timeout: 15000 });
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await s.stop();
  }
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  const s = await start(true);
  try {
    await page.goto(s.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await composer(page).fill("draft that must survive");
    await markLoaded(page);
    const entry = join(s.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await expect(composer(page)).toHaveValue("draft that must survive");
  } finally {
    await s.stop();
  }
});
