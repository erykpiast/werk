/**
 * The one runner that starts every pipeline agent as a child: the launch options of its role, a session
 * log of its stream, a wall-clock limit, a silence limit, and start and end events in the pipeline log
 * (#st-model-per-role, #st-build-seam-role-env, #ms-store, #ms-store-files).
 */
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LaunchOptions } from "../agent/launch-options.ts";
import { ROLE_VAR } from "../fake-agent/run.ts";
import { headlessArgs } from "../plan/agent-args.ts";
import { appendPipelineEvent, writeDetailFile } from "./log-store.ts";

export type Cost = {
  usd: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export const NO_COST: Cost = {
  usd: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export type AgentRun = {
  /** The step of the pipeline log: plan, spec, tickets. */
  step: string;
  /** The id that names this step's events and its session log. */
  id: string;
  prompt: string;
  /** The folder the agent starts in. */
  cwd: string;
  launch: LaunchOptions;
  tools: readonly string[];
  allow: readonly string[];
  env: Record<string, string | undefined>;
  /** The pipeline log. */
  pipelineLog: string;
  timeoutMs: number;
  silenceMs: number;
  /** Fields that join both events of the step, such as the plan. */
  fields?: Record<string, unknown>;
  /** Called with the session log name once the file exists, before the child starts. */
  onStarted?: (log: string) => void;
  /** An abort stops the child and fails the run. */
  signal?: AbortSignal;
};

export type AgentResult = {
  ok: boolean;
  /** Why the run failed. */
  reason?: string;
  /** The session log, relative to the folder of the pipeline log. */
  log: string;
  ms: number;
  cost: Cost;
  /** The text of the agent's final answer. Empty when the run sent no result. */
  text: string;
};

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** The cost of a run from its result event. */
export function costOf(result: Record<string, unknown>): Cost {
  const usage = (
    typeof result.usage === "object" && result.usage !== null
      ? result.usage
      : {}
  ) as Record<string, unknown>;
  return {
    usd: num(result.total_cost_usd),
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite: num(usage.cache_creation_input_tokens),
  };
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

export async function runAgent(run: AgentRun): Promise<AgentResult> {
  const started = Date.now();
  const log = writeDetailFile(run.pipelineLog, run.id, "jsonl", "");
  const logFile = join(dirname(run.pipelineLog), log);
  const event = (type: string, more: Record<string, unknown>) =>
    appendPipelineEvent(run.pipelineLog, {
      type,
      step: run.step,
      id: run.id,
      at: new Date().toISOString(),
      ...run.fields,
      ...more,
    });
  event("step.started", { role: run.launch.env[ROLE_VAR] });
  run.onStarted?.(log);

  let reason: string | undefined;
  let cost = NO_COST;
  let sawResult = false;
  let text = "";
  let lastEvent = Date.now();
  try {
    const child = Bun.spawn(
      [
        "claude",
        ...headlessArgs({
          options: run.launch,
          tools: run.tools,
          allow: run.allow,
        }),
      ],
      {
        cwd: run.cwd,
        env: { ...run.env, ...run.launch.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    child.stdin.write(run.prompt);
    void child.stdin.end();

    const stop = (why: string) => {
      reason ??= why;
      child.kill();
    };
    const onAbort = () => stop("the run was aborted");
    if (run.signal?.aborted) onAbort();
    else run.signal?.addEventListener("abort", onAbort, { once: true });
    const limit = setTimeout(
      () => stop(`the wall-clock limit of ${run.timeoutMs / 1000} s passed`),
      run.timeoutMs,
    );
    // The silence clock starts at the first event of the agent.
    let speaking = false;
    const watch = setInterval(() => {
      if (speaking && Date.now() - lastEvent > run.silenceMs) {
        stop(`no event for ${run.silenceMs / 1000} s`);
      }
    }, 250);

    const errors = new Response(child.stderr).text();
    let pending = "";
    const take = (line: string) => {
      const parsed = parseLine(line);
      if (parsed === null) return;
      speaking = true;
      lastEvent = Date.now();
      appendFileSync(
        logFile,
        `${JSON.stringify({ at: new Date().toISOString(), event: parsed })}\n`,
      );
      if (parsed.type === "result") {
        sawResult = true;
        cost = costOf(parsed);
        if (typeof parsed.result === "string") text = parsed.result;
        if (parsed.is_error === true) {
          reason ??= `the agent ended with an error result`;
        }
      }
    };
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() as string;
      for (const line of lines) take(line);
    }
    if (pending !== "") take(pending);
    const code = await child.exited;
    clearTimeout(limit);
    clearInterval(watch);
    run.signal?.removeEventListener("abort", onAbort);
    if (reason === undefined && code !== 0) {
      const text = (await errors).trim();
      reason = `the agent exited with code ${code}${text === "" ? "" : `: ${text}`}`;
    }
    if (reason === undefined && !sawResult)
      reason = "the agent ended with no result";
  } catch (error) {
    reason = `the agent could not start: ${error instanceof Error ? error.message : String(error)}`;
  }
  const ms = Date.now() - started;
  event("step.ended", {
    result: reason === undefined ? "green" : "red",
    ms,
    cost,
    file: log,
    ...(reason === undefined ? {} : { reason }),
  });
  return { ok: reason === undefined, reason, log, ms, cost, text };
}
