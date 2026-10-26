import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import type { Script, Step } from "../src/fake-agent/script.ts";
import { decided } from "../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { ticket } from "../src/tickets/fixtures.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => { project = createProject(); });
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const seed = (events: unknown[]) => writeFileSync(project.logPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
const appendMap = (events: unknown[]) => appendFileSync(project.logPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const board = () => readBoard(boardPath());
const RESULT: Step = { event: { type: "result", subtype: "success", is_error: false, duration_ms: 5, total_cost_usd: 0.25, usage: { input_tokens: 10, output_tokens: 20 } } };
const edit = (path: string, content: string): Step => ({ edit: path, content });
const spec = (n: number, extra = "") => `## Problem\n\nP.${extra}\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want it ${i + 1}.`).join("\n")}\n`;
const answers = edit("specs/app/ticket-answers.json", "[]");
const specAnswers = edit("specs/app/spec-answers.json", "[]");
const t = (n: number, over = {}) => ticket({ title: `Ticket ${n}`, cites: "app", stories: "1", ...over });
const files = (...f: [string, string][]): Step[] => f.map(([name, text]) => edit(`tickets/app/${name}`, text));

function install(specs: Step[][], writers: Step[][]) {
  const script: Script = { roles: { "spec-writer": { replies: specs }, "ticket-writer": { replies: writers } } };
  project.install(script);
}
const move = (id: string, to: string, actor = "loop") => appendFileSync(boardPath(), `${JSON.stringify({ type: "ticket.moved", id, to, actor })}\n`);
const tfile = (name: string) => readFileSync(join(project.dir, ".werk/tickets/app", name), "utf8");

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  seed(decided("app"));
  install(
    [[edit("specs/app/spec.md", spec(1)), edit("specs/app/spec-answers.json", "[]"), RESULT], [edit("specs/app/spec.md", spec(2, " It now covers the new card.")), specAnswers, RESULT]],
    [
      [...files(["01-a.md", t(1)], ["02-b.md", t(2)], ["03-c.md", t(3)]), answers, RESULT],
      [...files(["03-c.md", t(3, { what: "A rewritten text for ticket three." }), ], ["04-d.md", t(4, { cites: "newcard", stories: "2" })]), answers, RESULT],
    ],
  );
  expect((await werk("plan", "app")).code).toBe(0);
  expect([...board().tickets.values()].map((x) => x.column)).toEqual(["ready", "ready", "ready"]);
  move("app/01", "building", "you");
  move("app/02", "building", "you");
  move("app/02", "merging");
  appendFileSync(boardPath(), `${JSON.stringify({ type: "ticket.merge", id: "app/02" })}\n`);
  appendMap(decided("newcard", { parent: "app" }));
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const b = board();
  expect(b.plans.size).toBe(1);
  expect(existsSync(join(project.dir, ".werk/specs/app/spec.md"))).toBe(true);
  expect(readFileSync(join(project.dir, ".werk/specs/app/spec.md"), "utf8")).toContain("new card");
  expect(b.tickets.get("app/03")?.column).toBe("ready");
  expect(tfile("03-c.md")).toContain("A rewritten text for ticket three.");
  expect(b.tickets.get("app/04")?.column).toBe("ready");
  expect([...b.tickets.keys()].sort()).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(b.tickets.get("app/01")?.column).toBe("building");
  expect(b.tickets.get("app/02")?.column).toBe("done");
  expect(tfile("01-a.md")).toBe(t(1));
  expect(tfile("02-b.md")).toBe(t(2));
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  seed([...decided("app"), ...decided("feat", { parent: "app" })]);
  install(
    [[edit("specs/app/spec.md", spec(2)), specAnswers, RESULT], [edit("specs/app/spec.md", spec(1)), specAnswers, RESULT]],
    [
      [...files(["01-a.md", t(1, { cites: "app" })], ["02-b.md", t(2, { cites: "app, feat", stories: "2" })]), answers, RESULT],
      [edit("specs/app/ticket-drops.json", JSON.stringify([{ ticket: 2, why: "the current spec no longer needs it" }])), answers, RESULT],
    ],
  );
  expect((await werk("plan", "app")).code).toBe(0);
  expect((await werk("remove", "feat", "--actor", "you")).code).toBe(0);
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  const second = board().tickets.get("app/02");
  expect(second?.archived).toBe(true);
  expect(second?.archive?.reason).toContain("no longer needs it");
  const restored = await werk("ticket", "restore", "app/02", "--actor", "you");
  expect(restored.code).toBe(0);
  const back = board().tickets.get("app/02");
  expect(back?.archived).toBe(false);
  expect(back?.number).toBe("02");
});

async function serveProject() {
  const port = await new Promise<number>((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
  project.start(["bun", CLI, "serve", "--port", String(port)]);
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (await fetch(`http://127.0.0.1:${port}/api/projects`).then((r) => r.ok).catch(() => false)) return port;
    await Bun.sleep(100);
  }
  throw new Error("server did not start");
}
async function until(check: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await Bun.sleep(100);
}

