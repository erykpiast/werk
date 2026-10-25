/**
 * The builder loop of one ticket: a worktree off the main line's tip, a fresh agent per pass, the
 * checks as the verdict, and a hand-off by how the build ends (#st-build-ticket, #st-build-implement,
 * #lp-stateless, #st-build-ticket-hand-off, #werk-board-control-archive-ends-build).
 */
import { dirname, join, resolve } from "node:path";
import { buildLaunchOptions } from "../agent/launch-options.ts";
import {
  appendBoardEvent,
  boardLogBeside,
  readBoard,
} from "../board/log-store.ts";
import { resolveTicket } from "../board/resolve.ts";
import { buildRuleTitles } from "../chat/build-rules.ts";
import { ALLOWED_TOOLS, launchFlags } from "../chat/child-args.ts";
import { appendEvents, readMap } from "../map/log-store.ts";
import { classifier } from "../overseer/classifier.ts";
import { selfCommandLine } from "../own/own.ts";
import type { Cause } from "../pipeline/fold.ts";
import { pipelineLogBeside, writeDetailFile } from "../pipeline/log-store.ts";
import { buildBrief, tailOf } from "./brief.ts";
import { checkName, judgeCheck } from "./checks.ts";
import { gatherTicket, ticketPath } from "./gather.ts";
import {
  addWorktree,
  commitPass,
  releaseBranch,
  removeWorktree,
  type Worktree,
} from "./git.ts";
import { createRecorder, type Recorder } from "./recorder.ts";
import { type ProcessResult, runProcess } from "./run-process.ts";
import { costOf } from "./stream-cost.ts";
import { watchAgent } from "./watch-agent.ts";

const REPO = join(import.meta.dirname, "..", "..");

export type BuildOptions = {
  /** The ticket, as a number or <plan run>/<NN>. */
  ticket: string;
  cwd: string;
  env: Record<string, string | undefined>;
  /** The branch that the worktree starts from. */
  mainLine: string;
  /** The most passes of this build. */
  cap: number;
  /** The wall-clock limit of one builder session, in milliseconds. */
  agentMs: number;
  /** The wall-clock limit of one check, in milliseconds. */
  checkMs: number;
  /** The overseer's limits, in milliseconds (#lp-overseer). */
  silenceMs: number;
  flatMs: number;
  progressMs: number;
  /** The wait for one classifier answer. */
  classifyMs: number;
  /** The time between two reads of the board, in milliseconds. */
  pollMs: number;
  /** The text of the spec that holds the stories, or null. */
  spec: string | null;
  /** The agent program. */
  command: string;
  /** A fresh pass after a build process died: the build it continues and the pass that died (#st-build-died). */
  resume?: { buildId: string; afterPass: number; failure: string };
};

export type BuildResult = {
  outcome: "merging" | "ready" | "archived";
  passes: number;
  branch: string;
  reason?: string;
};

/** A build that cannot start. Nothing was written. */
export class BuildRefused extends Error {}

type PassFailure = {
  gate: string;
  reason: string;
  cause?: Cause;
  /** What the next pass reads. */
  text: string;
  file?: string;
};

type PassVerdict =
  | { kind: "green"; flaky: string[] }
  | { kind: "red"; failure: PassFailure }
  | { kind: "archived" };

/** Reads the board about once for each `pollMs`. An archive of the ticket aborts the signal. */
function watchArchive(boardLog: string, ticket: string, pollMs: number) {
  const control = new AbortController();
  const timer = setInterval(() => {
    if (readBoard(boardLog).tickets.get(ticket)?.archived) control.abort();
  }, pollMs);
  return { signal: control.signal, stop: () => clearInterval(timer) };
}

const agentArgs = (options: ReturnType<typeof buildLaunchOptions>) => [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  // The overseer answers each ask on stdin, and the partial messages keep its silence clock armed.
  "--include-partial-messages",
  "--permission-prompt-tool",
  "stdio",
  "--permission-mode",
  "auto",
  "--allowedTools",
  [...ALLOWED_TOOLS, "Bash(make:*)", "Bash(git:*)"].join(","),
  ...launchFlags(options),
];

type Run = {
  options: BuildOptions;
  tree: Worktree;
  recorder: Recorder;
  pipelineLog: string;
  boardLog: string;
  /** The ticket id, which is also the branch name. */
  ticket: string;
  buildId: string;
  signal: AbortSignal;
  /** The text of the ticket, which the classifier reads with each ask. */
  ticketText: string;
  classify: (prompt: string) => Promise<string | null>;
};

const judge = (result: ProcessResult) =>
  judgeCheck({
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    spawnError: result.spawnError,
    output: `${result.stdout}${result.stderr}`,
  });

