import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Page } from "@playwright/test";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../src/test-env/env.ts";

export const say = (id: string, text: string, usage?: Record<string, number>) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      ...(usage ? { usage } : {}),
    },
  },
});

export const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });
export const mapPane = (page: Page) =>
  page.getByRole("region", { name: "Map pane" });
export const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  const box = composer(page);
  await box.fill(text);
  await box.press("Enter");
}

export const chips = (page: Page) => page.locator('[data-slot="tab-chip"]');
export const newTab = (page: Page) =>
  page.getByRole("button", { name: "New conversation" });

/** A server of the app copy, like startBrowserServer, but its output is kept for the spec to read. */
export type DevServer = {
  url: string;
  origin: string;
  appDir: string;
  dir: string;
  output: () => string;
  werk(...args: string[]): { code: number; stdout: string; stderr: string };
  dispose(): Promise<void>;
};

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

export async function startDevServer(): Promise<DevServer> {
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true" };
  if (!fakeIsFirst(env.PATH)) throw new Error("fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-p7-"));
  const dir = join(root, "project");
  cpSync(join(import.meta.dirname, "..", "e2e", "fixtures", "project"), dir, {
    recursive: true,
  });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const home = join(root, "home");
  const appDir = join(root, "app");
  const cli = copyApp(appDir);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...env, WERK_DEV: "1", WERK_HOME: home },
  });
  for (const s of [child.stdout, child.stderr])
    s?.on("data", (c) => {
      output += String(c);
    });
  const end = Date.now() + 40000;
  for (;;) {
    const res = await fetch(`${origin}/api/projects`).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > end) throw new Error(`server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url: `${origin}/p/${basename(dir)}`,
    origin,
    appDir,
    dir,
    output: () => output,
    werk(...args) {
      const r = spawnSync("bun", [cli, ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
      });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    async dispose() {
      if (child.exitCode === null) {
        const exited = new Promise((done) => child.once("exit", done));
        child.kill("SIGTERM");
        await exited;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
