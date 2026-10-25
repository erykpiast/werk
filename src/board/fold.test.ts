import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../map/fold.ts";
import {
  applyBoardEvent,
  columnsOf,
  emptyBoard,
  foldBoard,
  runActive,
  runningBuild,
} from "./fold.ts";

const entries = (...events: unknown[]): LogEntry[] =>
  events.map((event, i) => ({ line: i + 1, event }));
const plan = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "ticket.planned",
  id,
  title: id,
  ...extra,
});
const move = (id: string, to: string, extra: Record<string, unknown> = {}) => ({
  type: "ticket.moved",
  id,
  to,
  ...extra,
});
const rules = (...events: unknown[]) =>
  foldBoard(entries(...events)).problems.map((p) => p.rule);

describe("columns and order", () => {
  test("a hand-written log folds into the five columns", () => {
    const board = foldBoard(
      entries(
        plan("r/01"),
        plan("r/02"),
        plan("r/03", { reason: "cites a stale card" }),
        plan("r/04"),
        plan("r/05"),
        move("r/01", "building"),
        move("r/01", "merging", { actor: "loop" }),
        { type: "ticket.merge", id: "r/01" },
        move("r/04", "building"),
      ),
    );
    expect(board.problems).toEqual([]);
    expect(columnsOf(board)).toEqual({
      blocked: ["r/03"],
      ready: ["r/02", "r/05"],
      building: ["r/04"],
      merging: [],
      done: ["r/01"],
    });
    expect(board.tickets.get("r/03")?.reason).toBe("cites a stale card");
    expect(board.plans.get("r")?.tickets).toHaveLength(5);
  });

  test("reorder puts the named tickets first and keeps the rest in place", () => {
    const board = foldBoard(
      entries(plan("r/01"), plan("r/02"), plan("r/03"), {
        type: "ticket.reordered",
        order: ["r/03", "r/01"],
      }),
    );
    expect(columnsOf(board).ready).toEqual(["r/03", "r/01", "r/02"]);
  });

  test("a reorder that names a ticket outside ready is refused", () => {
    expect(
      rules(plan("r/01"), move("r/01", "building"), {
        type: "ticket.reordered",
        order: ["r/01"],
      }),
    ).toEqual(["not-ready"]);
    expect(rules({ type: "ticket.reordered" })).toEqual(["bad-event"]);
  });

  test("a ticket moved back to ready goes to the end of the order", () => {
    const board = foldBoard(
      entries(
        plan("r/01"),
        plan("r/02"),
        move("r/01", "building"),
        move("r/01", "ready"),
      ),
    );
    expect(columnsOf(board).ready).toEqual(["r/02", "r/01"]);
  });
});

describe("moves", () => {
  test("ready to building waits for open blockers", () => {
    const events = [plan("r/01"), plan("r/02", { blocked_by: ["r/01"] })];
    expect(rules(...events, move("r/02", "building"))).toEqual([
      "open-blocker",
    ]);
    expect(
      rules(
        ...events,
        move("r/01", "building"),
        move("r/01", "merging"),
        { type: "ticket.merge", id: "r/01" },
        move("r/02", "building"),
      ),
    ).toEqual([]);
  });

  test("a person moves only ready to building and building to ready", () => {
    expect(rules(plan("r/01"), move("r/01", "done", { actor: "you" }))).toEqual(
      ["bad-move"],
    );
    expect(
      rules(
        plan("r/01"),
        move("r/01", "building", { actor: "you" }),
        move("r/01", "ready", { actor: "you" }),
      ),
    ).toEqual([]);
  });

  test("a blocked ticket cannot build, and moving to blocked needs a reason", () => {
    expect(
      rules(plan("r/01", { reason: "x" }), move("r/01", "building")),
    ).toEqual(["bad-move"]);
    expect(rules(plan("r/01"), move("r/01", "blocked"))).toEqual(["no-reason"]);
    const board = foldBoard(
      entries(
        plan("r/01"),
        move("r/01", "blocked", { reason: "why" }),
        move("r/01", "ready"),
      ),
    );
    expect(board.tickets.get("r/01")?.reason).toBe("");
  });

  test("bad moves are refused with their rule", () => {
    expect(rules(move("r/01", "ready"))).toEqual(["unknown-ticket"]);
    expect(rules(plan("r/01"), move("r/01", "ready"))).toEqual(["bad-move"]);
    expect(rules(plan("r/01"), move("r/01", "nowhere"))).toEqual(["bad-event"]);
    expect(rules(plan("r/01"), { type: "ticket.moved" })).toEqual([
      "bad-event",
    ]);
    expect(
      rules(
        plan("r/01"),
        { type: "ticket.archived", id: "r/01" },
        move("r/01", "building"),
      ),
    ).toEqual(["archived"]);
  });

  test("a merge needs the ticket in merging", () => {
    expect(rules(plan("r/01"), { type: "ticket.merge", id: "r/01" })).toEqual([
      "bad-move",
    ]);
  });
});

