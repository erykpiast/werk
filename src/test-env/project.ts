import { afterEach, beforeEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logPathFor, readRecords } from "../fake-agent/launch-log.ts";
import type { Script } from "../fake-agent/script.ts";
import { cleanEnv, FAKE_DIR, fakeIsFirst } from "./env.ts";

export type ProjectOptions = {
  /** The script the fake agent replays. With none, the fake exits with an error. */
  script?: Script;
};

export type RunResult = { code: number; stdout: string; stderr: string };

export type Project = {
  /** The project directory: a git repository with an empty map. */
  dir: string;
  /** The map log of the project. It does not exist until the first event. */
  logPath: string;
  /** The per-user folder of this test: the stored project list and the lock of the one server. */
  home: string;
  /** Makes another git repository with an empty map at a path below the test's folder, and returns it. */
  folder(...path: string[]): string;
  /** Runs a program in the project, or in the folder that the third argument names, and waits for it. */
  run(
    argv: string[],
    env?: Record<string, string>,
    cwd?: string,
  ): Promise<RunResult>;
  /** Starts a program in the project. The harness stops it when the test ends. */
  start(
    argv: string[],
    env?: Record<string, string>,
    cwd?: string,
  ): Bun.Subprocess<"ignore", "pipe", "pipe">;
  /** The events of the map log, one per line. */
  events(): unknown[];
  /** The launches and messages the fake agent recorded. */
  launches(): ReturnType<typeof readRecords>;
  /** Replaces the script of the fake agent. */
  install(script: Script): void;
  /** Removes the directories and stops every process the harness started. */
  dispose(): Promise<void>;
};

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: cleanEnv(process.env),
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString()}`,
    );
  }
}

function newRepo(path: string): void {
  mkdirSync(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.name", "werk test");
  git(path, "config", "user.email", "test@werk.invalid");
  git(path, "commit", "-q", "--allow-empty", "-m", "Start");
}

/** Refuses to hand out a project when the fake agent would not be found first. */
function assertFakeFirst(): void {
  if (!fakeIsFirst(process.env.PATH, FAKE_DIR)) {
    throw new Error(
      "werk: the fake agent is not first in the program search list",
    );
  }
}

export function createProject(options: ProjectOptions = {}): Project {
  assertFakeFirst();
  const root = mkdtempSync(join(tmpdir(), "werk-test-"));
  const dir = join(root, "project");
  const scriptPath = join(root, "script.json");
  const logPath = join(dir, ".werk", "log.jsonl");
  const home = join(root, "home");
  const children = new Set<Bun.Subprocess>();

  try {
    newRepo(dir);
    mkdirSync(join(dir, ".werk"));
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }

  const install = (script: Script) =>
    writeFileSync(scriptPath, JSON.stringify(script));
  if (options.script) install(options.script);

  // WERK_OPEN names a program that opens no window, so no test starts a real browser.
  const envFor = (extra?: Record<string, string>) => ({
    ...cleanEnv(process.env),
    WERK_FAKE_SCRIPT: scriptPath,
    WERK_HOME: home,
    WERK_OPEN: "true",
    ...extra,
  });

  const folder: Project["folder"] = (...path) => {
    const made = join(root, "folders", ...path);
    mkdirSync(made, { recursive: true });
    git(made, "init", "-q", "-b", "main");
    mkdirSync(join(made, ".werk"));
    return made;
  };

  const start: Project["start"] = (argv, env, cwd) => {
    const child = Bun.spawn(argv, {
      cwd: cwd ?? dir,
      env: envFor(env),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    children.add(child);
    void child.exited.then(() => children.delete(child));
    return child;
  };

  const run: Project["run"] = async (argv, env, cwd) => {
    const child = start(argv, env, cwd);
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, stdout, stderr };
  };

  return {
    dir,
    logPath,
    home,
    folder,
    run,
    start,
    events: () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line))
        : [],
    launches: () => readRecords(logPathFor(scriptPath)),
    install,
    async dispose() {
      for (const child of children) child.kill("SIGKILL");
      await Promise.all([...children].map((child) => child.exited));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Runs the body on a fresh project and removes the project when the body ends, also on a failure. */
export async function withProject<T>(
  options: ProjectOptions,
  body: (project: Project) => Promise<T> | T,
): Promise<T> {
  const project = createProject(options);
  try {
    return await body(project);
  } finally {
    await project.dispose();
  }
}

/** Gives each test of the file a fresh project through the returned function. */
export function useProject(options: ProjectOptions = {}): () => Project {
  let current: Project | undefined;
  beforeEach(() => {
    current = createProject(options);
  });
  afterEach(async () => {
    await current?.dispose();
    current = undefined;
  });
  return () => {
    if (!current) throw new Error("werk: no project outside a test");
    return current;
  };
}
