import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type { Step } from "../../src/fake-agent/script.ts";
import { decided } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { ticket } from "../../src/tickets/fixtures.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const store = (...p: string[]) => join(project.dir, ".werk", ...p);
const boardLog = () => store("board.jsonl");
const board = () => readBoard(boardLog());
const append = (file: string, events: unknown[]) =>
  appendFileSync(file, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
const seed = (events: unknown[]) =>
  writeFileSync(
    project.logPath,
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );

const RESULT: Step = {
  event: {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    total_cost_usd: 0.1,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
};
const edit = (path: string, content: string): Step => ({ edit: path, content });
const spec = (stories: string[], note = "") =>
  `## Problem\n\nP. ${note}\n\n## User stories\n\n${stories.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`;
const specSteps = (text: string): Step[] => [
  edit("specs/app/spec.md", text),
  edit("specs/app/spec-answers.json", "[]"),
  RESULT,
];
const ticketSteps = (...files: [string, string][]): Step[] => [
  ...files.map(([n, t]) => edit(`tickets/app/${n}`, t)),
  edit("specs/app/ticket-answers.json", "[]"),
  RESULT,
];
const t = (title: string, stories: string, extra: Record<string, string> = {}) =>
  ticket({ title, cites: "app, c1", stories, ...extra });

function install(
  specs: Step[][],
  tickets: Step[][],
) {
  project.install({
    roles: {
      "spec-writer": { replies: specs },
      "ticket-writer": { replies: tickets },
    },
  });
}
const messages = (role: string) =>
  project
    .launches()
    .flatMap((r) => (r.kind === "message" && r.role === role ? [r.text] : []));

/** A map with the decided card app and its decided child c1. */
const baseMap = () => [...decided("app"), ...decided("c1", { parent: "app" })];

describe("plan, second run", () => {
  test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
    seed(baseMap());
    install(
      [
        specSteps(spec(["As a person, I want one."])),
        specSteps(
          spec(["As a person, I want one.", "As a person, I want two (c2)."], "c2 covered"),
        ),
      ],
      [
        ticketSteps(
          ["01-a.md", t("Ticket one", "1")],
          ["02-b.md", t("Ticket two", "1")],
          ["03-c.md", t("Ticket three", "1")],
        ),
        ticketSteps(
          ["03-c.md", t("Ticket three rewritten", "1")],
          ["04-d.md", t("Ticket four", "2", { cites: "app, c1, c2" })],
        ),
      ],
    );
    const first = await werk("plan", "app");
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    expect([...board().tickets.values()].map((x) => x.column)).toEqual([
      "ready",
      "ready",
      "ready",
    ]);
    append(boardLog(), [
      { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
      { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
      { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "app/02" },
    ]);
    const one = readFileSync(store("tickets/app/01-a.md"), "utf8");
    const two = readFileSync(store("tickets/app/02-b.md"), "utf8");
    // The person adds a new decided card under the subtree.
    append(project.logPath, decided("c2", { parent: "app" }));
    const again = await werk("plan", "app");
    expect(again.stderr).toBe("");
    expect(again.code).toBe(0);

    const b = board();
    expect(b.plans.get("app")?.tickets).toEqual([
      "app/01",
      "app/02",
      "app/03",
      "app/04",
    ]);
    expect(readdirSync(store("specs/app")).filter((f) => f.endsWith(".md"))).toEqual(["spec.md"]);
    expect(readFileSync(store("specs/app/spec.md"), "utf8")).toContain("c2");
    // The second plan's scope holds the new card.
    const planStarts = readFileSync(store("pipeline.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l))
      .filter((e) => e.step === "plan" && e.type === "step.started");
    expect(planStarts).toHaveLength(2);
    expect(planStarts[1].scope.map((x: { id: string }) => x.id)).toContain("c2");
    expect(b.tickets.get("app/03")?.title).toBe("Ticket three rewritten");
    expect(b.tickets.get("app/03")?.column).toBe("ready");
    expect(b.tickets.get("app/04")?.title).toBe("Ticket four");
    expect(b.tickets.get("app/01")).toMatchObject({ column: "building", title: "Ticket one" });
    expect(b.tickets.get("app/02")).toMatchObject({ column: "done", title: "Ticket two" });
    expect(readFileSync(store("tickets/app/01-a.md"), "utf8")).toBe(one);
    expect(readFileSync(store("tickets/app/02-b.md"), "utf8")).toBe(two);
    expect(b.tickets.size).toBe(4);
  }, 90000);

  test("29.2 an open ticket the new spec drops is archived and can be restored", async () => {
    seed(baseMap());
    install(
      [
        specSteps(spec(["As a person, I want one."])),
        specSteps(spec(["As a person, I want one."])),
      ],
      [
        ticketSteps(
          ["01-a.md", t("Ticket one", "1", { cites: "app" })],
          ["02-b.md", t("Ticket two", "1", { cites: "c1" })],
        ),
        // Card c1 is removed, so ticket 2 delivers nothing; the writer drops it with a reason.
        [
          edit("specs/app/ticket-answers.json", "[]"),
          edit(
            "specs/app/ticket-drops.json",
            JSON.stringify([
              { ticket: 2, why: "the current spec no longer needs it" },
            ]),
          ),
          RESULT,
        ],
      ],
    );
    expect((await werk("plan", "app")).code).toBe(0);
    const removed = await werk("remove", "c1", "--actor", "you");
    expect(removed.code).toBe(0);
    const again = await werk("plan", "app");
    expect(again.stderr).toBe("");
    expect(again.code).toBe(0);
    const gone = board().tickets.get("app/02");
    expect(gone?.archived).toBe(true);
    expect(gone?.archive?.reason).toContain("no longer needs");
    // The ticket verb lists no board view; the archived flag is the board's archive.
    const restored = await werk("ticket", "restore", "02", "--actor", "you");
    expect(restored.stderr).toBe("");
    expect(restored.code).toBe(0);
    const back = board().tickets.get("app/02");
    expect(back?.archived).toBe(false);
    expect(back?.number).toBe("02");
    expect(back?.column).toBe("ready");
  }, 90000);
});

/** Starts the one server of the project, so the watcher of cited cards runs. */
async function watch() {
  project.start(["bun", CLI, "serve", "--port", "0"]);
  await new Promise((r) => setTimeout(r, 2500));
}
async function until(check: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 150));
}
const planOnce = async (tickets: [string, string][] = [["01-a.md", t("Ticket one", "1")]]) => {
  seed(baseMap());
  install(
    [specSteps(spec(["As a person, I want one."])), specSteps(spec(["As a person, I want one."]))],
    [ticketSteps(...tickets), ticketSteps(...tickets.map(([n]) => [n, t("Ticket one, replanned", "1")] as [string, string]))],
  );
  const r = await werk("plan", "app");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
};
const change = async (id: string, flags: string[]) => {
  expect((await werk("propose", id, ...flags)).code).toBe(0);
  expect((await werk("accept", id, "--actor", "you")).code).toBe(0);
};

describe("cited cards watch", () => {
  test("29.3 retitling a cited card blocks the ready ticket, and a re-plan clears the block", async () => {
    await planOnce();
    expect(board().tickets.get("app/01")?.column).toBe("ready");
    await watch();
    await change("c1", ["--title", "A brand new title"]);
    await until(() => board().tickets.get("app/01")?.column === "blocked");
    const blocked = board().tickets.get("app/01");
    expect(blocked?.column).toBe("blocked");
    expect(blocked?.reason).toContain("c1");
    expect(blocked?.reason).toContain("title changed");
    await werk("plan", "app");
    const after = board().tickets.get("app/01");
    expect(after?.column).toBe("ready");
    expect(after?.marks).toEqual([]);
    const starts = readFileSync(store("pipeline.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l))
      .filter((e) => e.step === "plan" && e.type === "step.started");
    expect(starts).toHaveLength(2);
  }, 90000);

  test("29.4 a note blocks nothing, a body change blocks the ready ticket and never the building one", async () => {
    await planOnce([
      ["01-a.md", t("Ticket one", "1", { cites: "app, c1" })],
      ["02-b.md", t("Ticket two", "1", { cites: "app, c1" })],
    ]);
    append(boardLog(), [
      { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
    ]);
    await watch();
    expect((await werk("say", "c1", "just a note")).code).toBe(0);
    await new Promise((r) => setTimeout(r, 3000));
    for (const id of ["app/01", "app/02"]) {
      expect(board().tickets.get(id)?.reason).toBe("");
    }
    expect(board().tickets.get("app/01")?.column).toBe("ready");
    expect(board().tickets.get("app/02")?.column).toBe("building");
    await change("c1", [
      "--ops",
      JSON.stringify([{ tag: "new", new: "A new body paragraph." }]),
    ]);
    await until(() => board().tickets.get("app/01")?.column === "blocked");
    const ready = board().tickets.get("app/01");
    expect(ready?.column).toBe("blocked");
    expect(ready?.reason).toContain("c1");
    expect(ready?.reason).toContain("body changed");
    const building = board().tickets.get("app/02");
    expect(building?.column).toBe("building");
    expect(building?.reason).toBe("");
  }, 90000);

  test("29.5 a new card nobody cites reports a failed cards-cited check and blocks nothing", async () => {
    await planOnce([
      ["01-a.md", t("Ticket one", "1", { cites: "app, c1" })],
      ["02-b.md", t("Ticket two", "1", { cites: "app, c1" })],
    ]);
    await watch();
    append(project.logPath, decided("c9", { parent: "app" }));
    await until(() => (board().plans.get("app")?.uncited ?? []).length > 0);
    expect(board().plans.get("app")?.uncited).toEqual(["c9"]);
    for (const id of ["app/01", "app/02"]) {
      expect(board().tickets.get(id)?.column).toBe("ready");
      expect(board().tickets.get(id)?.reason).toBe("");
    }
  }, 90000);
});
