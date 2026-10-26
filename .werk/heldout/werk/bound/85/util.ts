// Shared helper of the held-out browser tests: a project with a script for the fake agent, a server
// that can stop and start again on the same port, and the launches of the fake agent.
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

export type Held = ReturnType<typeof heldProject> extends Promise<infer T> ? T : never;
const roots: string[] = [];
const procs = new Set<ChildProcess>();

export async function cleanup() {
  for (const pr of procs) if (pr.exitCode === null) pr.kill("SIGKILL");
  procs.clear();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export async function heldProject(script: ScriptInput = { roles: {} }, before: (w: { seed(type: string, payload: object, actor?: string): void; werk(...a: string[]): string; dir: string }) => void = () => undefined) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-held-")));
  roots.push(root);
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake } as Record<string, string>;
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const n = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object, actor = "you") =>
    appendFileSync(log, `${JSON.stringify({ seq: n() + 1, at: "t", actor, type, payload })}\n`);
  const werk = (...a: string[]) => {
    const r = spawnSync("bun", [CLI, ...a], { cwd: dir, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`werk ${a.join(" ")} exited ${r.status}: ${r.stderr}`);
    return r.stdout;
  };
  seed("node.added", { id: "root", kind: "card", title: "Root" });
  before({ seed, werk, dir });
  let proc: ChildProcess | undefined;
  let port = 0;
  let err = "";
  const launch = () =>
    new Promise<string>((resolve, reject) => {
      const pr = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
      proc = pr;
      procs.add(pr);
      let out = "";
      pr.stdout?.on("data", (c: Buffer) => {
        out += c;
        const m = /http:\/\/\S+/.exec(out);
        if (m) resolve(m[0].replace(/\/map$/, ""));
      });
      pr.stderr?.on("data", (c: Buffer) => (err += c));
      pr.once("exit", (code) => reject(new Error(`serve exited ${code}: ${err}`)));
    });
  const url = await launch();
  port = Number(new URL(url).port);
  const stopServer = async () => {
    const pr = proc;
    if (!pr || pr.exitCode !== null) return;
    const done = new Promise((r) => pr.once("exit", r));
    pr.kill("SIGTERM");
    await done;
  };
  return {
    dir,
    fake,
    url,
    seed,
    werk,
    log,
    err: () => err,
    pid: () => proc?.pid,
    setScript: (s: ScriptInput) => writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(s)),
    stop: stopServer,
    restart: async () => {
      await stopServer();
      await launch();
    },
    launches: () => {
      const file = join(fake, LAUNCHES_FILE);
      if (!existsSync(file)) return [] as { pid: number; args: string[]; role: string; messages: string[]; answers: unknown[] }[];
      const out: { pid: number; args: string[]; role: string; messages: string[]; answers: unknown[] }[] = [];
      for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
        const e = JSON.parse(line) as LaunchEntry;
        if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, role: e.role, messages: [], answers: [] });
        else {
          const l = out.find((x) => x.pid === e.pid);
          if (e.kind === "message") l?.messages.push((e.message as any).message.content[0]?.text ?? "");
          else l?.answers.push(e.answer);
        }
      }
      return out;
    },
  };
}
export const flagOf = (args: string[] | undefined, name: string) => {
  const at = args?.indexOf(name) ?? -1;
  return at < 0 ? undefined : args?.[at + 1];
};
