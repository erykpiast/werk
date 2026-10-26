import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");
export const AT = "2026-10-10T09:00:00.000Z";

export const jsonl = (...events: unknown[]) =>
  `${events.flat(Number.POSITIVE_INFINITY).map((e) => JSON.stringify(e)).join("\n")}\n`;

export const ghost = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title,
  status: "open",
  ...extra,
});
/** A real open card. */
export const real = (id: string, title: string, extra: Record<string, unknown> = {}) => [
  ghost(id, title, extra),
  { type: "node.accepted", id, actor: "you" },
];
/** A real decided card, waiving the facts a test does not care about. */
export const decided = (id: string, title: string, extra: Record<string, unknown> = {}) => [
  ...real(id, title, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];

function freePort(): Promise<number> {
  return new Promise((ok, bad) => {
    const probe = createServer();
    probe.once("error", bad);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => ok(port));
    });
  });
}

export type Server = {
  url: string;
  origin: string;
  dir: string;
  appDir: string;
  output: () => string;
  werk: (...args: string[]) => { code: number; stdout: string; stderr: string };
  dispose: () => Promise<void>;
};

/** A real server on a copy of the fixture project, with its output kept. `log` replaces the map log. */
export async function serveProject(opts: { appCopy?: boolean; log?: string } = {}): Promise<Server> {
  const base = { ...cleanEnv(process.env), WERK_OPEN: "true" };
  if (!fakeIsFirst(base.PATH)) throw new Error("fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  if (opts.log) writeFileSync(join(dir, ".werk", "log.jsonl"), opts.log);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env: base });
  const appDir = opts.appCopy ? join(root, "app") : CHECKOUT;
  const cli = opts.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const home = join(root, "home");
  let out = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...base, WERK_DEV: "1", WERK_HOME: home },
  });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { out += String(c); });
  const end = Date.now() + 40000;
  for (;;) {
    const res = await fetch(`${origin}/api/projects`).catch(() => null);
    if (res?.ok) break;
    if (child.exitCode !== null) throw new Error(`server exited:\n${out}`);
    if (Date.now() > end) throw new Error(`server did not answer:\n${out}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url: `${origin}/p/${basename(dir)}`,
    origin,
    dir,
    appDir,
    output: () => out,
    werk(...args) {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env: { ...base, WERK_HOME: home }, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
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

export const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
export const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
export const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
export const spawnSleeper = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });
