// The preload of the unit run, loaded before any test file (#werk-test-env, #werk-test-external).
// It cleans the environment once, before the first test, and makes Bun's spawn, program lookup
// and shell default to the cleaned environment: they read the environment the process started
// with, so an edit of process.env alone would leave them on the real one.
import { afterEach } from "bun:test";
import { join } from "node:path";
import { cleanEnv, fakeFirst } from "./clean-env.ts";
import { removeProjects } from "./project.ts";

export const FAKE_BIN = join(import.meta.dir, "fake-bin");

const clean = cleanEnv(process.env, FAKE_BIN);
for (const name of Object.keys(process.env)) if (!(name in clean)) delete process.env[name];
Object.assign(process.env, clean);

type Options = { env?: Record<string, string | undefined> } | undefined;
const withEnv = (options: Options) => ({ ...options, env: options?.env ?? process.env });
const { spawn, spawnSync, which } = Bun;
Object.assign(Bun, {
  spawn: (command: unknown, options?: Options) =>
    Array.isArray(command) ? spawn(command, withEnv(options) as never) : spawn(withEnv(command as Options) as never),
  spawnSync: (command: unknown, options?: Options) =>
    Array.isArray(command)
      ? spawnSync(command, withEnv(options) as never)
      : spawnSync(withEnv(command as Options) as never),
  which: (command: string, options?: { PATH?: string; cwd?: string }) =>
    which(command, { ...options, PATH: options?.PATH ?? process.env.PATH }),
});
Bun.$.env(process.env);

// A setup that cannot confirm the fake comes first refuses to run any test.
if (!fakeFirst(process.env, FAKE_BIN)) throw new Error("the fake agent is not first on PATH");

afterEach(removeProjects);
