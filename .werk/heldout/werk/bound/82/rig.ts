// A test rig for the chat tests: a project with a real werk server that can restart, and a script
// the fake agent replays. Built on the same pieces as the product's own harness.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, LAUNCHES_FILE, SCRIPT_FILE } from "../src/test/fake-script.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type Rig = {
  dir: string;
  root: string;
  url: string;
  werk(...args: string[]): string;
  seed(type: string, payload: object): void;
  script(script: object): void;
  launches(): { pid: number; args: string[]; role: string; messages: string[]; answers: unknown[] }[];
  restart(): Promise<void>;
  stop(): Promise<void>;
  err(): string;
  clean(): void;
};

export async function rig(script: object = { roles: {} }, before: (r: Pick<Rig, "seed" | "werk">) => void = () => undefined): Promise<Rig> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-rig-")));
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script));
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
  before({ seed, werk });
  let proc: ChildProcess | undefined;
  let err = "";
  let port = 0;
  const launch = () =>
    new Promise<string>((resolve, reject) => {
      const p = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
      proc = p;
      let out = "";
      p.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
        const m = /http:\/\/\S+/.exec(out);
        if (m) resolve(m[0].replace(/\/map$/, ""));
      });
      p.stderr?.on("data", (c: Buffer) => (err += c.toString()));
      p.on("exit", (code) => reject(new Error(`serve exited ${code}: ${err}`)));
    });
  const url = await launch();
  port = Number(new URL(url).port);
  const stop = async () => {
    const p = proc;
    if (!p || p.exitCode !== null) return;
    const done = new Promise((r) => p.once("exit", r));
    p.kill("SIGTERM");
    await done;
  };
  return {
    dir,
    root,
    url,
    werk,
    seed,
    script: (s) => writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(s)),
    launches: () => {
      const file = join(fake, LAUNCHES_FILE);
      if (!existsSync(file)) return [];
      const out: { pid: number; args: string[]; role: string; messages: string[]; answers: unknown[] }[] = [];
      for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
        const e = JSON.parse(line);
        if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, role: e.role, messages: [], answers: [] });
        else {
          const l = out.find((x) => x.pid === e.pid);
          if (e.kind === "message") l?.messages.push(e.message?.message?.content?.[0]?.text ?? "");
          else l?.answers.push(e.answer);
        }
      }
      return out;
    },
    restart: async () => {
      await stop();
      await launch();
    },
    stop,
    err: () => err,
    clean: () => {
      void stop().then(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    },
  };
}
