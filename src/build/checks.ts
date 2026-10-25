/**
 * The checks of a ticket and the verdict of one run of a check (#lp-checks, #lp-checks-scripts,
 * #ms-fail-cause). Pure.
 */
import { sectionOf, type Ticket } from "../tickets/ticket-parse.ts";

/** The checks of a ticket whose Checks section has no bullet (#st-ticket-own-checks). */
export const DEFAULT_CHECKS: readonly string[] = [
  "make test",
  "make typecheck",
  "make lint",
];

const BULLET = /^\s*-\s+`?(make\s+[^\s`]+)`?\s*$/;

/** The check commands of the ticket, in order. An empty section gives the defaults. */
export function checksOf(ticket: Ticket): string[] {
  const section = sectionOf(ticket, "Checks");
  const found = (section?.body ?? [])
    .map((line) => BULLET.exec(line.text)?.[1])
    .filter((command): command is string => command !== undefined)
    .map((command) => command.replace(/\s+/g, " "));
  return found.length > 0 ? found : [...DEFAULT_CHECKS];
}

/** What one run of a check reports before it is judged. */
export type CheckRun = {
  exitCode: number | null;
  timedOut: boolean;
  /** The text of the error when the command could not start. */
  spawnError?: string;
  /** What the check wrote. A make target that runs a missing tool says so here. */
  output?: string;
};

export type Verdict =
  | { kind: "green" }
  | { kind: "red"; reason: string }
  | { kind: "infra"; reason: string };

/** The shell code for a command that is not found. */
const NOT_FOUND = 127;
/** How make reports a recipe line that ended with that code. */
const MAKE_NOT_FOUND = /\*\*\* \[[^\]]*\] Error 127\b/;

/**
 * Green on exit 0. A crash, a timeout or a missing tool is check infrastructure and is not
 * run again. Any other exit is a red check.
 */
export function judgeCheck(run: CheckRun): Verdict {
  if (run.spawnError !== undefined)
    return { kind: "infra", reason: `missing tool: ${run.spawnError}` };
  if (run.timedOut)
    return { kind: "infra", reason: "the check ran past its time limit" };
  if (run.exitCode === null)
    return { kind: "infra", reason: "the check crashed on a signal" };
  if (run.exitCode === NOT_FOUND || MAKE_NOT_FOUND.test(run.output ?? ""))
    return { kind: "infra", reason: "missing tool: command not found" };
  if (run.exitCode === 0) return { kind: "green" };
  return { kind: "red", reason: `exit code ${run.exitCode}` };
}

/** The name of a check as the pipeline log writes it: the make target. */
export function checkName(command: string): string {
  return command.replace(/^make\s+/, "");
}
