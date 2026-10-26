import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv } from "../../src/test-env/env.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

export const CHECKOUT = join(import.meta.dirname, "..", "..");

/** One line of the log file for each event. */
export const lines = (events: unknown[]) =>
  events.map((e) => `${JSON.stringify(e)}\n`).join("");

export const ROOT = [
  {
    type: "node.proposed",
    id: "root",
    kind: "card",
    title: "We build software with agents",
    status: "open",
    why: "One repeating pipeline keeps the work in step.",
  },
  { type: "node.accepted", id: "root", actor: "you" },
];

export const ROOT_DECIDED = [
  { type: "node.edited", id: "root", who: "me", noBasis: "test" },
  { type: "criterion.added", id: "root", form: "revisit" },
  { type: "node.decided", id: "root" },
];

export const ghost = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  parent: "root",
  ...extra,
});
export const real = (id: string, extra: Record<string, unknown> = {}) => [
  ghost(id, extra),
  { type: "node.accepted", id, actor: "you" },
];
export const decided = (id: string, extra: Record<string, unknown> = {}) => [
  ...real(id, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
export const dependsOn = (from: string, to: string) => ({
  type: "edge.added",
  from,
  to,
  link: "depends_on",
  why: `${from} takes ${to}`,
});

/** A started server whose project log holds the given events (the fixture root first unless told). */
export async function serverWith(options: {
  events?: unknown[];
  script?: Script;
  appCopy?: boolean;
  rootDecided?: boolean;
}): Promise<BrowserServer> {
  const server = await startBrowserServer({
    script: options.script,
    appCopy: options.appCopy,
  });
  if (options.events) {
    writeFileSync(
      join(server.dir, ".werk", "log.jsonl"),
      lines([
        ...ROOT,
        ...(options.rootDecided ? ROOT_DECIDED : []),
        ...options.events,
      ]),
    );
  }
  await server.start();
  return server;
}

export const say = (id: string, text: string, usage?: unknown) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) },
  },
});

export const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });

export const leftPane = (page: Page) =>
  page.getByRole("region", { name: "Map pane" });

export async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}

export const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
export const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

export type DevServer = {
  url: string;
  port: number;
  pid: number;
  appDir: string;
  dir: string;
  output: () => string;
  dispose: () => Promise<void>;
};

/** werk in dev mode on a copy of the app, with the server's output kept. */
export async function devServer(): Promise<DevServer> {
  const root = mkdtempSync(join(tmpdir(), "werk-g3-"));
  const dir = join(root, "project");
  cpSync(join(CHECKOUT, "e2e", "fixtures", "project"), dir, { recursive: true });
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true" };
  const git = spawn("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  await new Promise((done) => git.once("exit", done));
  const appDir = join(root, "app");
  const cli = copyApp(appDir);
  const port = await freePort();
  let output = "";
  const child = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...env, WERK_DEV: "1", WERK_HOME: join(root, "home") },
  });
  for (const s of [child.stdout, child.stderr])
    s?.on("data", (c) => {
      output += String(c);
    });
  const origin = `http://127.0.0.1:${port}`;
  const end = Date.now() + 40000;
  for (;;) {
    const res = await fetch(`${origin}/api/projects`).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > end) throw new Error(`server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url: `${origin}/p/${basename(dir)}`,
    port,
    pid: child.pid as number,
    appDir,
    dir,
    output: () => output,
    async dispose() {
      if (child.exitCode === null) {
        const done = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await done;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
