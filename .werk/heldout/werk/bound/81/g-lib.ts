// Browser helper of group G: a werk server on a fresh project with the fake agent, which can restart on its port.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE } from "../src/test/fake-script.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type W = {
  dir: string;
  fake: string;
  url: string;
  werk(...args: string[]): string;
  seed(type: string, payload: object): void;
  setScript(script: object): void;
  stop(): Promise<void>;
  restart(): Promise<void>;
  launches(): { pid: number; args: string[]; role: string; messages: string[]; answers: unknown[] }[];
};

let roots: string[] = [];
let procs: ChildProcess[] = [];

export async function cleanup(): Promise<void> {
  for (const p of procs) {
    if (p.exitCode === null && p.signalCode === null) {
      const done = new Promise((r) => p.once("exit", r));
      p.kill("SIGTERM");
      await done;
    }
  }
  procs = [];
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export async function start(script: object, before: (w: Pick<W, "dir" | "werk" | "seed">) => void = () => undefined): Promise<W> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g-")));
  roots.push(root);
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  const setScript = (s: object) => writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(s));
  setScript(script);
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake };
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "t", actor: "you", type, payload })}\n`);
  const werk = (...args: string[]) => {
    const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
    if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
    return run.stdout;
  };
  seed("node.added", { id: "root", kind: "card", title: "Root" });
  before({ dir, werk, seed });

  let proc: ChildProcess | undefined;
  let port = 0;
  const launch = async (): Promise<string> => {
    const p = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    proc = p;
    procs.push(p);
    let err = "";
    p.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    return new Promise((resolve, reject) => {
      let out = "";
      p.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
        const f = /http:\/\/\S+/.exec(out);
        if (f !== null) resolve(f[0].replace(/\/map$/, ""));
      });
      p.once("exit", (code) => reject(new Error(`serve exited ${code}: ${err}`)));
    });
  };
  const stop = async () => {
    const p = proc;
    if (p === undefined || p.exitCode !== null || p.signalCode !== null) return;
    const done = new Promise((r) => p.once("exit", r));
    p.kill("SIGTERM");
    await done;
  };
  const url = await launch();
  port = Number(new URL(url).port);
  return {
    dir,
    fake,
    url,
    werk,
    seed,
    setScript,
    stop,
    restart: async () => {
      await stop();
      await launch();
    },
    launches: () => {
      const file = join(fake, LAUNCHES_FILE);
      if (!existsSync(file)) return [];
      const out: ReturnType<W["launches"]> = [];
      for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
        const e = JSON.parse(line) as LaunchEntry;
        if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, role: e.role, messages: [], answers: [] });
        else {
          const l = out.findLast((x) => x.pid === e.pid);
          if (e.kind === "message") l?.messages.push((e.message as { message: { content: { text: string }[] } }).message.content[0]?.text ?? "");
          else l?.answers.push(e.answer);
        }
      }
      return out;
    },
  };
}

export const stream = (event: object) => ({ event: { type: "stream_event", event } });
export const msgStart = (id: string) => stream({ type: "message_start", message: { id } });
export const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
export const more = (text: string) => stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
export const done = (id: string, text: string, usage?: object) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) } },
});
export const reply = (id: string, text: string, usage?: object) => [msgStart(id), open(text), done(id, text, usage)];
export const init = (session: string) => ({ event: { type: "system", subtype: "init", session_id: session } });

export const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
export const turns = (p: Page) => pane(p).locator("[data-turn]");
export async function say(p: Page, words: string): Promise<void> {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}
