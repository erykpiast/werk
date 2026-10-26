import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import type { Step } from "../src/fake-agent/script.ts";
import { decided } from "../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { CLI } from "./cli.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const board = () => readBoard(boardPath());
const seed = (events: unknown[]) => writeFileSync(project.logPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
const addBoard = (...events: unknown[]) => appendFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
const edit = (path: string, content: string): Step => ({ edit: path, content });
const RESULT: Step = { event: { type: "result", subtype: "success", is_error: false, duration_ms: 5, total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 1 } } };
const SPEC = "## Problem\n\nP.\n\n## User stories\n\n1. As a person, I want it.\n";
const SPEC2 = "## Problem\n\nP. It also covers the new card.\n\n## User stories\n\n1. As a person, I want it.\n2. As a person, I want the new card.\n";
const ANSWERS = edit("specs/app/ticket-answers.json", "[]");
const specFirst = [edit("specs/app/spec.md", SPEC), edit("specs/app/spec-answers.json", "[]"), RESULT];
const specAgain = (text: string) => [edit("specs/app/spec.md", text), edit("specs/app/spec-answers.json", "[]"), RESULT];
const t = (n: number, cites = "app, feat", stories = "1") => ticket({ title: `Ticket ${n}`, cites, stories, touches: `module ${n}` });
const tfile = (n: number) => join(project.dir, ".werk", "tickets", "app", `0${n}-t.md`);

function script(second: { spec?: Step[]; tickets: Step[] }, firstTickets: [string, string][] = [["01-t.md", t(1)], ["02-t.md", t(2)], ["03-t.md", t(3)]]) {
  project.install({
    roles: {
      "spec-writer": { replies: [specFirst, second.spec ?? specAgain(SPEC)] },
      "ticket-writer": { replies: [[...firstTickets.map(([n, text]) => edit(`tickets/app/${n}`, text)), ANSWERS, RESULT], [...second.tickets, ANSWERS, RESULT]] },
    },
  });
}
const mapSeed = () => seed([...decided("app"), ...decided("feat", { title: "Feature card", parent: "app" })]);

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  mapSeed();
  script({
    spec: specAgain(SPEC2),
    tickets: [edit("tickets/app/03-t.md", ticket({ title: "Ticket 3 rewritten", cites: "app, feat", stories: "1", touches: "module 3" })), edit("tickets/app/04-t.md", t(4, "app, newcard", "2"))],
  });
  expect((await werk("plan", "app")).code).toBe(0);
  addBoard(
    { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "app/02" },
  );
  const specBefore = readFileSync(join(project.dir, ".werk/specs/app/spec.md"), "utf8");
  const one = readFileSync(tfile(1), "utf8");
  const two = readFileSync(tfile(2), "utf8");
  appendFileSync(project.logPath, `${[...decided("newcard", { title: "New card", parent: "app" })].map((e) => JSON.stringify(e)).join("\n")}\n`);
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const b = board();
  expect(b.plans.size).toBe(1);
  const spec = readFileSync(join(project.dir, ".werk/specs/app/spec.md"), "utf8");
  expect(spec).not.toBe(specBefore);
  expect(spec).toContain("new card");
  expect(b.tickets.get("app/03")?.title).toBe("Ticket 3 rewritten");
  expect(readFileSync(tfile(3), "utf8")).toContain("Ticket 3 rewritten");
  expect(b.tickets.get("app/04")?.column).toBe("ready");
  expect([...b.tickets.keys()].sort()).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(b.tickets.get("app/01")?.column).toBe("building");
  expect(b.tickets.get("app/02")?.column).toBe("done");
  expect(readFileSync(tfile(1), "utf8")).toBe(one);
  expect(readFileSync(tfile(2), "utf8")).toBe(two);
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  mapSeed();
  script({ tickets: [edit("specs/app/ticket-drops.json", JSON.stringify([{ ticket: 3, why: "the current spec no longer needs it" }]))] });
  expect((await werk("plan", "app")).code).toBe(0);
  expect(board().tickets.get("app/03")?.column).toBe("ready");
  expect((await werk("remove", "feat", "--actor", "you")).code).toBe(0);
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  const gone = board().tickets.get("app/03");
  expect(gone?.archived).toBe(true);
  expect(gone?.archive?.reason).toBe("the current spec no longer needs it");
  const back = await werk("ticket", "restore", "3");
  expect(back.code).toBe(0);
  expect(board().tickets.get("app/03")).toMatchObject({ archived: false, column: "ready" });
});