describe("plan events", () => {
  test("a ticket needs an id of the form <plan run>/<NN>, once", () => {
    expect(rules(plan("nope"))).toEqual(["bad-event"]);
    expect(rules({ type: "ticket.planned" })).toEqual(["bad-event"]);
    expect(rules(plan("r/01"), plan("r/01"))).toEqual(["duplicate-ticket"]);
  });
});

describe("archive and restore", () => {
  test("an archived blocked ticket comes back to blocked with its old reason", () => {
    const board = foldBoard(
      entries(plan("r/01", { reason: "no card cited" }), plan("r/02"), {
        type: "ticket.archived",
        id: "r/01",
      }),
    );
    expect(columnsOf(board).blocked).toEqual([]);
    expect(board.tickets.get("r/01")?.archived).toBe(true);
    expect(
      applyBoardEvent(board, { type: "ticket.restored", ticket: "r/01" }),
    ).toBeNull();
    expect(columnsOf(board).blocked).toEqual(["r/01"]);
    expect(board.tickets.get("r/01")?.reason).toBe("no card cited");
  });

  test("a restored ready ticket keeps its place", () => {
    const board = foldBoard(
      entries(
        plan("r/01"),
        plan("r/02"),
        { type: "ticket.archived", id: "r/01" },
        { type: "ticket.restored", ticket: "r/01" },
      ),
    );
    expect(columnsOf(board).ready).toEqual(["r/01", "r/02"]);
  });

  test("restore refuses a ticket that is not archived or not on the board", () => {
    expect(
      rules(plan("r/01"), { type: "ticket.restored", ticket: "r/01" }),
    ).toEqual(["not-archived"]);
    expect(rules({ type: "ticket.restored", ticket: "r/09" })).toEqual([
      "unknown-ticket",
    ]);
    expect(rules({ type: "ticket.restored" })).toEqual(["bad-event"]);
  });

  test("only ready, blocked or building tickets archive, and once", () => {
    const archive = { type: "ticket.archived", id: "r/01" };
    expect(
      rules(
        plan("r/01"),
        move("r/01", "building"),
        move("r/01", "merging"),
        archive,
      ),
    ).toEqual(["bad-move"]);
    expect(rules(plan("r/01"), archive, archive)).toEqual(["archived"]);
    expect(rules(plan("r/01"), move("r/01", "building"), archive)).toEqual([]);
  });
});