async function runChecks(
  run: Run,
  n: number,
  commands: readonly string[],
): Promise<PassVerdict> {
  const flaky: string[] = [];
  const once = (command: string) =>
    runProcess({
      argv: command.split(" "),
      cwd: run.tree.dir,
      env: run.options.env,
      timeoutMs: run.options.checkMs,
      signal: run.signal,
    });
  for (const command of commands) {
    const name = checkName(command);
    const end = run.recorder.start(n, "check", name);
    let result = await once(command);
    if (result.aborted) {
      end("red", {
        gate: name,
        reason: "the ticket was archived",
        archived: true,
      });
      return { kind: "archived" };
    }
    let verdict = judge(result);
    let reran = false;
    if (verdict.kind === "red") {
      // The same check on the same commit: green means flaky (#ms-fail-cause).
      reran = true;
      result = await once(command);
      if (result.aborted) {
        end("red", {
          gate: name,
          reason: "the ticket was archived",
          archived: true,
        });
        return { kind: "archived" };
      }
      verdict = judge(result);
    }
    if (verdict.kind === "green") {
      if (reran) {
        flaky.push(name);
        end("green", { gate: name, cause: "flaky" });
      } else end("green");
      continue;
    }
    const output = `${result.stdout}${result.stderr}`;
    const file = writeDetailFile(
      run.pipelineLog,
      `${run.buildId}:p${n}:${name}`,
      "txt",
      output,
    );
    const cause = verdict.kind === "infra" ? "check-infrastructure" : undefined;
    end("red", { gate: name, reason: verdict.reason, cause, file });
    return {
      kind: "red",
      failure: {
        gate: name,
        reason: verdict.reason,
        cause,
        file,
        text: `$ ${command}\n(${verdict.reason}${reran ? ", also on the rerun" : ""})\n${tailOf(output)}`,
      },
    };
  }
  return { kind: "green", flaky };
}

/** One pass: the agent, the commit, the checks. Returns the verdict of the pass. */
async function runPass(
  run: Run,
  n: number,
  brief: string,
  commands: readonly string[],
  launch: ReturnType<typeof buildLaunchOptions>,
): Promise<PassVerdict> {
  const { options, tree, recorder, pipelineLog, boardLog, ticket, buildId } =
    run;
  const endPass = recorder.start(n, "pass", "pass");
  const session = `${buildId}:p${n}`;
  const name = writeDetailFile(pipelineLog, `${session}:agent`, "jsonl", "");
  const transcript = join(dirname(pipelineLog), name);
  appendBoardEvent(boardLog, {
    type: "build.started",
    id: ticket,
    session,
    pid: process.pid,
    log: transcript,
    cap: options.cap,
    branch: tree.branch,
  });
  const watch = watchAgent({
    limits: {
      silenceMs: options.silenceMs,
      flatMs: options.flatMs,
      progressMs: options.progressMs,
      sampleMs: Math.min(5000, Math.max(50, options.flatMs / 4)),
    },
    context: { brief, ticket: run.ticketText, asks: true },
    transcript,
    classify: run.classify,
  });
  const agent = await runProcess({
    argv: [options.command, ...agentArgs(launch)],
    cwd: tree.dir,
    env: { ...options.env, ...launch.env },
    stdin: `${JSON.stringify({ type: "user", message: { role: "user", content: brief } })}\n`,
    keepStdin: true,
    timeoutMs: options.agentMs,
    signal: run.signal,
    control: watch.control,
    onStdout: watch.onStdout,
  });
  watch.end();
  const cost = costOf(agent.stdout);
  appendBoardEvent(boardLog, {
    type: "build.ended",
    id: ticket,
    session,
    result: agent.aborted ? "archived" : "ended",
  });
  if (agent.aborted) {
    endPass("red", {
      cost,
      transcript: name,
      reason: "the ticket was archived",
      archived: true,
    });
    return { kind: "archived" };
  }
  commitPass(tree.dir, options.env, n);
  const finish = (verdict: PassVerdict): PassVerdict => {
    if (verdict.kind === "green") {
      endPass("green", { cost, transcript: name });
    } else if (verdict.kind === "red") {
      const { gate, reason, cause, file } = verdict.failure;
      endPass("red", { cost, transcript: name, gate, reason, cause, file });
    } else
      endPass("red", {
        cost,
        transcript: name,
        reason: "the ticket was archived",
        archived: true,
      });
    return verdict;
  };
  const broken =
    agent.spawnError !== undefined
      ? `the builder could not start: ${agent.spawnError}`
      : agent.stopped !== undefined
        ? `The overseer cancelled the last pass: ${agent.stopped}`
        : agent.timedOut
          ? `the builder session ran past its time limit of ${options.agentMs} ms`
          : null;
  if (broken !== null) {
    // A broken session still commits its edits, skips the checks and counts against the cap.
    const gate = agent.stopped === undefined ? "builder" : "overseer";
    return finish({
      kind: "red",
      failure: { gate, reason: broken, text: broken },
    });
  }
  return finish(await runChecks(run, n, commands));
}