async function freePort() {
  return await new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}
async function withServer(body: () => Promise<void>) {
  const port = await freePort();
  project.start(["bun", CLI, "serve", "--port", String(port)]);
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if ((await fetch(`http://127.0.0.1:${port}/api/projects`).catch(() => null))?.ok) break;
    await Bun.sleep(200);
  }
  await body();
}
async function until(check: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await Bun.sleep(200);
}

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  mapSeed();
  script({ tickets: [edit("tickets/app/01-t.md", t(1)), edit("tickets/app/02-t.md", t(2)), edit("tickets/app/03-t.md", t(3))] });
  expect((await werk("plan", "app")).code).toBe(0);
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  await withServer(async () => {
    expect((await werk("propose", "feat", "--title", "A new title")).code).toBe(0);
    expect((await werk("accept", "feat", "--actor", "you")).code).toBe(0);
    await until(() => board().tickets.get("app/01")?.column === "blocked");
    const one = board().tickets.get("app/01");
    expect(one?.column).toBe("blocked");
    expect(one?.reason).toContain("feat");
    expect(one?.reason).toMatch(/title/);
    const again = await werk("plan", "app");
    expect(again.stderr).toBe("");
    const after = board().tickets.get("app/01");
    expect(after?.column).toBe("ready");
    expect(after?.marks).toEqual([]);
    expect(readFileSync(tfile(1), "utf8")).toContain("feat");
  });
});

test("29.4 a note blocks nothing, a body change blocks the ready ticket and never a building one", async () => {
  mapSeed();
  script({ tickets: [] });
  expect((await werk("plan", "app")).code).toBe(0);
  addBoard({ type: "ticket.moved", id: "app/02", to: "building", actor: "you" });
  await withServer(async () => {
    expect((await werk("say", "feat", "just a thought")).code).toBe(0);
    await Bun.sleep(2500);
    expect(board().tickets.get("app/01")).toMatchObject({ column: "ready", reason: "" });
    expect(board().tickets.get("app/02")).toMatchObject({ column: "building", reason: "" });
    const proposed = await werk("propose", "feat", "--ops", JSON.stringify([{ tag: "new", new: "A new body for the card" }]));
    expect(proposed.stderr).toBe("");
    expect(proposed.code).toBe(0);
    expect((await werk("accept", "feat", "--actor", "you")).code).toBe(0);
    await until(() => board().tickets.get("app/01")?.column === "blocked");
    expect(board().tickets.get("app/01")?.column).toBe("blocked");
    expect(board().tickets.get("app/01")?.reason).toContain("feat");
    expect(board().tickets.get("app/01")?.reason).toMatch(/body/);
    expect(board().tickets.get("app/02")?.column).toBe("building");
    expect(board().tickets.get("app/02")?.reason).toBe("");
  });
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  mapSeed();
  script({ tickets: [] });
  expect((await werk("plan", "app")).code).toBe(0);
  const before = [...board().tickets.values()].map((x) => [x.id, x.column, x.reason]);
  await withServer(async () => {
    appendFileSync(project.logPath, `${[...decided("fresh", { title: "Fresh uncited card", parent: "app" })].map((e) => JSON.stringify(e)).join("\n")}\n`);
    await until(() => (board().plans.get("app")?.uncited ?? []).includes("fresh"));
    expect(board().plans.get("app")?.uncited).toContain("fresh");
    expect(existsSync(boardPath())).toBe(true);
    expect(readFileSync(boardPath(), "utf8")).toContain("fresh");
    const after = [...board().tickets.values()].map((x) => [x.id, x.column, x.reason]);
    expect(after).toEqual(before);
  });
});
