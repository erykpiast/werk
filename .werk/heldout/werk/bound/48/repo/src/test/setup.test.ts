// The run's preload at its seam: what a test and the processes it starts see (#werk-test-env).
import { expect, test } from "bun:test";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { join } from "node:path";

const fake = join(import.meta.dir, "fake-bin", "claude");
// Names only, so a failure never prints the value of a secret.
const probe = "command -v claude; env | cut -d= -f1";

test("no variable that points at a real project is left in the test process", () => {
  expect(Object.keys(process.env).filter((name) => name.startsWith("WERK_"))).toEqual([]);
});

test("Bun's program lookup finds the fake agent", () => {
  expect(Bun.which("claude")).toBe(fake);
});

test("a child started with no explicit environment finds the fake agent, by every way Bun starts one", async () => {
  const sync = Bun.spawnSync(["sh", "-c", probe], { stdout: "pipe" }).stdout.toString();
  const proc = Bun.spawn({ cmd: ["sh", "-c", probe], stdout: "pipe" });
  const async = await new Response(proc.stdout).text();
  const shell = await Bun.$`sh -c ${probe}`.text();
  const node = nodeSpawnSync("sh", ["-c", probe]).stdout.toString();
  for (const out of [sync, async, shell, node]) {
    expect(out).toStartWith(`${fake}\n`);
    expect(out).not.toMatch(/^WERK_/m);
  }
});

test("the fake agent started with no script exits with an error", () => {
  const run = Bun.spawnSync(["claude", "-p", "hello"], { stdout: "pipe", stderr: "pipe" });
  expect(run.exitCode).toBe(1);
  expect(run.stderr.toString()).toStartWith("fake agent: no script installed");
});

test("a variable of the shell that starts the run does not reach a test's children", () => {
  const run = Bun.spawnSync([process.execPath, "test", join(import.meta.dir, "fixtures", "env-probe.ts")], {
    cwd: join(import.meta.dir, "..", ".."),
    env: { ...process.env, WERK_LOG: "/real/.werk/log.jsonl", PATH: `/usr/bin:/bin:${process.env.PATH}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = run.stdout.toString() + run.stderr.toString();
  expect(run.exitCode).toBe(0);
  expect(output).toContain(`PROBE ${fake} WERK_LOG= `);
});
