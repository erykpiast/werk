/**
 * The plan: a decided subtree becomes one spec and checked tickets, and every answer that no card gives
 * becomes a ghost card under the subtree root (#st-spec, #st-spec-linked, #st-spec-answers, #st-ticket-partial).
 * The files go to werk's store for the project, never to the target repository (#st-build-target).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildLaunchOptions } from "../agent/launch-options.ts";
import {
  appendBoardEvent,
  boardLogBeside,
  readBoard,
} from "../board/log-store.ts";
import { buildRuleTitles } from "../chat/build-rules.ts";
import { renderCard } from "../map/card-text.ts";
import { parseLog } from "../map/fold.ts";
import { appendEvents, readMap } from "../map/log-store.ts";
import { selfCommandLine } from "../own/own.ts";
import { type Cost, NO_COST, runAgent } from "../pipeline/agent-runner.ts";
import {
  appendPipelineEvent,
  pipelineLogBeside,
} from "../pipeline/log-store.ts";
import { checkTickets, formatVerdict } from "../tickets/check-folder.ts";
import { decidedUnder } from "../tickets/decided-cards.ts";
import { storiesOf } from "../tickets/spec-stories.ts";
import { parseAnswers, proposalEvent } from "./answers.ts";
import { type PlanPaths, specPrompt, ticketPrompt } from "./prompts.ts";
import { lastChanges, planScope } from "./scope.ts";
import { planTickets } from "./ticket-events.ts";

const REPO = join(import.meta.dirname, "..", "..");
const WRITER_TOOLS = ["Read", "Grep", "Glob", "Write"] as const;

export type PlanInput = {
  /** The id of the subtree root. */
  root: string;
  cwd: string;
  /** The map log of the project. Its folder is werk's store. */
  logPath: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  silenceMs: number;
  out: (text: string) => void;
  err: (text: string) => void;
};

