// F6 helper: a werk server on a fresh project with the fake agent, which can restart on its port.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE } from "../src/test/fake-script.ts";
import type { ScriptInput } from "../src/test/project.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type Boot = {
  dir: string;
  fake: string;
  url: string;
  port: number;
  werk(...args: string[]): string;
  seed(type: string, payload: object): void;
  setScript(s: ScriptInput): void;
  launches(): LaunchEntry[];
  askLog(): Record<string, unknown>[];
  restart(): Promise<void>;
  stop(): Promise<void>;
};

const live: Boot[] = [];
export async function stopAll() {
  for (const b of live.splice(0)) await b.stop().catch(() => undefined);
}

export async function boot(
  script: ScriptInput = { roles: {} },
  before: (b: Boot) => void = () => undefined,
): Promise<Boot> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-")));
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake };
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  let proc: ChildProcess | undefined;
  let port = 0;
  const launch = () =>
    new Promise<string>((resolve, reject) => {
      const p = spawn("bun", [CLI, "serve", "--port", String(port)], {
        cwd: dir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc = p;
      let out = "";
      let err = "";
      p.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
        const f = /http:\/\/\S+/.exec(out);
        if (f) resolve(f[0].replace(/\/map$/, ""));
      });
      p.stderr?.on("data", (c: Buffer) => {
        err += c.toString();
      });
      p.on("exit", (code) => reject(new Error(`serve exited ${code}: ${err}`)));
    });
  const b = {} as Boot;
  Object.assign(b, {
    dir,
    fake,
    werk: (...args: string[]) => {
      const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
      return r.stdout;
    },
    seed: (type: string, payload: object) =>
      appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "t", actor: "you", type, payload })}\n`),
    setScript: (s: ScriptInput) => writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(s)),
    launches: () =>
      existsSync(join(fake, LAUNCHES_FILE))
        ? readFileSync(join(fake, LAUNCHES_FILE), "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l) as LaunchEntry)
        : [],
    askLog: () =>
      readFileSync(join(dir, ".werk", "asks.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    stop: async () => {
      const p = proc;
      if (!p || p.exitCode !== null || p.signalCode !== null) return;
      const exited = new Promise((r) => p.once("exit", r));
      p.kill("SIGTERM");
      await exited;
    },
    restart: async () => {
      await b.stop();
      await launch();
    },
  });
  b.seed("node.added", { id: "root", kind: "card", title: "Root" });
  before(b);
  b.url = await launch();
  b.port = Number(new URL(b.url).port);
  port = b.port;
  live.push(b);
  return b;
}

export const stream = (event: object) => ({ event: { type: "stream_event", event } });
export const start = (id: string) => stream({ type: "message_start", message: { id } });
export const open = (text: string) =>
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
export const more = (text: string) =>
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
export const done = (id: string, text: string, usage?: object) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) } },
});
export const reply = (id: string, text: string) => [start(id), open(text), done(id, text)];
export const init = (session: string) => ({ event: { type: "system", subtype: "init", session_id: session } });

export const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
export const turns = (p: Page) => pane(p).locator("[data-turn]");
export async function say(p: Page, words: string, key: "click" | "Enter" = "click"): Promise<void> {
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill(words);
  if (key === "Enter") await box.press("Enter");
  else await pane(p).getByRole("button", { name: "Send" }).click();
}
export const heardMessages = (b: Boot): string[] =>
  b
    .launches()
    .flatMap((e) =>
      e.kind === "message"
        ? [(e.message as { message: { content: { text: string }[] } }).message.content[0]?.text ?? ""]
        : [],
    );
export const answers = (b: Boot): unknown[] => b.launches().flatMap((e) => (e.kind === "answer" ? [e.answer] : []));
export const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
export const samePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
export { rmSync };
