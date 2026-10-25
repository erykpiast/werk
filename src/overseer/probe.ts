/** The process probe of a running agent: its child processes and their CPU time, read with ps (#lp-overseer-mechanics). */
import { runProcess } from "../build/run-process.ts";
import { childrenOf, type Probe } from "./process-table.ts";

const PS_MS = 5000;

export async function probeChildren(pid: number): Promise<Probe> {
  const run = await runProcess({
    argv: ["ps", "-A", "-o", "pid=,ppid=,time="],
    cwd: ".",
    env: { PATH: process.env.PATH },
    timeoutMs: PS_MS,
  });
  if (run.spawnError !== undefined)
    return { ok: false, why: `ps could not start: ${run.spawnError}` };
  if (run.exitCode !== 0)
    return {
      ok: false,
      why: `ps ended with ${run.timedOut ? "a time out" : `code ${run.exitCode}`}`,
    };
  return childrenOf(run.stdout, pid);
}
