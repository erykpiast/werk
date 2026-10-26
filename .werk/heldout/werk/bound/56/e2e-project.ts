// A fresh project and a real werk server on it, for the held-out browser tests. The agent's steps
// run the werk command line; the person's steps run in the page.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

export type Werk = {
  dir: string;
  log: string;
  url: string;
  werk(...args: string[]): string;
  run(...args: string[]): { code: number; out: string; err: string };
  seed(type: string, payload: object, actor?: string): void;
  lines(): number;
  serve(): Promise<string>;
};

function env(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  delete clean.WERK_LOG;
  return clean;
}

const servers: ChildProcess[] = [];
const roots: string[] = [];

export function stop(): void {
  for (const server of servers.splice(0)) server.kill("SIGTERM");
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** A fresh project with no server yet. */
export function project(): Werk {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-e2e-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object, actor = "you") =>
    appendFileSync(
      log,
      `${JSON.stringify({ seq: lines() + 1, at: "2026-01-01T00:00:00.000Z", actor, type, payload })}\n`,
    );
  const run = (...args: string[]) => {
    const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env: env(), encoding: "utf8" });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  };
  const werk = (...args: string[]) => {
    const r = run(...args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
    return r.out;
  };
  const w: Werk = {
    dir,
    log,
    url: "",
    werk,
    run,
    seed,
    lines,
    serve: async () => {
      const proc = spawn("bun", [CLI, "serve", "--port", "0"], {
        cwd: dir,
        env: env(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      servers.push(proc);
      w.url = await new Promise<string>((resolve, reject) => {
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
      return w.url;
    },
  };
  return w;
}

/** A project with a #root card and a running server. */
export async function served(): Promise<Werk> {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  await w.serve();
  return w;
}
