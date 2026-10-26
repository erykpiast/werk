import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../../src/test-env/env.ts";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import type { Script } from "../../src/fake-agent/script.ts";

export const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

export const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

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

export type Srv = Awaited<ReturnType<typeof startServer>>;

/** Same shape as e2e/support/server.ts, but it keeps the server output and the pid. */
export async function startServer(
  opts: { script?: Script; appCopy?: boolean; env?: Record<string, string> } = {},
) {
  const base = { ...cleanEnv(process.env), WERK_OPEN: "true", ...opts.env };
  if (!fakeIsFirst(base.PATH)) throw new Error("fake agent not first");
  const root = mkdtempSync(join(tmpdir(), "werk-held-c-"));
  const scriptPath = join(root, "script.json");
  if (opts.script) writeFileSync(scriptPath, JSON.stringify(opts.script));
  const env = opts.script ? { ...base, WERK_FAKE_SCRIPT: scriptPath } : base;
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
  const srv = {
    url,
    origin,
    dir,
    appDir,
    home,
    output: "",
    pid: 0,
    logPath: join(dir, ".werk", "log.jsonl"),
    scriptPath,
    async start() {
      const c = spawn("bun", [cli, "serve", "--port", String(port)], {
        cwd: dir,
        env: { ...env, WERK_DEV: "1", WERK_HOME: home },
      });
      child = c;
      srv.pid = c.pid ?? 0;
      for (const s of [c.stdout, c.stderr]) {
        s?.on("data", (d) => {
          srv.output += String(d);
        });
      }
      const end = Date.now() + 40000;
      for (;;) {
        if (c.exitCode !== null) throw new Error(`server exited:\n${srv.output}`);
        const r = await fetch(`${origin}/api/projects`).catch(() => null);
        if (r?.ok) break;
        if (Date.now() > end) throw new Error("server timeout");
        await new Promise((r2) => setTimeout(r2, 100));
      }
    },
    async stop() {
      const c = child;
      child = undefined;
      if (!c || c.exitCode !== null) return;
      const done = new Promise((d) => c.once("exit", d));
      c.kill("SIGTERM");
      await done;
    },
    alive() {
      try {
        process.kill(srv.pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    launches: () => readRecords(logPathFor(scriptPath)),
    messages: () =>
      readRecords(logPathFor(scriptPath)).flatMap((r) =>
        r.kind === "message" ? [r.text] : [],
      ),
    launched: () =>
      readRecords(logPathFor(scriptPath)).flatMap((r) =>
        r.kind === "launch" ? [r.args] : [],
      ),
    werk(...args: string[]) {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    /** Runs werk and demands success. */
    ok(...args: string[]) {
      const r = srv.werk(...args);
      if (r.code !== 0) throw new Error(`werk ${args.join(" ")}: ${r.stdout}${r.stderr}`);
      return r;
    },
    /** Adds a card under a parent and accepts it. */
    card(id: string, title: string, parent: string, extra: string[] = []) {
      srv.ok("add", id, "--title", title, "--parent", parent, ...extra);
      srv.ok("accept", id, "--actor", "you");
    },
    /** Decides a card; its parent must be decided already. */
    decide(id: string) {
      srv.ok("edit", id, "--who", "me", "--no-basis", "held-out");
      srv.ok("kill", id, "--revisit");
      srv.ok("status", id, "decided");
    },
    async dispose() {
      await srv.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
  return srv;
}

export async function withServer(
  opts: Parameters<typeof startServer>[0],
  body: (s: Srv) => Promise<void>,
  prep?: (s: Srv) => void,
) {
  const s = await startServer(opts);
  try {
    prep?.(s);
    await s.start();
    await body(s);
  } finally {
    await s.dispose();
  }
}

export const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
export const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
export const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
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

/**
 * Pastes (or drops) one image. `size` null keeps the sample bytes; a number pads to that many bytes.
 * `kind` picks the first bytes: a real PNG, or a JPEG header.
 */
export async function pasteImage(
  page: Page,
  size: number | null = null,
  kind: "png" | "jpeg" = "png",
  how: "paste" | "drop" = "paste",
) {
  await composer(page).focus();
  await page.evaluate(
    ({ base64, size, kind, how }) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
      const sample = kind === "png" ? png : jpg;
      const data = new Uint8Array(size ?? sample.length);
      data.set(sample);
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([data], kind === "png" ? "shot.png" : "shot.jpg", {
          type: kind === "png" ? "image/png" : "image/jpeg",
        }),
      );
      if (how === "paste") {
        document.querySelector("textarea")?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
      } else {
        document.querySelector("[data-slot=composer]")?.dispatchEvent(
          new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
      }
    },
    { base64: PNG_BASE64, size, kind, how },
  );
}

export { appendFileSync };