async function planOnce(tickets: [string, string][] = [["01-a.md", t(1)]], second?: Step[]) {
  seed(decided("app"));
  install(
    [[edit("specs/app/spec.md", spec(1)), specAnswers, RESULT], [edit("specs/app/spec.md", spec(1)), specAnswers, RESULT]],
    [[...files(...tickets), answers, RESULT], second ?? [answers, RESULT]],
  );
  expect((await werk("plan", "app")).code).toBe(0);
}

test("29.3 retitling a cited card blocks the ready ticket, and a re-plan clears the block", async () => {
  await planOnce([["01-a.md", t(1)]], [...files(["01-a.md", t(1, { what: "Build it as the card called Fresh title says." })]), answers, RESULT]);
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  await serveProject();
  expect((await werk("propose", "app", "--title", "Fresh title")).code).toBe(0);
  expect((await werk("accept", "app", "--actor", "you")).code).toBe(0);
  await until(() => board().tickets.get("app/01")?.column === "blocked");
  const blocked = board().tickets.get("app/01");
  expect(blocked?.column).toBe("blocked");
  expect(blocked?.reason).toContain("app");
  expect(blocked?.reason).toMatch(/title|retitle/i);
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  const after = board().tickets.get("app/01");
  expect(after?.column).toBe("ready");
  expect(tfile("01-a.md")).toContain("Fresh title");
});

test("29.4 a note blocks nothing, a changed body blocks the ready ticket and never the building one", async () => {
  await planOnce([["01-a.md", t(1)], ["02-b.md", t(2, { stories: "1" })]]);
  move("app/02", "building", "you");
  await serveProject();
  expect((await werk("say", "app", "just a note")).code).toBe(0);
  await Bun.sleep(2500);
  for (const id of ["app/01", "app/02"]) expect(board().tickets.get(id)?.reason).toBe("");
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  expect(board().tickets.get("app/02")?.column).toBe("building");
  const p = await werk("propose", "app", "--ops", '[{"tag":"new","new":"A new body for the card."}]');
  expect(p.code).toBe(0);
  expect((await werk("accept", "app", "--actor", "you")).code).toBe(0);
  await until(() => board().tickets.get("app/01")?.column === "blocked");
  const ready = board().tickets.get("app/01");
  expect(ready?.column).toBe("blocked");
  expect(ready?.reason).toContain("app");
  expect(ready?.reason).toMatch(/body/i);
  const building = board().tickets.get("app/02");
  expect(building?.column).toBe("building");
  expect(building?.reason).toBe("");
});

test("29.5 a card added under a planned subtree reports a failed cards-cited check without blocking", async () => {
  await planOnce([["01-a.md", t(1)]]);
  await serveProject();
  appendMap(decided("fresh", { parent: "app", title: "A fresh card" }));
  await until(() => (board().plans.get("app")?.uncited ?? []).length > 0);
  expect(board().plans.get("app")?.uncited).toContain("fresh");
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  expect(board().tickets.get("app/01")?.reason).toBe("");
});
