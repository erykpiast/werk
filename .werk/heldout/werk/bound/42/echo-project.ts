// A project like e2e/project.ts, with the echo agent first on PATH (held-out test double).
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const ECHO_BIN = fileURLToPath(new URL("./echo", import.meta.url));
let server: ChildProcess | undefined;
let root: string | undefined;

export async function stopEcho() {
  const proc = server;
  server = undefined;
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill("SIGTERM");
    await exited;
  }
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  root = undefined;
}

export async function echoProject(before: (seed: (type: string, payload: object) => void) => void = () => undefined) {
  root = realpathSync(mkdtempSync(join(tmpdir(), "heldout-echo-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const env = { ...cleanEnv(process.env, ECHO_BIN) };
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object) => appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "t", actor: "you", type, payload })}\n`);
  seed("node.added", { id: "root", kind: "card", title: "Root" });
  before(seed);
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  server = proc;
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    let err = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const f = /http:\/\/\S+/.exec(out);
      if (f) resolve(f[0].replace(/\/map$/, ""));
    });
    proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
    proc.on("exit", (code) => reject(new Error(`serve exited ${code}: ${err}`)));
  });
  return { dir, url, seed };
}
