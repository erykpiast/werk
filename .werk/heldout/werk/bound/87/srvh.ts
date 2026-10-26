// A restartable werk server on a fresh project, with a scripted fake agent. Used by the held-out chat tests.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE } from "../src/test/fake-script.ts";
import type { ScriptInput } from "../src/test/project.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type Srv = {
  dir: string;
  fake: string;
  url: string;
  port: number;
  pid(): number | undefined;
  err(): string;
  seed(type: string, payload: object): void;
  werk(...args: string[]): string;
  script(s: ScriptInput): void;
  launches(): { pid: number; args: string[]; role: string; messages: unknown[]; answers: unknown[] }[];
  stop(): Promise<void>;
  start(): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
};

const roots: string[] = [];
const servers: Srv[] = [];

export async function closeAll(): Promise<void> {
  for (const s of servers.splice(0)) await s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export async function server(
  script: ScriptInput = { roles: {} },
  before: (s: Pick<Srv, "seed" | "dir">) => void = () => undefined,
  extraEnv: Record<string, string> = {},
): Promise<Srv> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-held-")));
  roots.push(root);
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake, ...extraEnv };
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const n = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: n() + 1, at: "t", actor: "you", type, payload })}\n`);
  seed("node.added", { id: "root", kind: "card", title: "Root" });
  before({ seed, dir });

  let proc: ChildProcess | undefined;
  let err = "";
  let port = 0;
  const s: Srv = {
    dir,
    fake,
    url: "",
    port: 0,
    pid: () => proc?.pid,
    err: () => err,
    seed,
    werk: (...args) => {
      const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
      if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
      return run.stdout;
    },
    script: (sc) => writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(sc)),
    launches: () => {
      const file = join(fake, LAUNCHES_FILE);
      if (!existsSync(file)) return [];
      const out: ReturnType<Srv["launches"]> = [];
      for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
        const e = JSON.parse(line) as LaunchEntry;
        if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, role: e.role, messages: [], answers: [] });
        else {
          const l = out.findLast((x) => x.pid === e.pid);
          if (e.kind === "message") l?.messages.push(e.message);
          else l?.answers.push(e.answer);
        }
      }
      return out;
    },
    start: async () => {
      const next = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
      proc = next;
      next.stderr?.on("data", (c: Buffer) => (err += c.toString()));
      const url = await new Promise<string>((resolve, reject) => {
        let out = "";
        next.stdout?.on("data", (c: Buffer) => {
          out += c.toString();
          const f = /http:\/\/\S+/.exec(out);
          if (f !== null) resolve(f[0].replace(/\/map$/, ""));
        });
        next.once("exit", (code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
      });
      s.url = url;
      s.port = Number(new URL(url).port);
      port = s.port;
    },
    stop: async () => {
      const p = proc;
      if (p === undefined || p.exitCode !== null || p.signalCode !== null) return;
      const exited = new Promise((r) => p.once("exit", r));
      p.kill("SIGTERM");
      await exited;
    },
    restart: async () => {
      await s.stop();
      await s.start();
    },
    close: async () => {
      await s.stop();
    },
  };
  servers.push(s);
  await s.start();
  return s;
}

export const stream = (event: object) => ({ event: { type: "stream_event", event } });
export const startMsg = (id: string) => stream({ type: "message_start", message: { id } });
export const openText = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
export const moreText = (text: string) => stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
export const doneMsg = (id: string, text: string) => ({ event: { type: "assistant", message: { id, content: [{ type: "text", text }] } } });
export const reply = (id: string, text: string) => [startMsg(id), openText(text), doneMsg(id, text)];
export const init = (session: string) => ({ event: { type: "system", subtype: "init", session_id: session } });
