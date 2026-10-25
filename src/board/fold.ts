/**
 * The board fold: a pure function from the events of the board log to the board.
 * See #vi-board-state. Like the map fold, an event that breaks a rule is set aside
 * as a problem, the events after it still fold, and a write checks its event with
 * the same step function (#st-ticket-restore).
 */
import type { LogEntry } from "../map/fold.ts";
import {
  buildFollowupRecord,
  type FollowupRecord,
} from "./followup-records.ts";

export const COLUMNS = [
  "blocked",
  "ready",
  "building",
  "merging",
  "done",
] as const;
export type Column = (typeof COLUMNS)[number];

/** Who made a move: a person, an agent, or the merge loop. */
export type Actor = "you" | "agent" | "loop";

export type BoardRule =
  | "bad-json"
  | "bad-event"
  | "unknown-ticket"
  | "duplicate-ticket"
  | "bad-move"
  | "open-blocker"
  | "no-reason"
  | "archived"
  | "not-archived"
  | "not-ready"
  | "marked"
  | "unknown-session";

export type BoardViolation = { rule: BoardRule; detail: string };
export type BoardProblem = BoardViolation & { line: number };

/** One builder session. It runs only while it has no end and its process is alive (#vi-board-session-file). */
export type Build = {
  session: string;
  pid: number;
  /** The session log that holds the agent's lines. The board log holds none. */
  log: string;
  ended: boolean;
  result?: string;
};

/** A change to a cited card after the ticket was planned (#st-ticket-watch). */
export type CitedMark = { card: string; kind: string; version: number };

/** Who archived a ticket and why, when the archive states a reason (#st-plan-archive). */
export type Archive = { by: string; reason: string };

export type Pass = { n: number; result: string };
export type HeldOut = { result: "green" | "red" };

export type Ticket = {
  /** <plan run>/<NN> */
  id: string;
  plan: string;
  number: string;
  title: string;
  column: Column;
  archived: boolean;
  /** Why a blocked ticket is blocked: the failed set check, then each changed cited card. */
  reason: string;
  /** The part of the reason that a failed set check or an agent gave. */
  checkReason: string;
  /** The version of each cited card when the plan put the ticket on the board (#st-ticket-watch). */
  cited: Record<string, number>;
  /** The cited cards that changed since those versions. A plan over the subtree clears them. */
  marks: CitedMark[];
  /** Set while the ticket is archived and the archive gave a reason. */
  archive?: Archive;
  /** Ticket ids that must be done before this one builds. */
  blockedBy: string[];
  branch?: string;
  builds: Build[];
  passes: Pass[];
  /** Passes that ended red. */
  retries: number;
  steps: string[];
  heldout: HeldOut[];
  followups: string[];
  /** Follow-up requests recorded on the finished ticket (#werk-cli-followup-event). */
  followupRecords: FollowupRecord[];
};

/** One run of a plan: its agents run until it ends, and each writer step names its agent log (#vi-board-plan). */
export type PlanRun = {
  state: "running" | "ended";
  pid?: number;
  steps: { step: string; log?: string }[];
  result?: string;
  reason?: string;
};

export type Plan = {
  id: string;
  tier?: string;
  run?: PlanRun;
  /** Gates by name: waiting or passed. */
  gates: Record<string, "waiting" | "passed">;
  /** The merge-loop process that holds the run, from "run started" to "run ended". */
  runPid?: number;
  /** The decided cards of the subtree that no open ticket cites, from the latest cards-cited check (#st-ticket-watch). */
  uncited: string[];
  tickets: string[];
};

export type Board = {
  tickets: Map<string, Ticket>;
  plans: Map<string, Plan>;
  /** The order of ready tickets, archived ones included, so a restore keeps the place. */
  readyOrder: string[];
  /** The project's target repository: the path of the latest target event (#st-build-target-board-log). */
  target?: string;
  problems: BoardProblem[];
};

