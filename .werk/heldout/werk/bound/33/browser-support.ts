import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { type Page, expect, test as base } from "@playwright/test";
import { logPathFor, readRecords } from "../src/fake-agent/launch-log.ts";
import type { Script } from "../src/fake-agent/script.ts";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

export { expect };

export type Own = Awaited<ReturnType<typeof serve>>;

const freePort = () =>
  new Promise<number>((res, rej) => {
    const p = createServer();
    p.once("error", rej);
    p.listen(0, "127.0.0.1", () => {
      const { port } = p.address() as { port: number };
      p.close(() => res(port));
    });
  });

export async function until(check: () => Promise<boolean>, what: string, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** A werk server on a copy of the fixture project, with its output and process id exposed. */
export async function serve(opts: { script?: Script; appCopy?: boolean } = {}) {
  const env0 = { ...cleanEnv(process.env), WERK_OPEN: "true" };
  if (!fakeIsFirst(env0.PATH)) throw new Error("fake agent not first");
  const root = mkdtempSync(join(tmpdir(), "werk-held-"));
  const scriptPath = join(root, "script.json");
  if (opts.script) writeFileSync(scriptPath, JSON.stringify(opts.script));
  const env = opts.script ? { ...env0, WERK_FAKE_SCRIPT: scriptPath } : env0;
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const home = join(root, "home");
  const appDir = opts.appCopy ? join(root, "app") : CHECKOUT;
  const cli = opts.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const url = `${origin}/p/${basename(dir)}`;
  let child: ChildProcess | undefined;
  let output = "";
  const self = {
    url,
    origin,
    dir,
    appDir,
    port,
    output: () => output,
    pid: () => child?.pid,
    launches: () => readRecords(logPathFor(scriptPath)),
    messages: () => self.launches().flatMap((r) => (r.kind === "message" ? [r.text] : [])),
    launched: () => self.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : [])),
    werk(...args: string[]) {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    async start() {
      const running = spawn("bun", [cli, "serve", "--port", String(port)], {
        cwd: dir,
        env: { ...env, WERK_DEV: "1", WERK_HOME: home },
      });
      child = running;
      for (const s of [running.stdout, running.stderr])
        s?.on("data", (c) => {
          output += String(c);
        });
      await until(async () => {
        if (running.exitCode !== null) throw new Error(`server exited:\n${output}`);
        const res = await fetch(`${origin}/api/projects`).catch(() => null);
        return res?.ok === true;
      }, "server");
    },
    async stop() {
      const running = child;
      child = undefined;
      if (!running || running.exitCode !== null) return;
      const exited = new Promise((d) => running.once("exit", d));
      running.kill("SIGTERM");
      await exited;
    },
    async dispose() {
      await self.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
  await self.start();
  return self;
}

export const test = base;

export const say = (id: string, text: string, usage?: Record<string, number>) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) },
  },
});

export const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
export const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
export const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  const c = composer(page);
  await c.fill(text);
  await c.press("Enter");
}

export const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
export const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Pastes one image into the composer. */
export async function pasteImage(page: Page, size?: number, type = "image/png", head?: number[], via: "paste" | "drop" = "paste") {
  await composer(page).focus();
  await page.evaluate(
    ({ base64, size, type, head, via }) => {
      const png = head ? Uint8Array.from(head) : Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? png.length);
      data.set(png);
      const t = new DataTransfer();
      t.items.add(new File([data], "shot", { type }));
      if (via === "drop") {
        document.querySelector("[data-slot=composer]")?.dispatchEvent(
          new DragEvent("drop", { dataTransfer: t, bubbles: true, cancelable: true }),
        );
      } else {
        document.querySelector("textarea")?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: t, bubbles: true, cancelable: true }),
        );
      }
    },
    { base64: PNG_BASE64, size, type, head, via },
  );
}

export const ROOT_TITLE = "We build software with agents";

import { appendFileSync } from "node:fs";

export const cardEv = (id: string, parent: string | null, extra: Record<string, unknown> = {}) => [
  {
    type: "node.proposed",
    id,
    kind: "card",
    title: extra.title ?? `Title ${id}`,
    status: extra.status ?? "open",
    why: "because",
    ...(parent ? { parent } : {}),
  },
  { type: "node.accepted", id, actor: "you" },
];
export const decidedEv = (id: string, parent: string | null, extra: Record<string, unknown> = {}) => [
  ...cardEv(id, parent, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
/** Appends raw events to the project's map log. */
export function appendLog(dir: string, ...events: unknown[]) {
  appendFileSync(join(dir, ".werk", "log.jsonl"), `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`);
}

/** Decides the fixture's root card, so its children can be decided. */
export const decideRoot = [
  { type: "node.edited", id: "root", who: "me", noBasis: "test" },
  { type: "criterion.added", id: "root", form: "revisit" },
  { type: "node.decided", id: "root" },
];

export const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8];
export const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
