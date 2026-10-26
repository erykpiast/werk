// Step 61.3: the tests pass on a machine with no real agent installed.
import { expect, test } from "bun:test";
import { freshClone, pathWithoutClaude, personEnv, run, sh } from "./repo-helpers.ts";

test("61.3 make test passes with no claude on PATH and leaves the working tree clean", () => {
  const base = personEnv();
  const env = { ...base, PATH: pathWithoutClaude(base.PATH ?? "") };
  expect(sh("command -v claude || echo NONE", "/", env).out.trim()).toBe("NONE");
  const dir = freshClone("noagent", env);
  const before = sh("git status --porcelain --ignored=no", dir, env).out;
  const t = run(["make", "test"], dir, env);
  console.log(t.out.slice(-800));
  expect(t.code).toBe(0);
  // The fake agent's own tests ran in this run: scripted events and a file edit in a temp project.
  const fake = run(["bun", "test", "--timeout=15000", "./src/test/fake-agent.test.ts"], dir, env);
  console.log(fake.out.slice(-1500));
  expect(fake.code).toBe(0);
  expect(fake.out).toMatch(/14 pass\n 0 fail/);
  const after = sh("git status --porcelain", dir, env).out;
  console.log("status before:", JSON.stringify(before), "after:", JSON.stringify(after));
  expect(after).toBe("");
}, 1_800_000);
