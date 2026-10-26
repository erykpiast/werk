import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

export type Run = { code: number; out: string; err: string };
export type Werk = {
  dir: string;
  url: string;
  log: string;
  lines(): string[];
  run(...args: string[]): Run;
  werk(...args: string[]): string;
  seed(type: string, payload: object): void;
  chat(name: string, messages: object[]): void;
};

function env(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  delete clean.WERK_LOG;
  return clean;
}

const cleanups: (() => void)[] = [];
export function cleanup(): void {
  for (const c of cleanups.splice(0)) c();
}

export async function project(seedRoot = true): Promise<Werk> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-e2e-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines().length + 1, at: "t", actor: "you", type, payload })}\n`);
  const run = (...args: string[]): Run => {
    const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env: env(), encoding: "utf8" });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  };
  const werk = (...args: string[]) => {
    const r = run(...args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
    return r.out;
  };
  const chat = (name: string, messages: object[]) => {
    mkdirSync(join(dir, ".werk", "chats"), { recursive: true });
    writeFileSync(join(dir, ".werk", "chats", `${name}.jsonl`), `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`);
  };
  if (seedRoot) seed("node.added", { id: "root", kind: "card", title: "Root" });

  const proc: ChildProcess = spawn("bun", [CLI, "serve", "--port", "0"], {
    cwd: dir,
    env: env(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  cleanups.push(() => {
    proc.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    let err = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    proc.on("exit", (code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
  });
  return { dir, url, log, lines, run, werk, seed, chat };
}