export async function buildTicket(options: BuildOptions): Promise<BuildResult> {
  const { cwd, env } = options;
  const mapLog = env.WERK_LOG ?? join(cwd, ".werk", "log.jsonl");
  const boardLog = boardLogBeside(mapLog);
  const pipelineLog = pipelineLogBeside(mapLog);

  const found = resolveTicket(readBoard(boardLog), options.ticket);
  if (!found.ok) throw new BuildRefused(found.error);
  const ticket = readBoard(boardLog).tickets.get(found.id);
  if (ticket === undefined) throw new BuildRefused(`no ticket ${found.id}`);
  if (ticket.archived)
    throw new BuildRefused(`ticket ${ticket.id} is archived`);
  const { resume } = options;
  if (
    resume !== undefined
      ? ticket.column !== "building"
      : ticket.column !== "ready"
  )
    throw new BuildRefused(
      `ticket ${ticket.id} is in ${ticket.column}, not in ${resume !== undefined ? "building" : "ready"}`,
    );
  const { map } = readMap(mapLog);
  const input = gatherTicket(
    ticketPath(mapLog, ticket.plan, ticket.number),
    map,
    options.spec,
  );
  if (input === null)
    throw new BuildRefused(
      `ticket ${ticket.id} has no readable ticket file under ${dirname(ticketPath(mapLog, ticket.plan, ticket.number))}`,
    );

  // The dead pass's worktree still holds the branch: its uncommitted edits are lost.
  if (resume !== undefined) releaseBranch(resolve(cwd), env, ticket.id);
  const tree = addWorktree(resolve(cwd), env, ticket.id, options.mainLine);
  const moved =
    resume !== undefined
      ? { ok: true as const }
      : appendBoardEvent(boardLog, {
          type: "ticket.moved",
          id: ticket.id,
          to: "building",
          actor: "loop",
        });
  if (!moved.ok) {
    removeWorktree(cwd, env, tree);
    throw new BuildRefused(
      `${moved.violation.rule}: ${moved.violation.detail}`,
    );
  }
  const buildId =
    resume?.buildId ?? `build-${ticket.id.replace("/", "-")}-${Date.now()}`;
  // A fresh pass after a death keeps the obligation that the dead pass opened.
  if (resume === undefined) {
    appendEvents(mapLog, [
      {
        type: "obligation.opened",
        id: buildId,
        ticket: ticket.id,
        cites: input.cards.map((card) => card.id),
      },
    ]);
  }

  const watch = watchArchive(boardLog, ticket.id, options.pollMs);
  const run: Run = {
    options,
    tree,
    recorder: createRecorder(pipelineLog, buildId, ticket.id),
    pipelineLog,
    boardLog,
    ticket: ticket.id,
    buildId,
    signal: watch.signal,
    ticketText: input.ticket,
    classify: classifier({
      command: options.command,
      cwd: tree.dir,
      env: env,
      launch: buildLaunchOptions({
        role: "classifier",
        werk: selfCommandLine(),
        projectIsWerk: resolve(cwd) === REPO,
        buildRuleTitles: [],
      }),
      timeoutMs: options.classifyMs,
    }),
  };
  const launch = buildLaunchOptions({
    role: "builder",
    werk: selfCommandLine(),
    projectIsWerk: resolve(cwd) === REPO,
    buildRuleTitles: buildRuleTitles(map),
  });
  const result = (
    outcome: BuildResult["outcome"],
    passes: number,
    reason?: string,
  ): BuildResult => ({
    outcome,
    passes,
    branch: tree.branch,
    ...(reason === undefined ? {} : { reason }),
  });
  try {
    let failure: string | null = resume?.failure ?? null;
    for (let n = (resume?.afterPass ?? 0) + 1; n <= options.cap; n++) {
      const brief = buildBrief({
        ...input,
        obligation: buildId,
        pass: n,
        base: tree.base,
        failure,
      });
      const verdict = await runPass(run, n, brief, input.checks, launch);
      if (verdict.kind === "archived" || watch.signal.aborted)
        return result("archived", n);
      appendBoardEvent(boardLog, {
        type: "ticket.pass",
        id: ticket.id,
        n,
        result: verdict.kind,
      });
      if (verdict.kind === "green") {
        const to = appendBoardEvent(boardLog, {
          type: "ticket.moved",
          id: ticket.id,
          to: "merging",
          actor: "loop",
        });
        if (!to.ok) return result("archived", n);
        return result("merging", n);
      }
      failure = verdict.failure.text;
    }
    const reason = `red at the retry cap of ${options.cap}`;
    appendBoardEvent(boardLog, {
      type: "ticket.moved",
      id: ticket.id,
      to: "ready",
      actor: "loop",
      reason,
    });
    return result("ready", options.cap, reason);
  } catch (error) {
    // A build that breaks leaves no live session, so its ticket leaves building.
    appendBoardEvent(boardLog, {
      type: "ticket.moved",
      id: ticket.id,
      to: "ready",
      actor: "loop",
      reason: `the build broke: ${(error as Error).message}`,
    });
    throw error;
  } finally {
    watch.stop();
    removeWorktree(cwd, env, tree);
  }
}