export function emptyBoard(): Board {
  return {
    tickets: new Map(),
    plans: new Map(),
    readyOrder: [],
    problems: [],
  };
}

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (rec: Rec, key: string): string | undefined => {
  const value = rec[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};
const strList = (rec: Rec, key: string): string[] | undefined => {
  const value = rec[key];
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : undefined;
};

const TICKET_ID = /^[^/\s]+\/\d{2}$/;

const bad = (detail: string): BoardViolation => ({
  rule: "bad-event",
  detail,
});

/** A person's moves are rules in code (#vi-board-state). */
const PERSON_MOVES: readonly (readonly [Column, Column])[] = [
  ["ready", "building"],
  ["building", "ready"],
];
const ARCHIVABLE: readonly Column[] = ["ready", "blocked", "building"];

function ensurePlan(board: Board, id: string): Plan {
  let plan = board.plans.get(id);
  if (!plan) {
    plan = { id, gates: {}, uncited: [], tickets: [] };
    board.plans.set(id, plan);
  }
  return plan;
}

/** The ticket an event names, or the violation that refuses it. */
function ticketOf(board: Board, rec: Rec, key = "id"): Ticket | BoardViolation {
  const id = str(rec, key);
  if (id === undefined) return bad(`event needs ${key}`);
  const ticket = board.tickets.get(id);
  return (
    ticket ?? { rule: "unknown-ticket", detail: `no ticket ${id} on the board` }
  );
}

const isViolation = (value: Ticket | BoardViolation): value is BoardViolation =>
  "rule" in value;

function leaveReady(board: Board, id: string): void {
  board.readyOrder = board.readyOrder.filter((other) => other !== id);
}

function openBlockers(board: Board, ticket: Ticket): string[] {
  return ticket.blockedBy.filter(
    (id) => board.tickets.get(id)?.column !== "done",
  );
}

/** The versions a plan records for the cards a ticket cites. Absent means none. */
function citedOf(rec: Rec): Record<string, number> | undefined {
  const value = rec.cited;
  if (value === undefined) return {};
  if (!isRecord(value)) return undefined;
  const cited: Record<string, number> = {};
  for (const [card, version] of Object.entries(value)) {
    if (!Number.isInteger(version) || (version as number) < 0) return undefined;
    cited[card] = version as number;
  }
  return cited;
}

/** The reason a blocked ticket shows: the check's own reason, then one clause for each changed cited card. */
function reasonOf(ticket: Ticket): string {
  return [
    ticket.checkReason,
    ...ticket.marks.map(
      (m) => `cited card #${m.card} changed after the plan: ${m.kind}`,
    ),
  ]
    .filter((part) => part !== "")
    .join("; ");
}

function planned(board: Board, rec: Rec): BoardViolation | null {
  const id = str(rec, "id");
  if (id === undefined || !TICKET_ID.test(id))
    return bad("planned needs an id of the form <plan run>/<NN>");
  if (board.tickets.has(id))
    return { rule: "duplicate-ticket", detail: `ticket ${id} is on the board` };
  const blockedBy = strList(rec, "blocked_by") ?? [];
  const reason = str(rec, "reason") ?? "";
  const cited = citedOf(rec);
  if (cited === undefined) return bad("cited maps card ids to whole numbers");
  const [planId, number] = id.split("/") as [string, string];
  const ticket: Ticket = {
    id,
    plan: planId,
    number,
    title: str(rec, "title") ?? "",
    column: reason === "" ? "ready" : "blocked",
    archived: false,
    reason,
    checkReason: reason,
    cited,
    marks: [],
    blockedBy,
    builds: [],
    passes: [],
    retries: 0,
    steps: [],
    heldout: [],
    followups: [],
    followupRecords: [],
  };
  board.tickets.set(id, ticket);
  ensurePlan(board, planId).tickets.push(id);
  if (ticket.column === "ready") board.readyOrder.push(id);
  return null;
}

function moved(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  const to = str(rec, "to") as Column | undefined;
  if (to === undefined || !COLUMNS.includes(to)) return bad("moved needs to");
  const actor = (str(rec, "actor") ?? "agent") as Actor;
  const from = ticket.column;
  if (ticket.archived)
    return { rule: "archived", detail: `ticket ${ticket.id} is archived` };
  if (from === to)
    return { rule: "bad-move", detail: `ticket ${ticket.id} is in ${to}` };
  if (from === "blocked" && to !== "ready")
    return {
      rule: "bad-move",
      detail:
        "a blocked ticket cannot move to building (or anywhere but ready)",
    };
  if (actor === "you" && !PERSON_MOVES.some(([a, b]) => a === from && b === to))
    return {
      rule: "bad-move",
      detail: `a person cannot move a ticket from ${from} to ${to}`,
    };
  if (from === "ready" && to === "building") {
    const open = openBlockers(board, ticket);
    if (open.length > 0)
      return {
        rule: "open-blocker",
        detail: `ticket ${ticket.id} waits for ${open.join(", ")}`,
      };
  }
  const reason = str(rec, "reason");
  if (to === "blocked" && reason === undefined)
    return {
      rule: "no-reason",
      detail: "a ticket moved to blocked states its blocking reason",
    };
  if (to === "ready" && ticket.marks.length > 0)
    return {
      rule: "marked",
      detail: `ticket ${ticket.id} waits for a plan to check ${ticket.marks.map((m) => `#${m.card}`).join(", ")}`,
    };
  if (from === "ready") leaveReady(board, ticket.id);
  if (to === "ready") board.readyOrder.push(ticket.id);
  ticket.column = to;
  // A move back to ready may carry the reason it came back, such as a build red at the retry cap
  // (#st-build-ticket-hand-off).
  ticket.checkReason = to === "blocked" || to === "ready" ? (reason ?? "") : "";
  ticket.reason = reasonOf(ticket);
  return null;
}

/** An open ticket is ready or blocked and not archived (#st-plan-extend). */
export const isOpen = (ticket: Ticket): boolean =>
  !ticket.archived &&
  (ticket.column === "ready" || ticket.column === "blocked");

/** A plan rewrites an open ticket in place, records the versions of its cited cards, and clears its marks. */
function replanned(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  if (!isOpen(ticket))
    return {
      rule: "bad-move",
      detail: `ticket ${ticket.id} is not open, so a plan leaves it as it is`,
    };
  const cited = citedOf(rec);
  if (cited === undefined) return bad("cited maps card ids to whole numbers");
  const reason = str(rec, "reason") ?? "";
  const title = str(rec, "title");
  if (title === undefined) return bad("replanned needs title");
  ticket.title = title;
  ticket.blockedBy = strList(rec, "blocked_by") ?? [];
  ticket.cited = cited;
  ticket.marks = [];
  ticket.checkReason = reason;
  ticket.reason = reason;
  const column: Column = reason === "" ? "ready" : "blocked";
  if (ticket.column === "ready" && column === "blocked")
    leaveReady(board, ticket.id);
  if (ticket.column === "blocked" && column === "ready")
    board.readyOrder.push(ticket.id);
  ticket.column = column;
  return null;
}

/** The watcher found a change to a card that an open ticket cites: the ticket goes to blocked (#st-ticket-watch). */
function marked(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  if (!isOpen(ticket))
    return {
      rule: "bad-move",
      detail: `ticket ${ticket.id} is not open, so a changed card does not mark it`,
    };
  const card = str(rec, "card");
  const kind = str(rec, "kind");
  const version = rec.version;
  if (
    card === undefined ||
    kind === undefined ||
    !Number.isInteger(version) ||
    !(card in ticket.cited)
  )
    return bad("marked needs a cited card, kind and version");
  ticket.marks = [
    ...ticket.marks.filter((m) => m.card !== card),
    { card, kind, version: version as number },
  ];
  if (ticket.column === "ready") leaveReady(board, ticket.id);
  ticket.column = "blocked";
  ticket.reason = reasonOf(ticket);
  return null;
}

function cardsChecked(board: Board, rec: Rec): BoardViolation | null {
  const planId = planOf(rec);
  if (typeof planId !== "string") return planId;
  const uncited = strList(rec, "uncited");
  if (uncited === undefined) return bad("cards checked needs an uncited list");
  ensurePlan(board, planId).uncited = uncited;
  return null;
}

function reordered(board: Board, rec: Rec): BoardViolation | null {
  const order = strList(rec, "order");
  if (order === undefined) return bad("reordered needs an order list");
  for (const id of order) {
    const ticket = board.tickets.get(id);
    if (ticket?.column !== "ready" || ticket.archived)
      return {
        rule: "not-ready",
        detail: `ticket ${id} is not in ready`,
      };
  }
  const named = new Set(order);
  board.readyOrder = [
    ...order,
    ...board.readyOrder.filter((id) => !named.has(id)),
  ];
  return null;
}

function archived(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  if (ticket.archived)
    return { rule: "archived", detail: `ticket ${ticket.id} is archived` };
  if (!ARCHIVABLE.includes(ticket.column))
    return {
      rule: "bad-move",
      detail: `a ticket in ${ticket.column} cannot be archived`,
    };
  const reason = str(rec, "reason");
  ticket.archived = true;
  if (reason !== undefined)
    ticket.archive = { by: str(rec, "actor") ?? "agent", reason };
  return null;
}

function restored(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec, "ticket");
  if (isViolation(ticket)) return ticket;
  if (!ticket.archived)
    return {
      rule: "not-archived",
      detail: `ticket ${ticket.id} is not archived`,
    };
  ticket.archived = false;
  delete ticket.archive;
  return null;
}

