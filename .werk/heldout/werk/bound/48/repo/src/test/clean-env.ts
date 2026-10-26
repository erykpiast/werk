// The environment every test and every process a test starts runs with (#werk-test-env,
// #werk-test-external): no variable that points at a real project, the fake agent first on
// the program search list, and no git configuration of the person who runs the tests.

export type Env = Record<string, string | undefined>;

/** Variables outside the WERK_ prefix that point at a real project or at a real repository. */
const REAL_PROJECT_VARS = ["CLAUDE_PROJECT_DIR", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"];

/** True when the variable can lead a test to a real project: every WERK_ variable, and a few others. */
export function pointsAtRealProject(name: string): boolean {
  return name.startsWith("WERK_") || REAL_PROJECT_VARS.includes(name);
}

/** The environment of the test run: `env` without the real project, with `fakeBin` first on PATH. */
export function cleanEnv(env: Env, fakeBin: string): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !pointsAtRealProject(name)) clean[name] = value;
  }
  const rest = (env.PATH ?? "").split(":").filter((dir) => dir !== "" && dir !== fakeBin);
  clean.PATH = [fakeBin, ...rest].join(":");
  // The person's own git configuration can sign commits or run hooks, so git reads none of it.
  clean.GIT_CONFIG_GLOBAL = "/dev/null";
  clean.GIT_CONFIG_NOSYSTEM = "1";
  return clean;
}

/** True when the first directory on PATH is `fakeBin`, so a lookup of the agent finds the fake. */
export function fakeFirst(env: Env, fakeBin: string): boolean {
  return (env.PATH ?? "").split(":")[0] === fakeBin;
}
