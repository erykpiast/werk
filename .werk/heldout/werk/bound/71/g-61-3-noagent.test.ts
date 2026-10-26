import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, install, make, personEnv, removeClones, sh } from "./g-lib.ts";

afterEach(removeClones);

test("61.3", async () => {
  const dir = await cloneCheckout();
  await install(dir);
  const env = personEnv();
  // No claude reachable on the person's PATH.
  expect(Bun.which("claude", { PATH: env.PATH })).toBeNull();
  const which = await sh(["/bin/sh", "-c", "command -v claude || echo none"], dir, env);
  expect(which.out.trim()).toBe("none");

  const t = await make(dir, "test");
  expect(t.code, t.all).toBe(0);
  expect(t.all).toMatch(/\b0 fail\b/);

  // The fake agent's own tests (scripted events, a file edit in a temp project) are part of the run and pass alone too.
  const fakeTest = join(dir, "src/test/fake-agent.test.ts");
  expect(existsSync(fakeTest)).toBe(true);
  expect(readFileSync(fakeTest, "utf8")).toMatch(/edit/);
  const alone = await sh(["bun", "test", "./src/test/fake-agent.test.ts"], dir, env);
  expect(alone.code, alone.all).toBe(0);

  const status = await sh(["git", "status", "--porcelain"], dir);
  expect(status.out).toBe("");
}, 900_000);
