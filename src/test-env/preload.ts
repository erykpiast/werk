// Runs once before the first test (see bunfig.toml). See #werk-test-env.
import { cleanEnv, FAKE_DIR, fakeIsFirst } from "./env.ts";

const clean = cleanEnv(process.env);

for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, clean);

// Bun's spawn, program lookup and shell read the environment the process started with,
// not the edited one. Each of them gets the cleaned environment as its default.
type SpawnOptions = { env?: unknown; cmd?: unknown } & Record<string, unknown>;

function withEnv(options: SpawnOptions | undefined): SpawnOptions {
  return { ...options, env: options?.env ?? clean };
}

type AnySpawn = (...args: unknown[]) => unknown;

function defaultSpawnEnv<F>(original: F): F {
  const call = original as unknown as AnySpawn;
  const wrapped: AnySpawn = (cmdOrOptions, options) =>
    Array.isArray(cmdOrOptions)
      ? call(cmdOrOptions, withEnv(options as SpawnOptions | undefined))
      : call(withEnv(cmdOrOptions as SpawnOptions));
  return wrapped as unknown as F;
}

const bun = Bun as unknown as Record<string, unknown>;
bun.spawn = defaultSpawnEnv(Bun.spawn.bind(Bun));
bun.spawnSync = defaultSpawnEnv(Bun.spawnSync.bind(Bun));

const originalWhich = Bun.which.bind(Bun);
bun.which = (command: string, options?: { PATH?: string; cwd?: string }) =>
  originalWhich(command, { ...options, PATH: options?.PATH ?? clean.PATH });

Bun.$.env(clean);

if (!fakeIsFirst(process.env.PATH, FAKE_DIR)) {
  throw new Error(
    "werk: the fake agent is not first in the program search list",
  );
}