function buildStarted(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  const session = str(rec, "session");
  const log = str(rec, "log");
  const pid = rec.pid;
  if (session === undefined || log === undefined || !Number.isInteger(pid))
    return bad("build started needs session, pid and log");
  ticket.builds.push({ session, pid: pid as number, log, ended: false });
  const branch = str(rec, "branch");
  if (branch !== undefined) ticket.branch = branch;
  return null;
}

function buildEnded(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  const session = str(rec, "session");
  const build = ticket.builds.find((b) => b.session === session);
  if (!build)
    return {
      rule: "unknown-session",
      detail: `ticket ${ticket.id} has no session ${session}`,
    };
  build.ended = true;
  const result = str(rec, "result");
  if (result !== undefined) build.result = result;
  return null;
}

function passed(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  const result = str(rec, "result");
  if (!Number.isInteger(rec.n) || result === undefined)
    return bad("pass needs n and result");
  ticket.passes.push({ n: rec.n as number, result });
  if (result === "red") ticket.retries += 1;
  return null;
}

function merged(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  if (ticket.archived || ticket.column !== "merging")
    return {
      rule: "bad-move",
      detail: `ticket ${ticket.id} is not in merging`,
    };
  ticket.column = "done";
  return null;
}

function steps(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  const list = strList(rec, "steps");
  if (list === undefined) return bad("steps needs a list");
  ticket.steps = list;
  return null;
}

