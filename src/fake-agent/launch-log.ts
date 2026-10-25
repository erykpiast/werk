import { appendFileSync, existsSync, readFileSync } from "node:fs";

export type LaunchRecord = {
  kind: "launch";
  role: string;
  args: string[];
  cwd: string;
};

export type MessageRecord = { kind: "message"; role: string; text: string };

/** The records sit beside the script, as one JSON object per line. */
export function logPathFor(scriptPath: string): string {
  return `${scriptPath}.launches.jsonl`;
}

export function appendRecord(
  logPath: string,
  record: LaunchRecord | MessageRecord,
): void {
  appendFileSync(logPath, `${JSON.stringify(record)}\n`);
}

export function readRecords(logPath: string): (LaunchRecord | MessageRecord)[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

/** How many launches of the role the log holds. */
export function countLaunches(logPath: string, role: string): number {
  return readRecords(logPath).filter(
    (r) => r.kind === "launch" && r.role === role,
  ).length;
}

/** How many messages the log holds for the role, over every launch of it. */
export function countMessages(logPath: string, role: string): number {
  return readRecords(logPath).filter(
    (r) => r.kind === "message" && r.role === role,
  ).length;
}
