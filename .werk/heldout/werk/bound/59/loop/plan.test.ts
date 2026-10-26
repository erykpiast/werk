import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type { Script, Step } from "../../src/fake-agent/script.ts";
import { decided, link } from "../../src/map/mark-fixtures.ts";
import { readBoardView } from "../../src/serve/board-read.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { ticket } from "../../src/tickets/fixtures.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => {
  extraEnv = {};
  return project.dispose();
});

let extraEnv: Record<string, string> = {};
const werk = (...args: string[]) =>
  project.run(["bun", CLI, ...args], extraEnv);
/**
 * A wrapper placed before the fake agent on the search path. It saves the whole prompt of each launch
 * (the fake records only the first line) and then runs the real fake agent on the same input.
 */
function tapPrompts(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-tap-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "out"));
  const fake = join(import.meta.dir, "..", "..", "fake", "claude");
  const wrapper = join(dir, "bin", "claude");
  writeFileSync(
    wrapper,
    `#!/bin/sh\ncat > "${dir}/out/$WERK_AGENT_ROLE-$$.txt"\nexec "${fake}" "$@" < "${dir}/out/$WERK_AGENT_ROLE-$$.txt"\n`,
  );
  chmodSync(wrapper, 0o755);
  extraEnv = { PATH: `${join(dir, "bin")}:${process.env.PATH}` };
  return join(dir, "out");
}
const seed = (events: unknown[]) =>
  writeFileSync(
    project.logPath,
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
const boardLog = () => join(project.dir, ".werk", "board.jsonl");
const board = () => readBoard(boardLog());
const view = () => readBoardView(project.logPath);
const ticketFile = (name: string) =>
  readFileSync(join(project.dir, ".werk/tickets/app", name), "utf8");

const RESULT: Step = {
  event: {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    total_cost_usd: 0.25,
    usage: { input_tokens: 10, output_tokens: 20 },
  },
};
const edit = (path: string, content: string): Step => ({ edit: path, content });
const SPEC =
  "## Problem\n\nP.\n\n## User stories\n\n1. As a person, I want one.\n2. As a person, I want two.\n";
const specWriter = (text: string): Step[] => [
  edit("specs/app/spec.md", text),
  edit("specs/app/spec-answers.json", "[]"),
  RESULT,
];
const ticketWriter = (...files: [string, string][]): Step[] => [
  ...files.map(([name, text]) => edit(`tickets/app/${name}`, text)),
  edit("specs/app/ticket-answers.json", "[]"),
  RESULT,
];
const t = (n: number, cites: string, title = `Ticket ${n}`, what?: string) =>
  ticket({ title, cites, stories: n === 2 ? "2" : n === 4 ? "3" : "1", ...(what ? { what } : {}) });

/** The map: app with two decided cards below it. */
function seedMap() {
  seed([
    ...decided("app"),
    ...decided("one"),
    ...decided("two"),
    link("one", "app", "refines"),
    link("two", "app", "refines"),
  ]);
}
const FIRST_TICKETS: [string, string][] = [
  ["01-a.md", t(1, "app, one")],
  ["02-b.md", t(2, "two")],
  ["03-c.md", t(3, "one, two")],
];

function install(second: { spec?: Step[]; tickets: Step[] } | null) {
  const script: Script = {
    roles: {
      "spec-writer": {
        replies: [specWriter(SPEC), ...(second ? [second.spec ?? specWriter(SPEC)] : [])],
      },
      "ticket-writer": {
        replies: [
          ticketWriter(...FIRST_TICKETS),
          ...(second ? [second.tickets] : []),
        ],
      },
    },
  };
  project.install(script);
}
const push = (...events: unknown[]) =>
  appendFileSync(
    boardLog(),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
const until = async <T>(read: () => T | undefined, ms = 10000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = read();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(50);
  }
};
function startServer() {
  const child = project.start(["bun", CLI, "serve", "--port", "0"]);
  const lock = join(project.dir, ".werk", "serve.lock");
  return until(() => {
    try {
      const l = JSON.parse(readFileSync(lock, "utf8"));
      return l.port > 0 ? l : undefined;
    } catch {
      return undefined;
    }
  }).then(() => child);
}
/** A person adds a decided card under app, through the CLI verbs. */
async function addDecidedCard(id: string) {
  for (const args of [
    ["add", id, "--title", `Card ${id}`, "--why", "Because.", "--parent", "app"],
    ["accept", id, "--actor", "you"],
    ["edit", id, "--who", "me"],
    ["kill", id, "--revisit"],
    ["status", id, "decided"],
  ]) {
    const r = await werk(...args);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  }
}

test("29.1 a second plan extends the spec, keeps numbers, adds ticket 4 and leaves building and done tickets alone", async () => {
  seedMap();
  const newTickets = [
    edit("tickets/app/03-c.md", t(3, "one, two", "Ticket 3 rewritten", "Rewritten words of ticket three.")),
    edit("tickets/app/04-d.md", t(4, "three", "Ticket 4")),
  ];
  install({
    spec: specWriter(`${SPEC}3. As a person, I want three.\n\nCovers the card three.\n`),
    tickets: [...newTickets, edit("specs/app/ticket-answers.json", "[]"), RESULT],
  });
  const first = await werk("plan", "app");
  expect(first.stderr).toBe("");
  expect(first.code).toBe(0);
  const b0 = board();
  expect([...b0.tickets.values()].map((x) => x.column)).toEqual(["ready", "ready", "ready"]);
  const text1 = ticketFile("01-a.md");
  const text2 = ticketFile("02-b.md");
  // Ticket 1 is building, ticket 2 is done.
  push(
    { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "app/02" },
  );
  expect(board().tickets.get("app/01")?.column).toBe("building");
  expect(board().tickets.get("app/02")?.column).toBe("done");
  // A person adds a new decided card, with the spec writer's story 3, and plans again.
  await addDecidedCard("three");
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const specs = readdirSync(join(project.dir, ".werk/specs/app")).filter((f) => f.endsWith(".md"));
  expect(specs).toEqual(["spec.md"]);
  expect(readFileSync(join(project.dir, ".werk/specs/app/spec.md"), "utf8")).toContain("three");
  expect(board().plans.size).toBe(1);
  const b = board();
  expect([...b.tickets.keys()].sort()).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(b.tickets.get("app/03")?.title).toBe("Ticket 3 rewritten");
  expect(b.tickets.get("app/03")?.column).toBe("ready");
  expect(ticketFile("03-c.md")).toContain("Rewritten words of ticket three.");
  expect(b.tickets.get("app/04")?.column).toBe("ready");
  expect(b.tickets.get("app/01")).toMatchObject({ title: "Ticket 1", column: "building" });
  expect(b.tickets.get("app/02")).toMatchObject({ title: "Ticket 2", column: "done" });
  expect(ticketFile("01-a.md")).toBe(text1);
  expect(ticketFile("02-b.md")).toBe(text2);
  // What the board shows of ticket 3: its text, read from the store.
  expect(view().columns.ready.find((x) => x.id === "app/03")?.text).toContain("Rewritten words of ticket three.");
});

test("29.2 an open ticket the new spec drops is archived with a reason and ticket restore brings it back", async () => {
  seedMap();
  install({
    tickets: [
      edit("specs/app/ticket-drops.json", JSON.stringify([{ ticket: 2, why: "the current spec no longer needs it" }])),
      edit("specs/app/ticket-answers.json", "[]"),
      RESULT,
    ],
  });
  expect((await werk("plan", "app")).code).toBe(0);
  expect(board().tickets.get("app/02")?.column).toBe("ready");
  expect((await werk("remove", "two", "--actor", "you")).code).toBe(0);
  // Ticket 3 cited the removed card too; the ticket writer keeps it citing live cards.
  const again = await werk("plan", "app");
  const b = board();
  expect(b.tickets.get("app/02")?.archived).toBe(true);
  expect(b.tickets.get("app/02")?.archive).toEqual({ by: "plan", reason: "the current spec no longer needs it" });
  expect(view().columns.ready.map((x) => x.id)).not.toContain("app/02");
  const restored = await werk("ticket", "restore", "app/02");
  expect(restored.stderr).toBe("");
  expect(restored.code).toBe(0);
  expect(board().tickets.get("app/02")).toMatchObject({ archived: false, column: "ready", number: "02" });
  expect(view().columns.ready.map((x) => x.id)).toContain("app/02");
  void again;
});

test("29.3 retitling a cited card blocks the ready ticket that cites it and a re-plan clears the block", async () => {
  seedMap();
  const taps = tapPrompts();
  install({
    tickets: [
      edit("tickets/app/01-a.md", t(1, "app, one", "Ticket 1 for Renamed card")),
      edit("specs/app/ticket-answers.json", "[]"),
      RESULT,
    ],
  });
  expect((await werk("plan", "app")).code).toBe(0);
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  await startServer();
  expect((await werk("propose", "one", "--title", "Renamed card")).code).toBe(0);
  expect((await werk("accept", "one", "--actor", "you")).code).toBe(0);
  const blocked = await until(() => {
    const x = board().tickets.get("app/01");
    return x?.column === "blocked" ? x : undefined;
  });
  expect(blocked.reason).toContain("#one");
  expect(blocked.reason).toContain("title changed");
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  const x = board().tickets.get("app/01");
  expect(x?.column).toBe("ready");
  expect(x?.reason).toBe("");
  expect(x?.marks).toEqual([]);
  // The writer was given the card with its new title.
  const prompts = readdirSync(taps)
    .filter((f) => f.startsWith("ticket-writer-"))
    .map((f) => ({ f, text: readFileSync(join(taps, f), "utf8") }));
  expect(prompts).toHaveLength(2);
  expect(prompts.filter((p) => p.text.includes("Renamed card"))).toHaveLength(1);
  expect(ticketFile("01-a.md")).toContain("Renamed card");
});

test("29.4 a note blocks nothing, a body change blocks the ready ticket only, never a building one", async () => {
  seedMap();
  install(null);
  expect((await werk("plan", "app")).code).toBe(0);
  // Tickets 1 and 3 both cite card one. Ticket 1 is building, ticket 3 stays ready.
  push({ type: "ticket.moved", id: "app/01", to: "building", actor: "you" });
  await startServer();
  expect((await werk("say", "one", "a thought")).code).toBe(0);
  await Bun.sleep(1500); // dwell: nothing should change, so there is no event to wait for
  let b = board();
  for (const id of ["app/01", "app/03"]) {
    expect(b.tickets.get(id)?.reason).toBe("");
    expect(b.tickets.get(id)?.marks).toEqual([]);
  }
  expect(b.tickets.get("app/01")?.column).toBe("building");
  expect(b.tickets.get("app/03")?.column).toBe("ready");
  expect((await werk("propose", "one", "--ops", JSON.stringify([{ tag: "new", new: "A new line of body." }]))).code).toBe(0);
  expect((await werk("accept", "one", "--actor", "you")).code).toBe(0);
  const blocked = await until(() => {
    const x = board().tickets.get("app/03");
    return x?.column === "blocked" ? x : undefined;
  });
  expect(blocked.reason).toContain("#one");
  expect(blocked.reason).toContain("body changed");
  b = board();
  expect(b.tickets.get("app/01")?.column).toBe("building");
  expect(b.tickets.get("app/01")?.reason).toBe("");
  expect(b.tickets.get("app/01")?.marks).toEqual([]);
});

test("29.5 a new decided card no ticket cites is reported by the cards-cited check and blocks nothing", async () => {
  seedMap();
  install(null);
  expect((await werk("plan", "app")).code).toBe(0);
  await startServer();
  await addDecidedCard("late");
  const plan = await until(() => {
    const p = board().plans.get("app");
    return p && p.uncited.length > 0 ? p : undefined;
  });
  expect(plan.uncited).toEqual(["late"]);
  for (const x of board().tickets.values()) {
    expect(x.column).toBe("ready");
    expect(x.reason).toBe("");
    expect(x.marks).toEqual([]);
  }
  expect(existsSync(boardLog())).toBe(true);
});
