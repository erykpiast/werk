// Plan, second plan and block-on-change steps (werk/29). The `werk plan` verb is attempted as the person's action.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decided, problems, seed, werk, type Ev } from "./lib.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const seedBoard = (...events: Ev[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const board = () => readBoard(boardPath());
const planned = (n: string, extra: Ev = {}): Ev => ({
  type: "ticket.planned",
  id: `sub/${n}`,
  title: `Ticket ${n}`,
  ...extra,
});

function subtree() {
  seed(project, [
    ...decided("sub", "Subtree root"),
    ...decided("c1", "Card one", { parent: "sub" }),
    ...decided("c2", "Card two", { parent: "sub" }),
  ]);
  expect(problems(project)).toEqual([]);
}

const plan = () => werk(project, "plan", "sub");

test("29.1 a second plan of the same subtree extends the spec and continues the ticket numbers", async () => {
  subtree();
  seedBoard(
    planned("01"),
    planned("02"),
    planned("03"),
    { type: "ticket.moved", id: "sub/01", to: "building" },
    { type: "ticket.moved", id: "sub/02", to: "building" },
    { type: "ticket.moved", id: "sub/02", to: "merging", actor: "loop" },
    { type: "ticket.merged", id: "sub/02" },
  );
  seed(project, decided("c3", "Card three", { parent: "sub" }));
  const r = await plan();
  expect(r.code, r.stderr).toBe(0);
  const b = board();
  expect([...b.tickets.keys()]).toContain("sub/04");
  expect(new Set([...b.tickets.keys()]).size).toBe(b.tickets.size);
  expect(b.tickets.get("sub/01")?.column).toBe("building");
  expect(b.tickets.get("sub/02")?.column).toBe("done");
  expect(b.tickets.get("sub/03")?.title).not.toBe("Ticket 03");
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  subtree();
  seedBoard(planned("01"), planned("02"));
  expect((await werk(project, "remove", "c2")).code).toBe(0);
  const r = await plan();
  expect(r.code, r.stderr).toBe(0);
  const gone = [...board().tickets.values()].filter((t) => t.archived);
  expect(gone).toHaveLength(1);
  const restored = await werk(project, "ticket", "restore", gone[0]?.number ?? "", "--actor", "you");
  expect(restored.code, restored.stderr).toBe(0);
  expect(board().tickets.get(gone[0]?.id ?? "")?.archived).toBe(false);
});

const retitle = async (id: string, title: string) => {
  const p = await werk(project, "propose", id, "--title", title);
  expect(p.code, p.stderr).toBe(0);
  const a = await werk(project, "accept", id, "--actor", "you");
  expect(a.code, a.stderr).toBe(0);
};

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  subtree();
  seedBoard(planned("01", { cites: ["c1"] }));
  await retitle("c1", "Card one renamed");
  const t = board().tickets.get("sub/01");
  expect(t?.column).toBe("blocked");
  expect(t?.reason).toContain("c1");
  expect(t?.reason.toLowerCase()).toContain("title");
  const r = await plan();
  expect(r.code, r.stderr).toBe(0);
  expect(board().tickets.get("sub/01")?.column).toBe("ready");
});

test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
  subtree();
  seedBoard(
    planned("01", { cites: ["c1"] }),
    planned("02", { cites: ["c1"] }),
    { type: "ticket.moved", id: "sub/02", to: "building" },
  );
  expect((await werk(project, "say", "c1", "a plain note")).code).toBe(0);
  expect(board().tickets.get("sub/01")?.column).toBe("ready");
  expect(board().tickets.get("sub/02")?.column).toBe("building");
  const p = await werk(project, "propose", "c1", "--ops", JSON.stringify([{ tag: "new", new: "A changed body for card one." }]));
  expect(p.code, p.stderr).toBe(0);
  expect((await werk(project, "accept", "c1", "--actor", "you")).code).toBe(0);
  const one = board().tickets.get("sub/01");
  expect(one?.column).toBe("blocked");
  expect(one?.reason).toContain("c1");
  expect(one?.reason.toLowerCase()).toContain("body");
  expect(board().tickets.get("sub/02")?.column).toBe("building");
  expect(board().tickets.get("sub/02")?.reason).toBe("");
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  subtree();
  seedBoard(planned("01", { cites: ["c1"] }), planned("02", { cites: ["c2"] }));
  const r = await werk(project, "add", "c9", "--title", "Uncited card", "--parent", "sub");
  const report = `${r.stdout}\n${r.stderr}`;
  expect(report).toContain("cards-cited");
  expect(report).toContain("c9");
  for (const t of board().tickets.values()) {
    expect(t.column).toBe("ready");
    expect(t.reason).toBe("");
  }
  expect(readFileSync(boardPath(), "utf8")).not.toContain("blocked");
});
