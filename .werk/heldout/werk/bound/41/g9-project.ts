// A project with a scripted fake agent, like e2e/project.ts, with a restart on the same port and a script that a test can replace.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE } from "../src/test/fake-script.ts";
import type { ScriptInput } from "../src/test/project.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type W = {
  dir: string;
  url: string;
  setScript(script: ScriptInput): void;
  restart(): Promise<void>;
  entries(): LaunchEntry[];
  launches(): { pid: number; args: string[]; messages: string[]; answers: unknown[] }[];
  askLog(): Record<string, unknown>[];
  token(): Promise<string>;
};

let server: ChildProcess | undefined;
let root: string | undefined;

async function kill(): Promise<void> {
  const proc = server;
  server = undefined;
  if (proc !== undefined && proc.exitCode === null && proc.signalCode === null) {
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    proc.kill("SIGTERM");
    await exited;
  }
}

export async function stop(): Promise<void> {
  await kill();
  if (root !== undefined) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  root = undefined;
}

export async function project(script: ScriptInput): Promise<W> {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g9-")));
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake };
  writeFileSync(
    join(dir, ".werk", "log.jsonl"),
    `${JSON.stringify({ seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "root", kind: "card", title: "Root" } })}\n`,
  );
  let port = 0;
  const launch = async (): Promise<string> => {
    const proc = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    server = proc;
    let err = "";
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    return new Promise<string>((resolve, reject) => {
      let out = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        const found = /http:\/\/\S+/.exec(out);
        if (found !== null) resolve(found[0].replace(/\/map$/, ""));
      });
      proc.on("exit", (code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
    });
  };
  const url = await launch();
  port = Number(new URL(url).port);
  const entries = () => {
    const file = join(fake, LAUNCHES_FILE);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LaunchEntry);
  };
  return {
    dir,
    url,
    setScript: (next) => writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(next)),
    restart: async () => {
      await kill();
      await launch();
    },
    entries,
    launches: () => {
      const out: { pid: number; args: string[]; messages: string[]; answers: unknown[] }[] = [];
      for (const e of entries()) {
        if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, messages: [], answers: [] });
        else if (e.kind === "message") {
          const text = (e.message as { message: { content: { text: string }[] } }).message.content[0]?.text ?? "";
          out.find((x) => x.pid === e.pid)?.messages.push(text);
        } else out.find((x) => x.pid === e.pid)?.answers.push(e.answer);
      }
      return out;
    },
    askLog: () => {
      const file = join(dir, ".werk", "asks.jsonl");
      if (!existsSync(file)) return [];
      return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    },
    token: async () => {
      const html = await (await fetch(`${url}/map`)).text();
      return /name="werk-token" content="([^"]*)"/.exec(html)?.[1] ?? "";
    },
  };
}
