/**
 * The pipeline fold: a pure function from the events of the pipeline log to what the builder
 * loop reads. See #ms-store. Every measure is a fold over the log, and none is stored.
 * An event that breaks a rule is set aside as a problem, and the events after it still fold.
 */
import type { LogEntry } from "../map/fold.ts";

export const STEPS = [
  "plan",
  "pass",
  "check",
  "grader",
  "reviewer",
  "merge",
  "heldout",
] as const;
export type Step = (typeof STEPS)[number];

/** The cause names of #ms-fail. */
export const CAUSES = [
  "builder-error",
  "test-is-wrong",
  "spec-gap",
  "false-finding",
  "check-infrastructure",
  "flaky",
  "conflict",
] as const;
export type Cause = (typeof CAUSES)[number];

/** A failed pass with one of these causes costs the ticket no retry (#st-build-cap-spec-gap, #st-build-conflict). */
const FREE_CAUSES: readonly Cause[] = ["spec-gap", "conflict"];

export type Result = "green" | "red";

export type PipelineProblem = { line: number; detail: string };

export type Pass = {
  n: number;
  result: Result | "running";
  /** The gate that failed the pass. */
  gate?: string;
  cause?: Cause;
  reason?: string;
  /** The file that holds the full output of the failed check. */
  file?: string;
  /** Checks that failed and then passed on a rerun, on a green pass too (#ms-fail-cause). */
  flaky: string[];
  /** The transcript of the builder session, relative to the folder of the log (#ms-store-files). */
  transcript?: string;
  /** The ticket was archived during the pass. Such a pass costs no retry (#werk-board-control-archive-ends-build). */
  archived: boolean;
  /** Whether the pass counts toward the retry cap. */
  counted: boolean;
};

export type LastFailure = {
  pass: number;
  gate?: string;
  cause?: Cause;
  reason?: string;
  file?: string;
};

export type Build = {
  id: string;
  ticket?: string;
  passes: Pass[];
  /** Failed passes that count toward the retry cap. */
  counted: number;
  last?: LastFailure;
};

export type Pipeline = {
  builds: Map<string, Build>;
  problems: PipelineProblem[];
};

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (rec: Rec, key: string): string | undefined => {
  const value = rec[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};
const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown,
): T | undefined => list.find((item) => item === value);

/** The reason an event is not a pipeline event, or null when it is one. */
export function checkPipelineEvent(event: unknown): string | null {
  if (!isRecord(event)) return "event is not an object";
  const type = event.type;
  if (type !== "step.started" && type !== "step.ended")
    return "type must be step.started or step.ended";
  if (oneOf(STEPS, event.step) === undefined)
    return `step must be one of ${STEPS.join(", ")}`;
  if (str(event, "id") === undefined) return "event needs id";
  if (str(event, "at") === undefined) return "event needs at";
  if (event.step !== "plan" && str(event, "build") === undefined)
    return "a build step needs build";
  if (event.step !== "plan" && !Number.isInteger(event.pass))
    return "a build step needs the number of its pass";
  if (event.cause !== undefined && oneOf(CAUSES, event.cause) === undefined)
    return `cause must be one of ${CAUSES.join(", ")}`;
  if (type === "step.ended") {
    if (oneOf(["green", "red"], event.result) === undefined)
      return "an ended step needs the result green or red";
    if (typeof event.ms !== "number") return "an ended step needs ms";
    if (!isRecord(event.cost)) return "an ended step needs cost";
  }
  return null;
}

function buildOf(pipeline: Pipeline, rec: Rec): Build {
  const id = str(rec, "build") as string;
  let build = pipeline.builds.get(id);
  if (!build) {
    build = { id, passes: [], counted: 0 };
    pipeline.builds.set(id, build);
  }
  const ticket = str(rec, "ticket");
  if (ticket !== undefined) build.ticket = ticket;
  return build;
}

function passOf(build: Build, n: number): Pass {
  let pass = build.passes.find((p) => p.n === n);
  if (!pass) {
    pass = { n, result: "running", flaky: [], archived: false, counted: false };
    build.passes.push(pass);
    build.passes.sort((a, b) => a.n - b.n);
  }
  return pass;
}

/** A red step names the gate and the cause of its pass. The first red step of a pass names the gate. */
function failStep(pass: Pass, rec: Rec): void {
  if (pass.gate === undefined) {
    pass.gate = str(rec, "gate") ?? str(rec, "step");
    pass.file = str(rec, "file");
  }
  const cause = oneOf(CAUSES, rec.cause);
  // A cause that the check run set comes before a cause that the next pass names.
  if (cause !== undefined && pass.cause === undefined) pass.cause = cause;
  pass.reason ??= str(rec, "reason");
}

function applyEnded(build: Build, rec: Rec): void {
  const pass = passOf(build, rec.pass as number);
  if (rec.archived === true) pass.archived = true;
  if (rec.step === "pass") {
    pass.transcript = str(rec, "transcript") ?? pass.transcript;
    if (pass.archived) {
      pass.result = "red";
      return;
    }
    pass.result = rec.result as Result;
    if (pass.result === "red") failStep(pass, rec);
    return;
  }
  if (rec.result === "red" && rec.archived !== true) {
    failStep(pass, rec);
    return;
  }
  if (rec.cause === "flaky") pass.flaky.push(str(rec, "gate") ?? "check");
}

/** The next pass names the cause of the last failure at its start (#ms-fail-cause). */
function applyStarted(build: Build, rec: Rec): void {
  const pass = passOf(build, rec.pass as number);
  if (rec.step !== "pass") return;
  const cause = oneOf(CAUSES, rec.cause);
  if (cause === undefined) return;
  const before = [...build.passes]
    .reverse()
    .find((p) => p.n < pass.n && p.result === "red");
  if (before && before.cause === undefined) {
    before.cause = cause;
    before.reason ??= str(rec, "reason");
  }
}

function settle(build: Build): void {
  for (const pass of build.passes) {
    pass.counted =
      pass.result === "red" &&
      !pass.archived &&
      !FREE_CAUSES.some((cause) => cause === pass.cause);
  }
  build.counted = build.passes.filter((p) => p.counted).length;
  const red = [...build.passes]
    .reverse()
    .find((p) => p.result === "red" && !p.archived);
  if (red) {
    build.last = {
      pass: red.n,
      gate: red.gate,
      cause: red.cause,
      reason: red.reason,
      file: red.file,
    };
  }
}

export function foldPipeline(entries: LogEntry[]): Pipeline {
  const pipeline: Pipeline = { builds: new Map(), problems: [] };
  for (const entry of entries) {
    const problem =
      entry.error !== undefined
        ? `not JSON: ${entry.error}`
        : checkPipelineEvent(entry.event);
    if (problem !== null) {
      pipeline.problems.push({ line: entry.line, detail: problem });
      continue;
    }
    const rec = entry.event as Rec;
    if (rec.step === "plan") continue;
    const build = buildOf(pipeline, rec);
    if (rec.type === "step.started") applyStarted(build, rec);
    else applyEnded(build, rec);
  }
  for (const build of pipeline.builds.values()) settle(build);
  return pipeline;
}
