import { delimiter, resolve } from "node:path";

/** The folder that holds the fake agent. */
export const FAKE_DIR = resolve(import.meta.dir, "../../fake");

/** Every variable that starts with this prefix points at a real project, its log, or its role. */
const PROJECT_PREFIX = "WERK_";

type Env = Record<string, string | undefined>;

/** The program search list with the fake folder first and no second copy of it. */
export function pathWithFake(
  path: string | undefined,
  fakeDir: string,
): string {
  const rest = (path ?? "").split(delimiter).filter((p) => p && p !== fakeDir);
  return [fakeDir, ...rest].join(delimiter);
}

/** A copy of the environment that cannot reach a real project and finds the fake agent first. */
export function cleanEnv(
  env: Env,
  fakeDir: string = FAKE_DIR,
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key.startsWith(PROJECT_PREFIX)) continue;
    clean[key] = value;
  }
  clean.PATH = pathWithFake(env.PATH, fakeDir);
  return clean;
}

/** True when the fake folder is the first entry of the program search list. */
export function fakeIsFirst(
  path: string | undefined,
  fakeDir: string = FAKE_DIR,
): boolean {
  return (path ?? "").split(delimiter)[0] === fakeDir;
}
