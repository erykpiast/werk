// The command line at its own seam: the werk process, its output and its exit code (#werk-v0-seams).
import { expect, test } from "bun:test";
import { join } from "node:path";

function werk(entry: string, ...args: string[]) {
  const run = Bun.spawnSync([process.execPath, entry, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

const cli = join(import.meta.dir, "cli.ts");

test("werk help lists every registered verb", () => {
  const run = werk(cli, "help");
  expect(run.code).toBe(0);
  expect(run.out).toStartWith("Usage: werk <verb>");
  expect(run.out).toContain("  help\n");
});

test("an unknown verb prints the help and exits 2", () => {
  const run = werk(cli, "frobnicate");
  expect(run.code).toBe(2);
  expect(run.err).toStartWith("werk: unknown verb frobnicate\n");
  expect(run.err).toContain("  help\n");
});

test("the start-up ends before its verb, and the process exits with the verb's code", () => {
  const run = werk(join(import.meta.dir, "cli", "fixtures", "slow-entry.ts"), "slow");
  expect(run).toEqual({ code: 3, out: "start-up ended\nverb ended\n", err: "" });
});