describe("builds", () => {
  const started = (pid: number, session = "s1") => ({
    type: "build.started",
    id: "r/01",
    session,
    pid,
    log: "s1.log",
    branch: "werk/r-01",
  });
  const ticket = (...events: unknown[]) => {
    const board = foldBoard(
      entries(plan("r/01"), move("r/01", "building"), ...events),
    );
    expect(board.problems).toEqual([]);
    return board.tickets.get("r/01")!;
  };

  test("a session runs only while it has no end and its process is alive", () => {
    const open = ticket(started(42));
    expect(open.branch).toBe("werk/r-01");
    expect(runningBuild(open, (pid) => pid === 42)?.session).toBe("s1");
    expect(runningBuild(open, () => false)).toBeUndefined();
    const ended = ticket(started(42), {
      type: "build.ended",
      id: "r/01",
      session: "s1",
      result: "green",
    });
    expect(runningBuild(ended, () => true)).toBeUndefined();
    expect(ended.builds[0]?.result).toBe("green");
  });

  test("passes count red ones as retries", () => {
    const t = ticket(
      { type: "ticket.pass", id: "r/01", n: 1, result: "red" },
      { type: "ticket.pass", id: "r/01", n: 2, result: "green" },
    );
    expect(t.passes).toHaveLength(2);
    expect(t.retries).toBe(1);
  });

  test("steps, held-out results and follow-ups are kept on the ticket", () => {
    const t = ticket(
      { type: "ticket.steps", id: "r/01", steps: ["Given a"] },
      { type: "ticket.heldout", id: "r/01", result: "red" },
      { type: "ticket.followup", id: "r/01", followup: "r/02" },
    );
    expect(t.steps).toEqual(["Given a"]);
    expect(t.heldout).toEqual([{ result: "red" }]);
    expect(t.followups).toEqual(["r/02"]);
  });

  test("malformed build events are refused", () => {
    expect(rules(plan("r/01"), { type: "build.started", id: "r/01" })).toEqual([
      "bad-event",
    ]);
    expect(
      rules(plan("r/01"), {
        type: "build.ended",
        id: "r/01",
        session: "nope",
      }),
    ).toEqual(["unknown-session"]);
    expect(rules(plan("r/01"), { type: "ticket.pass", id: "r/01" })).toEqual([
      "bad-event",
    ]);
    expect(rules(plan("r/01"), { type: "ticket.steps", id: "r/01" })).toEqual([
      "bad-event",
    ]);
    expect(
      rules(plan("r/01"), { type: "ticket.heldout", id: "r/01", result: "x" }),
    ).toEqual(["bad-event"]);
    expect(
      rules(plan("r/01"), { type: "ticket.followup", id: "r/01" }),
    ).toEqual(["bad-event"]);
    expect(rules({ type: "ticket.pass" })).toEqual(["bad-event"]);
  });
});

describe("run events", () => {
  test("tier, gate and run events fold into the plan", () => {
    const board = foldBoard(
      entries(
        { type: "run.tier", plan: "r", tier: "feature" },
        { type: "run.gate_waiting", plan: "r", gate: "G2" },
        { type: "run.started", plan: "r", pid: 7 },
      ),
    );
    expect(board.problems).toEqual([]);
    const p = board.plans.get("r")!;
    expect(p).toMatchObject({
      tier: "feature",
      gates: { G2: "waiting" },
      runPid: 7,
    });
    expect(runActive(p, () => true)).toBe(true);
    expect(runActive(p, () => false)).toBe(false);
    const after = foldBoard(
      entries(
        { type: "run.gate_passed", plan: "r", gate: "G2" },
        { type: "run.started", plan: "r", pid: 7 },
        { type: "run.ended", plan: "r" },
      ),
    ).plans.get("r")!;
    expect(after.gates.G2).toBe("passed");
    expect(runActive(after, () => true)).toBe(false);
  });

  test("a run event without its field is refused", () => {
    expect(
      rules(
        { type: "run.tier", plan: "r" },
        { type: "run.gate_waiting", plan: "r" },
        { type: "run.started", plan: "r" },
        { type: "run.tier" },
      ),
    ).toEqual(["bad-event", "bad-event", "bad-event", "bad-event"]);
  });
});

describe("a log with bad lines", () => {
  test("bad JSON, non-objects and unknown types are problems and the rest still folds", () => {
    const board = foldBoard([
      { line: 1, event: undefined, error: "Unexpected token" },
      { line: 2, event: 5 },
      { line: 3, event: { x: 1 } },
      { line: 4, event: { type: "weird" } },
      { line: 5, event: plan("r/01") },
    ]);
    expect(board.problems.map((p) => [p.line, p.rule])).toEqual([
      [1, "bad-json"],
      [2, "bad-event"],
      [3, "bad-event"],
      [4, "bad-event"],
    ]);
    expect(board.tickets.size).toBe(1);
    expect(emptyBoard().tickets.size).toBe(0);
  });
});

