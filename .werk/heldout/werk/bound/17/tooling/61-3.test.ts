// 61.3: The tests pass on a machine with no real agent installed.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { copyCheckout, sh } from "./copy.ts";

const copy = copyCheckout();
afterAll(() => copy.remove());

test("61.3", () => {
  // A shell PATH with only the tools a run needs and no `claude` anywhere on it.
  const bin = join(copy.dir, "..", "bin");
  mkdirSync(bin);
  for (const tool of ["bun", "make", "git"]) symlinkSync(sh("/", `command -v ${tool}`).out.trim(), join(bin, tool));
  const env = { HOME: process.env.HOME, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: process.env.TMPDIR };
  expect(sh(copy.dir, "command -v claude", env).code).not.toBe(0);

  const r = sh(copy.dir, "make test", env);
  console.log(r.out.slice(-1500));
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/fake-agent\.test\.ts|\d+ pass/);
  expect(sh(copy.dir, "git status --porcelain --untracked-files=all", env).out.trim()).toBe("");
}, 900_000);