/** An absolute path as a tool rule names it: a leading double slash. */
const ruleFor = (tool: string, path: string): string =>
  `${tool}(/${resolve(path)})`;

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Runs the plan. Returns the exit code: 0 when every check passed, 1 when the plan stopped or a check failed. */
export async function runPlan(input: PlanInput): Promise<number> {
  const { root, logPath, out, err } = input;
  const store = dirname(logPath);
  const boardLog = boardLogBeside(logPath);
  const pipelineLog = pipelineLogBeside(logPath);
  const board = (event: Record<string, unknown>) => {
    const result = appendBoardEvent(boardLog, { plan: root, ...event });
    if (!result.ok)
      err(
        `werk: the board refused ${String(event.type)}: ${result.violation.detail}`,
      );
  };

  const { map } = readMap(logPath);
  const node = map.nodes.get(root);
  if (node?.kind !== "card" || node.proposed) {
    err(`werk: refused: no card "${root}" in the map`);
    return 1;
  }
  const onBoard = readBoard(boardLog);
  const held = (onBoard.plans.get(root)?.tickets ?? []).filter(
    (id) => onBoard.tickets.get(id)?.archived === false,
  );
  if (held.length > 0) {
    err(
      `werk: refused: ${root} has ${held.length} ticket(s) on the board. Archive them before a new plan.`,
    );
    return 1;
  }

  const scope = planScope(map, root);
  const planId = `plan-${root}-${Date.now()}`;
  const planStart = Date.now();
  const planCost: Cost[] = [];
  const endPlan = (result: string, reason?: string): number => {
    appendPipelineEvent(pipelineLog, {
      type: "step.ended",
      step: "plan",
      id: planId,
      at: new Date().toISOString(),
      plan: root,
      result: result === "ok" ? "green" : "red",
      ms: Date.now() - planStart,
      cost: planCost.reduce(
        (sum, c) => ({
          usd: sum.usd + c.usd,
          input: sum.input + c.input,
          output: sum.output + c.output,
          cacheRead: sum.cacheRead + c.cacheRead,
          cacheWrite: sum.cacheWrite + c.cacheWrite,
        }),
        NO_COST,
      ),
      ...(reason === undefined ? {} : { reason }),
    });
    board({
      type: "plan.ended",
      result,
      ...(reason === undefined ? {} : { reason }),
    });
    if (reason !== undefined) err(`werk: plan ${result}: ${reason}`);
    return result === "ok" ? 0 : 1;
  };

  const text = (id: string) => renderCard(map, id) ?? id;
  const scopeText = {
    first: scope.first.map(text),
    second: scope.second.map(text),
  };
  const entries = parseLog(readText(logPath) ?? "");
  const all = [...scope.first, ...scope.second];
  const positions = lastChanges(entries, all);
  appendPipelineEvent(pipelineLog, {
    type: "step.started",
    step: "plan",
    id: planId,
    at: new Date().toISOString(),
    plan: root,
    scope: [
      ...scope.first.map((id) => ({ id, tier: 1, at: positions[id] ?? 0 })),
      ...scope.second.map((id) => ({ id, tier: 2, at: positions[id] ?? 0 })),
    ],
    cards: { first: scope.first.length, second: scope.second.length },
    chars: [...scopeText.first, ...scopeText.second].join("").length,
  });
  board({ type: "plan.started", pid: process.pid });

  if (scope.stops.length > 0) {
    return endPlan(
      "stopped",
      `the first tier holds ${scope.stops.map((s) => `#${s.id} (${s.reason})`).join(", ")}; decide or postpone them`,
    );
  }

  const specDir = join(store, "specs", root);
  const ticketsDir = join(store, "tickets", root);
  rmSync(specDir, { recursive: true, force: true });
  rmSync(ticketsDir, { recursive: true, force: true });
  mkdirSync(specDir, { recursive: true });
  mkdirSync(ticketsDir, { recursive: true });
  const paths: PlanPaths = {
    spec: join(specDir, "spec.md"),
    specAnswers: join(specDir, "spec-answers.json"),
    ticketAnswers: join(specDir, "ticket-answers.json"),
    ticketsDir,
  };

  const titles = buildRuleTitles(map);
  const writer = async (
    role: "spec-writer" | "ticket-writer",
    step: "spec" | "tickets",
    prompt: string,
    writes: string[],
  ): Promise<string | null> => {
    const result = await runAgent({
      step,
      id: `${planId}-${step}`,
      prompt,
      cwd: store,
      launch: buildLaunchOptions({
        role,
        werk: selfCommandLine(),
        projectIsWerk: resolve(input.cwd) === REPO,
        buildRuleTitles: titles,
      }),
      tools: WRITER_TOOLS,
      allow: [
        "Read",
        "Grep",
        "Glob",
        ...writes.map((w) => ruleFor("Write", w)),
      ],
      env: { ...input.env, WERK_LOG: logPath },
      pipelineLog,
      timeoutMs: input.timeoutMs,
      silenceMs: input.silenceMs,
      fields: { plan: root },
      onStarted: (log) => board({ type: "plan.step", step: role, log }),
    });
    planCost.push(result.cost);
    if (!result.ok) return `the ${role} failed: ${result.reason}`;
    return null;
  };

  /** Reads the answers file of a writer and proposes each answer as a ghost. */
  const propose = (role: string, file: string): string | null => {
    const raw = readText(file);
    if (raw === null)
      return `the ${role} wrote no answers file (an empty list says there are none)`;
    const parsed = parseAnswers(raw);
    if (!parsed.ok) return `the ${role}'s answers file is bad: ${parsed.error}`;
    for (const answer of parsed.answers) {
      const result = appendEvents(logPath, [proposalEvent(root, answer)]);
      if (!result.ok)
        return `the ${role}'s answer "${answer.slug}" cannot be proposed: ${result.violation.rule}: ${result.violation.detail}`;
      out(`proposed #${root}-${answer.slug}`);
    }
    return null;
  };

  let failure = await writer(
    "spec-writer",
    "spec",
    specPrompt(root, scopeText, paths),
    [paths.spec, paths.specAnswers],
  );
  if (failure !== null) return endPlan("failed", failure);
  const specText = readText(paths.spec);
  const stories = specText === null ? null : storiesOf(specText);
  if (stories === null || stories.length === 0)
    return endPlan(
      "failed",
      "the spec is invalid: it needs a User stories heading and at least one numbered story",
    );
  failure = propose("spec-writer", paths.specAnswers);
  if (failure !== null) return endPlan("failed", failure);

  failure = await writer(
    "ticket-writer",
    "tickets",
    ticketPrompt(root, scopeText, paths),
    [paths.ticketAnswers, join(ticketsDir, "*")],
  );
  if (failure !== null) return endPlan("failed", failure);
  failure = propose("ticket-writer", paths.ticketAnswers);
  if (failure !== null) return endPlan("failed", failure);

  // The checks read the map again: the answers are ghosts now, and a ghost counts as no decided card.
  const files = readdirSync(ticketsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({
      name,
      text: readFileSync(join(ticketsDir, name), "utf8"),
    }));
  const verdict = checkTickets(
    files,
    decidedUnder(readMap(logPath).map, root),
    stories,
  );
  for (const line of formatVerdict(verdict)) out(line);
  const plan = planTickets(root, files, verdict);
  let problems = verdict.failures.length + plan.unplanned.length;
  for (const line of plan.unplanned) err(`werk: ${line}`);
  for (const { type, ...ticket } of plan.planned) {
    const result = appendBoardEvent(boardLog, { type, ...ticket });
    if (!result.ok) {
      problems += 1;
      err(
        `werk: ticket ${ticket.id} is not planned: ${result.violation.detail}`,
      );
    }
  }
  return problems === 0
    ? endPlan("ok")
    : endPlan(
        "failed",
        `${problems} check failure(s); the tickets without a failure are planned`,
      );
}