describe("target and plan run events", () => {
  test("the latest target event is the target", () => {
    const board = foldBoard(
      entries(
        { type: "project.target", path: "/a" },
        { type: "project.target", path: "/b" },
      ),
    );
    expect(board.target).toBe("/b");
    expect(rules({ type: "project.target" })).toEqual(["bad-event"]);
  });

  test("a plan run folds from started through its steps to ended", () => {
    const board = foldBoard(
      entries(
        { type: "plan.started", plan: "r", pid: 4 },
        { type: "plan.step", plan: "r", step: "spec-writer", log: "a.jsonl" },
        { type: "plan.step", plan: "r", step: "ticket-writer" },
        { type: "plan.ended", plan: "r", result: "failed", reason: "why" },
      ),
    );
    expect(board.problems).toEqual([]);
    expect(board.plans.get("r")?.run).toEqual({
      state: "ended",
      steps: [
        { step: "spec-writer", log: "a.jsonl" },
        { step: "ticket-writer" },
      ],
      result: "failed",
      reason: "why",
    });
  });

  test("a plan step or end with no running plan, or a missing field, is refused", () => {
    expect(rules({ type: "plan.step", plan: "r", step: "x" })).toEqual([
      "bad-event",
    ]);
    expect(rules({ type: "plan.started", plan: "r" })).toEqual(["bad-event"]);
    expect(
      rules(
        { type: "plan.started", plan: "r", pid: 1 },
        { type: "plan.step", plan: "r" },
        { type: "plan.ended", plan: "r" },
        { type: "plan.ended", plan: "r", result: "ok" },
        { type: "plan.step", plan: "r", step: "late" },
      ),
    ).toEqual(["bad-event", "bad-event", "bad-event"]);
  });
});

