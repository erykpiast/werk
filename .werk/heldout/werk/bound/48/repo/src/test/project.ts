// The test harness: a fresh temporary project for each test (#werk-base-test-project,
// #werk-test-store). A test runs werk commands against it and reads each exit code and its
// output. The run's preload removes every project and stops every process when the test ends,
// also when the test fails.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE, type Step } from "./fake-script.ts";

export type Run = { code: number; out: string; err: string };

export type RunOptions = { cwd?: string; stdin?: string; env?: Record<string, string> };

/** A script as a test writes it: an omitted exit is 0. */
export type ScriptInput = { roles: Record<string, { replies: Step[][]; exit?: number }> };

/** One launch of the fake agent: its arguments, its role and the messages it read. */
export type Launch = { pid: number; args: string[]; role: string; messages: unknown[] };

export type Project = {
  /** The project: a git repository with an empty map. */
  dir: string;
  /** The target repository that a build works on. */
  target: string;
  /** The environment of every command the harness runs: the run's own, plus this project's script. */
  env: Record<string, string>;
  /** Run `werk` in the project and wait for it to end. */
  werk(args: string[], options?: RunOptions): Promise<Run>;
  /** Run any command in the project and wait for it to end. */
  run(command: string[], options?: RunOptions): Promise<Run>;
  /** Start a command with piped input and output. The harness stops it when the test ends. */
  start(command: string[], options?: Omit<RunOptions, "stdin">): Subprocess<"pipe", "pipe", "pipe">;
  /** Install the script that the fake agent replays for this project. */
  script(script: ScriptInput): void;
  /** Every launch of the fake agent so far, in launch order. */
  launches(): Launch[];
};

const CLI = join(import.meta.dir, "..", "cli.ts");

const cleanups: (() => Promise<void>)[] = [];

/** Stop everything the harness started and remove every project. The run's preload calls it after each test. */
export async function removeProjects(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

function git(cwd: string, ...args: string[]): void {
  const run = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString()}`);
}

function gitRepository(dir: string): void {
  git(dir, "init", "--quiet", "--initial-branch=main");
  git(dir, "config", "user.name", "werk test");
  git(dir, "config", "user.email", "test@werk.invalid");
}

function readLaunches(file: string): Launch[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const launches: Launch[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const entry = JSON.parse(line) as LaunchEntry;
    if (entry.kind === "launch") launches.push({ pid: entry.pid, args: entry.args, role: entry.role, messages: [] });
    else launches.findLast((launch) => launch.pid === entry.pid)?.messages.push(entry.message);
  }
  return launches;
}

/** A fresh project and target repository, removed when the current test ends. */
export function freshProject(): Project {
  // The real path, so a path that a child process prints compares equal to the project's.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-test-")));
  const running = new Set<Subprocess>();
  cleanups.push(async () => {
    for (const proc of running) proc.kill("SIGKILL");
    await Promise.all([...running].map((proc) => proc.exited));
    rmSync(root, { recursive: true, force: true });
  });

  const dir = join(root, "project");
  const target = join(root, "target");
  const fake = join(root, "fake-agent");
  for (const folder of [dir, target, fake]) mkdirSync(folder);
  gitRepository(dir);
  gitRepository(target);
  mkdirSync(join(dir, ".werk"));
  writeFileSync(join(dir, ".werk", "log.jsonl"), "");

  const env = { ...process.env, [FAKE_DIR_VAR]: fake } as Record<string, string>;

  const start = (command: string[], options: Omit<RunOptions, "stdin"> = {}) => {
    const proc = Bun.spawn(command, {
      cwd: options.cwd ?? dir,
      env: { ...env, ...options.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    running.add(proc);
    void proc.exited.then(() => running.delete(proc));
    return proc;
  };

  const run = async (command: string[], options: RunOptions = {}): Promise<Run> => {
    const proc = start(command, options);
    if (options.stdin !== undefined) proc.stdin.write(options.stdin);
    await proc.stdin.end();
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, out, err };
  };

  return {
    dir,
    target,
    env,
    run,
    start,
    werk: (args, options) => run([process.execPath, CLI, ...args], options),
    script: (script) => writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script)),
    launches: () => readLaunches(join(fake, LAUNCHES_FILE)),
  };
}