function heldout(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  const result = rec.result;
  if (result !== "green" && result !== "red")
    return bad("held-out result is green or red");
  ticket.heldout.push({ result });
  return null;
}

function followup(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  const other = str(rec, "followup");
  if (other === undefined) return bad("follow-up needs followup");
  ticket.followups.push(other);
  return null;
}

function followupRecorded(board: Board, rec: Rec): BoardViolation | null {
  const ticket = ticketOf(board, rec);
  if (isViolation(ticket)) return ticket;
  if (ticket.column !== "done" || ticket.archived)
    return {
      rule: "bad-move",
      detail: `ticket ${ticket.id} is not done; a follow-up needs a finished build`,
    };
  const record = buildFollowupRecord(ticket.followupRecords, rec);
  if ("rule" in record) return record;
  ticket.followupRecords.push(record);
  return null;
}

function targetSet(board: Board, rec: Rec): BoardViolation | null {
  const path = str(rec, "path");
  if (path === undefined) return bad("target needs path");
  board.target = path;
  return null;
}

function planRunEvent(
  board: Board,
  type: string,
  rec: Rec,
): BoardViolation | null {
  const planId = planOf(rec);
  if (typeof planId !== "string") return planId;
  const plan = ensurePlan(board, planId);
  if (type === "plan.started") {
    if (!Number.isInteger(rec.pid)) return bad("plan started needs pid");
    plan.run = { state: "running", pid: rec.pid as number, steps: [] };
    return null;
  }
  const run = plan.run;
  if (run === undefined || run.state !== "running")
    return bad(`${type} needs a plan that runs`);
  if (type === "plan.step") {
    const step = str(rec, "step");
    if (step === undefined) return bad("plan step needs step");
    const log = str(rec, "log");
    run.steps.push(log === undefined ? { step } : { step, log });
    return null;
  }
  const result = str(rec, "result");
  if (result === undefined) return bad("plan ended needs result");
  run.state = "ended";
  delete run.pid;
  run.result = result;
  const reason = str(rec, "reason");
  if (reason !== undefined) run.reason = reason;
  return null;
}

