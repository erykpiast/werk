/**
 * The plan: a decided subtree becomes one spec and checked tickets, and every answer that no card gives
 * becomes a ghost card under the subtree root (#st-spec, #st-spec-linked, #st-spec-answers, #st-ticket-partial).
 * The files go to werk's store for the project, never to the target repository (#st-build-target).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildLaunchOptions } from "../agent/launch-options.ts";
import { type Ticket as BoardTicket, isOpen } from "../board/fold.ts";
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
import {
  checkTickets,
  formatVerdict,
  type Verdict,
} from "../tickets/check-folder.ts";
import { decidedUnder } from "../tickets/decided-cards.ts";
import { clearTicketFolder, readTicketFiles } from "../tickets/read-folder.ts";
import { storiesOf } from "../tickets/spec-stories.ts";
import { ticketNumber } from "../tickets/ticket-parse.ts";
import { parseAnswers, proposalEvent } from "./answers.ts";
import { citedChanges, versionsOf } from "./cited-changes.ts";
import { parseDrops } from "./drops.ts";
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
  const boardIds = onBoard.plans.get(root)?.tickets ?? [];
  const numberOf = (id: string): number => Number(id.split("/")[1]);
  const numbersOnBoard = new Set(boardIds.map(numberOf));
  const offset = Math.max(0, ...numbersOnBoard);
  // Open tickets are ready or blocked. Only a plan changes them; every other ticket stays as it is (#st-plan-extend).
  const openNumbers = new Set(
    boardIds
      .filter((id) => isOpen(onBoard.tickets.get(id) as BoardTicket))
      .map(numberOf),
  );
  const archivedNumbers = new Set(
    boardIds.filter((id) => onBoard.tickets.get(id)?.archived).map(numberOf),
  );

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
  mkdirSync(specDir, { recursive: true });
  mkdirSync(ticketsDir, { recursive: true });
  // The text of a ticket the board holds stays; every other file of an earlier run goes.
  clearTicketFolder(ticketsDir, numbersOnBoard);
  const paths: PlanPaths = {
    spec: join(specDir, "spec.md"),
    specAnswers: join(specDir, "spec-answers.json"),
    ticketAnswers: join(specDir, "ticket-answers.json"),
    ticketDrops: join(specDir, "ticket-drops.json"),
    ticketsDir,
  };
  // The spec of an earlier plan stays and the writer updates it. The answers and the drops belong to one run.
  const extending = existsSync(paths.spec) || boardIds.length > 0;
  for (const file of [
    paths.specAnswers,
    paths.ticketAnswers,
    paths.ticketDrops,
  ])
    rmSync(file, { force: true });
  const filesBefore = new Map(
    readTicketFiles(ticketsDir).map((f) => [f.name, f.text]),
  );

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
    specPrompt(root, scopeText, paths, extending),
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
    ticketPrompt(root, scopeText, paths, offset + 1, {
      open: [...openNumbers].sort((a, b) => a - b),
      fixed: [...numbersOnBoard]
        .filter((n) => !openNumbers.has(n))
        .sort((a, b) => a - b),
    }),
    [paths.ticketAnswers, paths.ticketDrops, join(ticketsDir, "*")],
  );
  if (failure !== null) return endPlan("failed", failure);
  failure = propose("ticket-writer", paths.ticketAnswers);
  if (failure !== null) return endPlan("failed", failure);

  // The checks read the map again: the answers are ghosts now, and a ghost counts as no decided card.
  let problems = 0;
  const problem = (line: string): void => {
    problems += 1;
    err(`werk: ${line}`);
  };

  // The open tickets that the new spec no longer needs are archived, with the writer's reason (#st-plan-archive).
  const dropped = new Map<number, string>();
  const dropsText = readText(paths.ticketDrops);
  const drops = dropsText === null ? null : parseDrops(dropsText);
  if (drops?.ok === false)
    problem(`the ticket-writer's drops file is bad: ${drops.error}`);
  for (const { ticket: number, why } of drops?.ok ? drops.drops : []) {
    if (openNumbers.has(number)) dropped.set(number, why);
    else problem(`ticket ${number} is not open, so a plan does not drop it`);
  }

  // A file of a ticket that is not open stays as it was.
  const ticketFiles = (): { name: string; text: string }[] =>
    readTicketFiles(ticketsDir);
  const numberOfFile = (name: string): number => Number(ticketNumber(name));
  for (const file of ticketFiles()) {
    const before = filesBefore.get(file.name);
    const n = numberOfFile(file.name);
    if (before === undefined || file.text === before) continue;
    if (numbersOnBoard.has(n) && !openNumbers.has(n)) {
      writeFileSync(join(ticketsDir, file.name), before);
      problem(`ticket ${n} is not open, so its file stays as it was`);
    }
  }

  // The set holds the new files and every ticket that stays on the board, and no archived or dropped ticket.
  const setFiles = (): { name: string; text: string }[] =>
    ticketFiles().filter((f) => {
      const n = numberOfFile(f.name);
      return !archivedNumbers.has(n) && !dropped.has(n);
    });
  const decided = decidedUnder(readMap(logPath).map, root);
  const run = (files: { name: string; text: string }[]): Verdict =>
    checkTickets(files, decided, stories);
  let verdict = run(setFiles());
  // A rewrite that fails its own checks is undone, so the board and the file agree.
  const rejected = new Set<number>();
  for (const failure of verdict.failures.slice(0, verdict.ownFailures)) {
    const before = filesBefore.get(failure.ticket);
    const n = numberOfFile(failure.ticket);
    if (before === undefined || !openNumbers.has(n) || rejected.has(n))
      continue;
    rejected.add(n);
    writeFileSync(join(ticketsDir, failure.ticket), before);
  }
  const files = setFiles();
  if (rejected.size > 0) verdict = run(files);
  for (const line of formatVerdict(verdict)) out(line);

  const cites = new Set(
    files.flatMap((f) =>
      (/^cites:[ \t]*(.*)$/m.exec(f.text)?.[1] ?? "")
        .split(",")
        .map((c) => c.trim().replace(/^#/, ""))
        .filter((c) => c !== ""),
    ),
  );
  const versions = versionsOf(citedChanges(entries, cites), [...cites]);
  const plan = planTickets(root, files, verdict, versions, {
    numbers: numbersOnBoard,
    open: new Set([...openNumbers].filter((n) => !dropped.has(n))),
  });
  problems += verdict.failures.length + plan.unplanned.length;
  for (const line of plan.unplanned) err(`werk: ${line}`);
  for (const [number, why] of dropped) {
    const id = `${root}/${String(number).padStart(2, "0")}`;
    const result = appendBoardEvent(boardLog, {
      type: "ticket.archived",
      id,
      actor: "plan",
      reason: why,
    });
    if (!result.ok)
      problem(`ticket ${id} is not archived: ${result.violation.detail}`);
  }
  for (const { type, ...ticket } of plan.planned) {
    if (rejected.has(Number(ticket.id.split("/")[1]))) continue;
    const result = appendBoardEvent(boardLog, { type, ...ticket });
    if (!result.ok)
      problem(`ticket ${ticket.id} is not planned: ${result.violation.detail}`);
  }
  return problems === 0
    ? endPlan("ok")
    : endPlan(
        "failed",
        `${problems} check failure(s); the tickets without a failure are planned`,
      );
}
