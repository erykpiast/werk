import { expect, test } from "bun:test";
import { cleanEnv, fakeFirst, pointsAtRealProject } from "./clean-env.ts";

test("every WERK_ variable and every variable that names a real repository points at a real project", () => {
  for (const name of ["WERK_LOG", "WERK_ROLE", "WERK_DEV", "CLAUDE_PROJECT_DIR", "GIT_DIR", "GIT_WORK_TREE"]) {
    expect(pointsAtRealProject(name)).toBe(true);
  }
  for (const name of ["HOME", "PATH", "TMPDIR", "NOT_WERK_LOG"]) expect(pointsAtRealProject(name)).toBe(false);
});

test("the clean environment drops the real project and keeps the rest", () => {
  const env = cleanEnv(
    { WERK_LOG: "/real/.werk/log.jsonl", GIT_DIR: "/real/.git", HOME: "/home/a", EMPTY: undefined },
    "/fake",
  );
  expect(env.WERK_LOG).toBeUndefined();
  expect(env.GIT_DIR).toBeUndefined();
  expect(env.HOME).toBe("/home/a");
  expect("EMPTY" in env).toBe(false);
});

test("the fake agent's directory comes first on PATH, once", () => {
  expect(cleanEnv({ PATH: "/usr/bin:/fake:/bin" }, "/fake").PATH).toBe("/fake:/usr/bin:/bin");
  expect(cleanEnv({}, "/fake").PATH).toBe("/fake");
});

test("git reads no configuration of the person who runs the tests", () => {
  const env = cleanEnv({ GIT_CONFIG_GLOBAL: "/home/a/.gitconfig" }, "/fake");
  expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
  expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
});

test("the fake is first only when its directory is the first entry on PATH", () => {
  expect(fakeFirst({ PATH: "/fake:/usr/bin" }, "/fake")).toBe(true);
  expect(fakeFirst({ PATH: "/usr/bin:/fake" }, "/fake")).toBe(false);
  expect(fakeFirst({}, "/fake")).toBe(false);
});
