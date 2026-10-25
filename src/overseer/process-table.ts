/**
 * Reads the process table: the CPU time of the child processes of one agent, for the in-flight check
 * (#lp-overseer-inflight, #lp-overseer-psfail). Pure.
 */

export type Probe =
  | { ok: true; processes: number; cpuMs: number; pids: number[] }
  | { ok: false; why: string };

/** The CPU time of `ps` (`[dd-][hh:]mm:ss[.cc]`) in milliseconds, or null when it does not read. */
export function parseCpuTime(text: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(
    text.trim(),
  );
  if (match === null) return null;
  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds);
  return Math.round(total * 1000);
}

/**
 * The probe of the output of `ps -A -o pid=,ppid=,time=`: the pids, the number and the summed CPU time of every
 * descendant of `rootPid`, not the root itself. A table that holds no row, or a row that does not read,
 * is a failed read. A table without the root is a read that ran and found no process.
 */
export function childrenOf(table: string, rootPid: number): Probe {
  const rows = new Map<number, { parent: number; cpuMs: number }>();
  for (const line of table.split("\n")) {
    if (line.trim() === "") continue;
    const [pid, parent, time] = line.trim().split(/\s+/);
    const cpuMs = parseCpuTime(time ?? "");
    if (
      !/^\d+$/.test(pid ?? "") ||
      !/^\d+$/.test(parent ?? "") ||
      cpuMs === null
    )
      return {
        ok: false,
        why: `a row of the process table does not read: ${line.trim()}`,
      };
    rows.set(Number(pid), { parent: Number(parent), cpuMs });
  }
  if (rows.size === 0) return { ok: false, why: "the process table is empty" };
  const family = new Set([rootPid]);
  // A row can list a child before its parent, so grow the family until nothing joins it.
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, row] of rows) {
      if (!family.has(pid) && family.has(row.parent)) {
        family.add(pid);
        grew = true;
      }
    }
  }
  let cpuMs = 0;
  const pids: number[] = [];
  for (const pid of family) {
    if (pid === rootPid) continue;
    cpuMs += rows.get(pid)?.cpuMs ?? 0;
    pids.push(pid);
  }
  return { ok: true, processes: pids.length, cpuMs, pids };
}
