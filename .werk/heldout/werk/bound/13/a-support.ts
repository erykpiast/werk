/** A server helper for the held-out specs of agent A. It copies e2e/support/server.ts and keeps the server output. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test as base, type Page } from "@playwright/test";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

export type Ev = Record<string, unknown>;

export type Srv = {
  url: string;
  origin: string;
  port: number;
  dir: string;
  appDir: string;
  output: () => string;
  start(): Promise<void>;
  werk(...args: string[]): { code: number; stdout: string; stderr: string };
  /** Appends events to the project log. */
  append(...events: Ev[]): void;
  dispose(): Promise<void>;
};

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

export async function startA(
  options: { appCopy?: boolean; events?: Ev[] } = {},
): Promise<Srv> {
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true" };
  if (!fakeIsFirst(env.PATH)) throw new Error("fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-ho-a-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  if (options.events) {
    writeFileSync(
      join(dir, ".werk", "log.jsonl"),
      `${options.events.map((e) => JSON.stringify(e)).join("\n")}\n`,
    );
  }
  const init = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  if (init.status !== 0) throw new Error("git init failed");
  const home = join(root, "home");
  const appDir = options.appCopy ? join(root, "app") : CHECKOUT;
  const cli = options.appCopy
    ? copyApp(appDir)
    : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let output = "";
  return {
    url: `${origin}/p/${basename(dir)}`,
    origin,
    port,
    dir,
    appDir,
    output: () => output,
    async start() {
      const running = spawn("bun", [cli, "serve", "--port", String(port)], {
        cwd: dir,
        env: { ...env, WERK_DEV: "1", WERK_HOME: home },
      });
      child = running;
      for (const s of [running.stdout, running.stderr]) {
        s?.on("data", (c) => {
          output += String(c);
        });
      }
      const end = Date.now() + 30000;
      for (;;) {
        if (running.exitCode !== null) throw new Error(`exited:\n${output}`);
        const res = await fetch(`${origin}/api/projects`).catch(() => null);
        if (res?.ok) return;
        if (Date.now() > end) throw new Error("server did not answer");
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    werk(...args) {
      const r = spawnSync("bun", [cli, ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
      });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    append(...events) {
      appendFileSync(
        join(dir, ".werk", "log.jsonl"),
        `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
      );
    },
    async dispose() {
      const running = child;
      child = undefined;
      if (running && running.exitCode === null) {
        const exited = new Promise((d) => running.once("exit", d));
        running.kill("SIGTERM");
        await exited;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

type Fx = { srv: (o?: Parameters<typeof startA>[0]) => Promise<Srv> };

export const test = base.extend<Fx>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs this pattern.
  srv: async ({}, use) => {
    const made: Srv[] = [];
    await use(async (o) => {
      const s = await startA(o);
      made.push(s);
      await s.start();
      return s;
    });
    for (const s of made) await s.dispose();
  },
});
export { expect } from "@playwright/test";

export const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
export const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

export const leftPane = (page: Page) =>
  page.getByRole("region", { name: "Map pane" });

/** Events: a card, accepted by a person. */
export const card = (
  id: string,
  title: string,
  parent?: string,
  status = "open",
  extra: Ev = {},
): Ev[] => [
  {
    type: "node.proposed",
    id,
    kind: "card",
    title,
    status,
    why: `Why ${id}`,
    ...(parent ? { parent } : {}),
    ...extra,
  },
  { type: "node.accepted", id, actor: "you" },
];

/** Events: a card, accepted, then decided. */
export const decidedCard = (id: string, title: string, parent?: string): Ev[] => [
  ...card(id, title, parent),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