function planOf(rec: Rec): string | BoardViolation {
  return str(rec, "plan") ?? bad("event needs plan");
}

function runEvent(board: Board, type: string, rec: Rec): BoardViolation | null {
  const planId = planOf(rec);
  if (typeof planId !== "string") return planId;
  const plan = ensurePlan(board, planId);
  switch (type) {
    case "run.tier": {
      const tier = str(rec, "tier");
      if (tier === undefined) return bad("tier needs tier");
      plan.tier = tier;
      return null;
    }
    case "run.gate_waiting":
    case "run.gate_passed": {
      const gate = str(rec, "gate");
      if (gate === undefined) return bad("gate event needs gate");
      plan.gates[gate] = type === "run.gate_waiting" ? "waiting" : "passed";
      return null;
    }
    case "run.started":
      if (!Number.isInteger(rec.pid)) return bad("run started needs pid");
      plan.runPid = rec.pid as number;
      return null;
    case "run.ended":
      delete plan.runPid;
      return null;
    default:
      return bad(`unknown run event ${type}`);
  }
}

const TICKET_EVENTS: Record<
  string,
  (board: Board, rec: Rec) => BoardViolation | null
> = {
  "ticket.planned": planned,
  "ticket.moved": moved,
  "ticket.replanned": replanned,
  "ticket.marked": marked,
  "ticket.reordered": reordered,
  "ticket.archived": archived,
  "ticket.restored": restored,
  "build.started": buildStarted,
  "ticket.pass": passed,
  "build.ended": buildEnded,
  "ticket.merge": merged,
  "ticket.steps": steps,
  "ticket.heldout": heldout,
  "ticket.followup": followup,
  "ticket.followup_recorded": followupRecorded,
  "project.target": targetSet,
};

const PLAN_EVENTS = new Set(["plan.started", "plan.step", "plan.ended"]);

const RUN_EVENTS = new Set([
  "run.tier",
  "run.gate_waiting",
  "run.gate_passed",
  "run.started",
  "run.ended",
]);

/** Applies one event to the board. Returns the rule it breaks, and then changes nothing. */
export function applyBoardEvent(
  board: Board,
  event: unknown,
): BoardViolation | null {
  if (!isRecord(event)) return bad("an event is a JSON object");
  const type = str(event, "type");
  if (type === undefined) return bad("event needs type");
  const handler = TICKET_EVENTS[type];
  if (handler) return handler(board, event);
  if (RUN_EVENTS.has(type)) return runEvent(board, type, event);
  if (type === "plan.cards_checked") return cardsChecked(board, event);
  if (PLAN_EVENTS.has(type)) return planRunEvent(board, type, event);
  return bad(`unknown event type ${type}`);
}

export function foldBoard(entries: readonly LogEntry[]): Board {
  const board = emptyBoard();
  for (const entry of entries) {
    const violation = entry.error
      ? ({ rule: "bad-json", detail: entry.error } as BoardViolation)
      : applyBoardEvent(board, entry.event);
    if (violation) board.problems.push({ ...violation, line: entry.line });
  }
  return board;
}

/** The tickets of each column. Ready follows its own order; an archived ticket is in none. */
export function columnsOf(board: Board): Record<Column, string[]> {
  const columns: Record<Column, string[]> = {
    blocked: [],
    ready: [],
    building: [],
    merging: [],
    done: [],
  };
  for (const ticket of board.tickets.values()) {
    if (ticket.archived || ticket.column === "ready") continue;
    columns[ticket.column].push(ticket.id);
  }
  columns.ready = board.readyOrder.filter(
    (id) => !board.tickets.get(id)?.archived,
  );
  return columns;
}

/** True when the process is alive. The caller supplies the probe, so the fold stays pure. */
export type Alive = (pid: number) => boolean;

/** The build session of a ticket that runs now: started, no end, and its process alive (#vi-board-session-file). */
export function runningBuild(
  ticket: Ticket,
  isAlive: Alive,
): Build | undefined {
  return ticket.builds.find((b) => !b.ended && isAlive(b.pid));
}

/** True while the run's merge-loop process is alive between "run started" and "run ended". */
export function runActive(plan: Plan, isAlive: Alive): boolean {
  return plan.runPid !== undefined && isAlive(plan.runPid);
}
