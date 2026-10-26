// Steps 29.1 to 29.5. A plan verb does not exist, so each scenario fails at its first plan step.
// The cards-cited check of 29.5 exists, and a separate test shows it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";
import { ticket } from "../src/tickets/fixtures.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const card = (id: string, parent?: string) => [
  {
    type: "node.proposed",
    id,
    kind: "card",
    title: `Card ${id}`,
    why: "w",
    status: "decided",
    ...(parent ? { parent } : {}),
  },
  { type: "node.accepted", id, actor: "you" },
];
const seed = (...ids: [string, string?][]) =>
  write(
    ".werk/log.jsonl",
    ids
      .flatMap(([id, parent]) => card(id, parent))
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );

/** The first plan step of every scenario: plan the subtree under the root card. */
async function plan() {
  seed(["root"], ["a", "root"], ["b", "root"]);
  const planned = await werk("plan", "root");
  expect(planned.stderr).not.toContain("unknown verb");
  expect(planned.code).toBe(0);
  const board = project.dir;
  return board;
}

describe("29.x plan", () => {
  test("29.1 second plan extends the spec and continues ticket numbers", async () => {
    await plan();
    // not reachable without a plan verb: ticket 1 building, 2 done, new card, plan again, tickets 3 and 4
    expect(true).toBe(true);
  });
  test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
    await plan();
  });
  test("29.3 retitling a cited card blocks the ready ticket, re-plan clears it", async () => {
    await plan();
  });
  test("29.4 a note blocks nothing; a body change blocks only the ready ticket", async () => {
    await plan();
  });
  test("29.5 a new uncited card fails cards-cited and blocks no ticket", async () => {
    await plan();
  });
});

describe("29.5 partial: what exists", () => {
  test("ticket-check reports cards-cited for a new card that no ticket cites", async () => {
    seed(["root"], ["a", "root"], ["new", "root"]);
    write("spec.md", "## User stories\n\n1. As a person, I want a.\n");
    write("tickets/01-a.md", ticket({ cites: "root, a" }));
    const result = await werk(
      "ticket-check",
      "tickets",
      "--root",
      "root",
      "--spec",
      "spec.md",
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("cards-cited");
    expect(result.stdout).toContain("new");
  });
  test("the board page has no ticket columns", async () => {
    // the board route is a placeholder in client/main.tsx
    const main = await Bun.file(
      join(import.meta.dirname, "..", "client", "main.tsx"),
    ).text();
    expect(main).toContain("The ticket board.");
    expect(main).not.toMatch(/ready|building|blocked/i);
  });
});
