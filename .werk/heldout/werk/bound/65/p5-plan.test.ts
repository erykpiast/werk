import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import type { Script, Step } from "../src/fake-agent/script.ts";
import { decided, link } from "../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { ticket } from "../src/tickets/fixtures.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
setDefaultTimeout(60000);
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const boardLog = () => join(project.dir, ".werk", "board.jsonl");
const board = () => readBoard(boardLog());
const jl = (...events: unknown[]) =>
  events.flat().map((e) => `${JSON.stringify(e)}\n`).join("");
const seed = (...events: unknown[]) => writeFileSync(project.logPath, jl(...events));
const mapAppend = (...events: unknown[]) => appendFileSync(project.logPath, jl(...events));
const boardAppend = (...events: unknown[]) => appendFileSync(boardLog(), jl(...events));

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
const spec = (stories: number, extra = "") =>
  `## Problem\n\nP. ${extra}\n\n## User stories\n\n${Array.from({ length: stories }, (_, i) => `${i + 1}. As a person, I want ${i + 1}.`).join("\n")}\n`;
const specSteps = (text: string): Step[] => [
  edit("specs/app/spec.md", text),
  edit("specs/app/spec-answers.json", "[]"),
  RESULT,
];
const tk = (n: number, cites: string, stories = "1", title = `Ticket ${n}`) =>
  ticket({ title, cites, stories });
const tkSteps = (files: [string, string][], drops?: unknown): Step[] => [
  ...files.map(([name, text]) => edit(`tickets/app/${name}`, text)),
  ...(drops === undefined ? [] : [edit("specs/app/ticket-drops.json", JSON.stringify(drops))]),
  edit("specs/app/ticket-answers.json", "[]"),
  RESULT,
];
const script = (specs: Step[][], tickets: Step[][]): Script => ({
  roles: {
    "spec-writer": { replies: specs },
    "ticket-writer": { replies: tickets },
  },
});
const specText = () => readFileSync(join(project.dir, ".werk/specs/app/spec.md"), "utf8");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });
}
/** The server of the project: it holds the watcher of cited cards. */
async function startServer() {
  const port = await freePort();
  project.start(["bun", CLI, "serve", "--port", String(port)]);
  const end = Date.now() + 20000;
  for (;;) {
    const r = await fetch(`http://127.0.0.1:${port}/api/projects`).catch(() => null);
    if (r?.ok) return;
    if (Date.now() > end) throw new Error("server did not start");
    await Bun.sleep(100);
  }
}
async function until(check: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await Bun.sleep(100);
  }
  return true;
}

const mapEvents = () => [
  ...decided("app"),
  ...decided("one"),
  link("one", "app", "refines"),
];
const refine = (id: string) => link(id, "app", "refines");

test("29.1 a second plan extends the spec, keeps ticket numbers and leaves building and done tickets alone", async () => {
  seed(mapEvents());
  project.install(
    script(
      [specSteps(spec(1)), specSteps(spec(2, "Now covers two."))],
      [
        tkSteps([["01-a.md", tk(1, "app,one")], ["02-b.md", tk(2, "app,one")], ["03-c.md", tk(3, "app,one")]]),
        tkSteps([
          ["03-c.md", tk(3, "app,one", "1", "Ticket 3 rewritten")],
          ["04-d.md", tk(4, "app,two", "2")],
        ]),
      ],
    ),
  );
  const first = await werk("plan", "app");
  expect(first.code, first.stderr + first.stdout).toBe(0);
  boardAppend(
    { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "app/02" },
  );
  expect(board().tickets.get("app/01")?.column).toBe("building");
  expect(board().tickets.get("app/02")?.column).toBe("done");
  mapAppend(decided("two"), refine("two"));
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const b = board();
  expect([...b.plans.keys()]).toEqual(["app"]);
  expect(specText()).toContain("Now covers two.");
  expect(b.tickets.get("app/03")).toMatchObject({ title: "Ticket 3 rewritten", column: "ready" });
  expect(b.tickets.get("app/04")).toMatchObject({ title: "Ticket 4", column: "ready" });
  expect([...b.tickets.keys()].sort()).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(b.tickets.get("app/01")).toMatchObject({ title: "Ticket 1", column: "building" });
  expect(b.tickets.get("app/02")).toMatchObject({ title: "Ticket 2", column: "done" });
  expect(readFileSync(join(project.dir, ".werk/tickets/app/01-a.md"), "utf8")).toBe(tk(1, "app,one"));
  expect(readFileSync(join(project.dir, ".werk/tickets/app/02-b.md"), "utf8")).toBe(tk(2, "app,one"));
});

