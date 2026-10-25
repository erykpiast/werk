/**
 * Starts one judge agent, the grader or a reviewer, with the fixed read-only tool list. The runtime
 * refuses every other tool call at once, so no ask reaches the overseer (#lp-prod-judge-read-only).
 */
import type { LaunchOptions } from "../agent/launch-options.ts";
import { type AgentResult, runAgent } from "../pipeline/agent-runner.ts";

/** The tools a judge has: read a file, search text, find files, and Bash for the git rules below. */
export const JUDGE_TOOLS: readonly string[] = ["Read", "Grep", "Glob", "Bash"];

/** The calls that pass with no ask: the three reads, and the git operations that show history. */
export const JUDGE_ALLOW: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
];

export type JudgeRun = {
  /** The id that names the step's events and session log. */
  id: string;
  /** The step of the pipeline log: grader or reviewer. */
  step: "grader" | "reviewer";
  prompt: string;
  /** The worktree of the pass. */
  cwd: string;
  launch: LaunchOptions;
  env: Record<string, string | undefined>;
  pipelineLog: string;
  /** Joins both events of the step to its build and pass. */
  fields: { build: string; ticket: string; pass: number };
  timeoutMs: number;
  silenceMs: number;
  signal: AbortSignal;
};

export function runJudge(run: JudgeRun): Promise<AgentResult> {
  return runAgent({
    step: run.step,
    id: run.id,
    prompt: run.prompt,
    cwd: run.cwd,
    launch: run.launch,
    tools: JUDGE_TOOLS,
    allow: JUDGE_ALLOW,
    env: run.env,
    pipelineLog: run.pipelineLog,
    timeoutMs: run.timeoutMs,
    silenceMs: run.silenceMs,
    fields: run.fields,
    signal: run.signal,
  });
}