describe("cited cards and plans that extend", () => {
  test("a planned ticket records the version of each card it cites", () => {
    const board = foldBoard(entries(plan("r/01", { cited: { a: 3, b: 0 } })));
    expect(board.tickets.get("r/01")?.cited).toEqual({ a: 3, b: 0 });
    expect(rules(plan("r/01", { cited: { a: -1 } }))).toEqual(["bad-event"]);
    expect(rules(plan("r/01", { cited: "a" }))).toEqual(["bad-event"]);
  });

  test("a replan changes an open ticket in place, keeps its id and clears its marks", () => {
    const board = foldBoard(
      entries(
        plan("r/01", { cited: { a: 1 } }),
        plan("r/02"),
        {
          type: "ticket.marked",
          id: "r/01",
          card: "a",
          kind: "reopened",
          version: 5,
        },
        {
          type: "ticket.replanned",
          id: "r/01",
          title: "new",
          blocked_by: ["r/02"],
          cited: { a: 5 },
        },
      ),
    );
    expect(board.problems).toEqual([]);
    const ticket = board.tickets.get("r/01");
    expect(ticket).toMatchObject({
      title: "new",
      column: "ready",
      reason: "",
      blockedBy: ["r/02"],
      cited: { a: 5 },
      marks: [],
    });
    expect(columnsOf(board).ready).toEqual(["r/02", "r/01"]);
  });

  test("a replan with a reason blocks a ready ticket, and one without frees a blocked ticket", () => {
    const blocked = foldBoard(
      entries(plan("r/01"), {
        type: "ticket.replanned",
        id: "r/01",
        title: "t",
        reason: "blocked_by: blocker 9 is not in the set",
      }),
    );
    expect(blocked.tickets.get("r/01")?.column).toBe("blocked");
    expect(columnsOf(blocked).ready).toEqual([]);
    const freed = foldBoard(
      entries(plan("r/01", { reason: "x" }), {
        type: "ticket.replanned",
        id: "r/01",
        title: "t",
      }),
    );
    expect(freed.tickets.get("r/01")?.column).toBe("ready");
    expect(columnsOf(freed).ready).toEqual(["r/01"]);
  });

  test("a replan is refused for a ticket that is not open, or unknown, or without a title", () => {
    const replan = { type: "ticket.replanned", id: "r/01", title: "t" };
    expect(rules(plan("r/01"), move("r/01", "building"), replan)).toEqual([
      "bad-move",
    ]);
    expect(
      rules(plan("r/01"), { type: "ticket.archived", id: "r/01" }, replan),
    ).toEqual(["bad-move"]);
    expect(rules(replan)).toEqual(["unknown-ticket"]);
    expect(rules(plan("r/01"), { ...replan, title: undefined })).toEqual([
      "bad-event",
    ]);
    expect(rules(plan("r/01"), { ...replan, cited: 3 })).toEqual(["bad-event"]);
  });

  test("a mark moves an open ticket to blocked and names the card and the change", () => {
    const board = foldBoard(
      entries(
        plan("r/01", { cited: { a: 1 } }),
        plan("r/02", { reason: "set check", cited: { a: 1 } }),
        {
          type: "ticket.marked",
          id: "r/01",
          card: "a",
          kind: "reopened",
          version: 4,
        },
        {
          type: "ticket.marked",
          id: "r/02",
          card: "a",
          kind: "retitled",
          version: 4,
        },
      ),
    );
    expect(board.problems).toEqual([]);
    expect(columnsOf(board)).toMatchObject({
      ready: [],
      blocked: ["r/01", "r/02"],
    });
    expect(board.tickets.get("r/01")?.reason).toBe(
      "cited card #a changed after the plan: reopened",
    );
    expect(board.tickets.get("r/02")?.reason).toBe(
      "set check; cited card #a changed after the plan: retitled",
    );
  });

  test("a second mark on one card replaces the first, and a mark for an uncited card is refused", () => {
    const mark = (version: number, kind: string, card = "a") => ({
      type: "ticket.marked",
      id: "r/01",
      card,
      kind,
      version,
    });
    const board = foldBoard(
      entries(
        plan("r/01", { cited: { a: 1 } }),
        mark(4, "reopened"),
        mark(6, "decided"),
      ),
    );
    expect(board.tickets.get("r/01")?.marks).toEqual([
      { card: "a", kind: "decided", version: 6 },
    ]);
    expect(rules(plan("r/01", { cited: { a: 1 } }), mark(4, "x", "z"))).toEqual(
      ["bad-event"],
    );
    expect(
      rules(plan("r/01", { cited: { a: 1 } }), {
        ...mark(4, "x"),
        version: "4",
      }),
    ).toEqual(["bad-event"]);
  });

  test("a building ticket is not marked, and nothing but a plan frees a marked ticket", () => {
    const mark = {
      type: "ticket.marked",
      id: "r/01",
      card: "a",
      kind: "reopened",
      version: 4,
    };
    expect(
      rules(plan("r/01", { cited: { a: 1 } }), move("r/01", "building"), mark),
    ).toEqual(["bad-move"]);
    expect(
      rules(
        plan("r/01", { cited: { a: 1 } }),
        mark,
        move("r/01", "ready", { actor: "agent" }),
      ),
    ).toEqual(["marked"]);
  });

  test("an archive keeps the reason and who gave it, and a restore ends it", () => {
    const archive = {
      type: "ticket.archived",
      id: "r/01",
      actor: "plan",
      reason: "the spec drops it",
    };
    const archived = foldBoard(entries(plan("r/01"), archive));
    expect(archived.tickets.get("r/01")?.archive).toEqual({
      by: "plan",
      reason: "the spec drops it",
    });
    const restored = foldBoard(
      entries(plan("r/01"), archive, {
        type: "ticket.restored",
        ticket: "r/01",
      }),
    );
    expect(restored.tickets.get("r/01")?.archive).toBeUndefined();
    expect(restored.tickets.get("r/01")?.column).toBe("ready");
    const bare = foldBoard(
      entries(plan("r/01"), { type: "ticket.archived", id: "r/01" }),
    );
    expect(bare.tickets.get("r/01")?.archive).toBeUndefined();
  });

  test("the cards-cited check of a plan is reported on the plan", () => {
    const board = foldBoard(
      entries(plan("r/01"), {
        type: "plan.cards_checked",
        plan: "r",
        uncited: ["x"],
      }),
    );
    expect(board.plans.get("r")?.uncited).toEqual(["x"]);
    expect(rules({ type: "plan.cards_checked", plan: "r" })).toEqual([
      "bad-event",
    ]);
    expect(rules({ type: "plan.cards_checked", uncited: [] })).toEqual([
      "bad-event",
    ]);
  });
});