test("29.2 an open ticket the new spec no longer needs is archived with a reason and can be restored", async () => {
  seed(mapEvents(), decided("two"), refine("two"));
  project.install(
    script(
      [specSteps(spec(2)), specSteps(spec(1))],
      [
        tkSteps([["01-a.md", tk(1, "app,one")], ["02-b.md", tk(2, "app,two", "2")]]),
        tkSteps([], [{ ticket: 2, why: "the current spec no longer needs it" }]),
      ],
    ),
  );
  expect((await werk("plan", "app")).code).toBe(0);
  expect(board().tickets.get("app/02")?.column).toBe("ready");
  // The person removes the card that ticket 2 delivers.
  const removed = await werk("remove", "two", "--actor", "you");
  expect(removed.code, removed.stderr).toBe(0);
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  const t = board().tickets.get("app/02");
  expect(t?.archived).toBe(true);
  expect(t?.archive?.reason).toContain("no longer needs");
  expect(board().tickets.get("app/01")?.archived).toBe(false);
  const restored = await werk("ticket", "restore", "02", "--actor", "you");
  expect(restored.code, restored.stderr).toBe(0);
  expect(board().tickets.get("app/02")).toMatchObject({ archived: false, column: "ready" });
});

async function planOnce(titleCites: string) {
  seed(mapEvents());
  project.install(
    script(
      [specSteps(spec(1)), specSteps(spec(1))],
      [
        tkSteps([["01-a.md", tk(1, titleCites)], ["02-b.md", tk(2, titleCites)]]),
        // A re-plan: the writer rewrites ticket 1 so its text cites the card with the new title.
        tkSteps([["01-a.md", tk(1, titleCites, "1", "Ticket 1 again")]]),
      ],
    ),
  );
  const r = await werk("plan", "app");
  expect(r.code, r.stderr).toBe(0);
  await startServer();
}

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  await planOnce("app,one");
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  const p = await werk("propose", "one", "--title", "A new title for one");
  expect(p.code, p.stderr).toBe(0);
  const a = await werk("accept", "one", "--actor", "you");
  expect(a.code, a.stderr).toBe(0);
  const seen = await until(() => board().tickets.get("app/01")?.column === "blocked");
  const t = board().tickets.get("app/01");
  expect(seen, `column ${t?.column}`).toBe(true);
  expect(t?.reason).toContain("#one");
  expect(t?.reason).toMatch(/title changed/);
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  const after = board().tickets.get("app/01");
  expect(after?.column).toBe("ready");
  expect(after?.reason).toBe("");
  expect(readFileSync(join(project.dir, ".werk/tickets/app/01-a.md"), "utf8")).toContain("cites: app,one");
});

test("29.4 a note blocks nothing, a changed body blocks the ready ticket but never a building one", async () => {
  await planOnce("app,one");
  boardAppend({ type: "ticket.moved", id: "app/02", to: "building", actor: "you" });
  const note = await werk("say", "one", "a remark");
  expect(note.code, note.stderr).toBe(0);
  await Bun.sleep(1500);
  for (const id of ["app/01", "app/02"]) {
    expect(board().tickets.get(id)?.reason, id).toBe("");
  }
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  expect(board().tickets.get("app/02")?.column).toBe("building");
  const p = await werk("propose", "one", "--ops", JSON.stringify([{ tag: "new", new: "A new sentence of the body." }]));
  expect(p.code, p.stderr).toBe(0);
  const a = await werk("accept", "one", "--actor", "you");
  expect(a.code, a.stderr).toBe(0);
  const seen = await until(() => board().tickets.get("app/01")?.column === "blocked");
  const ready = board().tickets.get("app/01");
  expect(seen, `column ${ready?.column}`).toBe(true);
  expect(ready?.reason).toContain("#one");
  expect(ready?.reason).toMatch(/body changed/);
  const building = board().tickets.get("app/02");
  expect(building?.column).toBe("building");
  expect(building?.reason).toBe("");
});

test("29.5 a new card that no ticket cites fails the cards-cited check and blocks nothing", async () => {
  await planOnce("app,one");
  mapAppend(decided("extra"), refine("extra"));
  const seen = await until(() => (board().plans.get("app")?.uncited ?? []).length > 0);
  const b = board();
  expect(seen).toBe(true);
  expect(b.plans.get("app")?.uncited).toEqual(["extra"]);
  for (const id of ["app/01", "app/02"]) {
    expect(b.tickets.get(id)?.column).toBe("ready");
    expect(b.tickets.get(id)?.reason).toBe("");
  }
  // "werk reports": a person asks werk for the check through the command line.
  const check = await werk("ticket-check", join(project.dir, ".werk/tickets/app"), "--root", "app", "--spec", join(project.dir, ".werk/specs/app/spec.md"));
  expect(check.stdout + check.stderr).toContain("cards-cited");
  expect(check.stdout + check.stderr).toContain("extra");
});
