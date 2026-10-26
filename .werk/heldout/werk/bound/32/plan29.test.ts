import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readBoard } from "../src/board/log-store.ts";
import { decided } from "../src/map/mark-fixtures.ts";
import {
  boardPath,
  createProject,
  type Project,
  seedMap,
  werkIn,
  YOU,
} from "./cli-support.ts";

let project: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  project = createProject();
  werk = werkIn(project);
});
afterEach(() => project.dispose());

/** "Plans a subtree": the verb that plans is named in `werk help`; none is. The step needs it to plan, and to plan again. */
async function planSubtree(root: string) {
  const help = await werk("help");
  expect(help.stdout).toMatch(/^ {2}plan\s/m);
  const planned = await werk("plan", root);
  expect(planned.code).toBe(0);
}

const tickets = () => readBoard(boardPath(project)).tickets;

describe("29 second plan", () => {
  beforeEach(() =>
    seedMap(project, [
      decided("root", { title: "Root" }),
      decided("cited", { title: "Cited card", parent: "root" }),
    ]),
  );

  test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
    await planSubtree("root");
    expect([...tickets().keys()].length).toBeGreaterThanOrEqual(1);
    await werk("add", "extra", "--title", "Extra", "--parent", "root");
    await werk("accept", "extra", ...YOU);
    await planSubtree("root");
    const numbers = [...tickets().values()].map((t) => t.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
    await planSubtree("root");
    await werk("remove", "cited", ...YOU);
    await planSubtree("root");
    const archived = [...tickets().values()].filter((t) => t.archived);
    expect(archived).toHaveLength(1);
  });

  test("29.3 retitling a cited card blocks the ready ticket that cites it", async () => {
    await planSubtree("root");
    await werk("propose", "cited", "--title", "New title");
    await werk("accept", "cited", ...YOU);
    const blocked = [...tickets().values()].filter(
      (t) => t.column === "blocked",
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.reason).toContain("cited");
    expect(blocked[0]?.reason).toContain("title");
  });

  test("29.4 a note on a cited card blocks nothing, a changed body blocks the ready ticket", async () => {
    await planSubtree("root");
    await werk("say", "cited", "a note");
    expect([...tickets().values()].every((t) => t.column !== "blocked")).toBe(
      true,
    );
    await werk("propose", "cited", "--body", "new body");
    await werk("accept", "cited", ...YOU);
    const blocked = [...tickets().values()].filter(
      (t) => t.column === "blocked",
    );
    expect(blocked[0]?.reason).toContain("body");
  });

  test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
    await planSubtree("root");
    const added = await werk(
      "add",
      "fresh",
      "--title",
      "Fresh",
      "--parent",
      "root",
    );
    expect(added.stdout + added.stderr).toContain("cards-cited");
    expect(added.stdout + added.stderr).toContain("fresh");
    expect([...tickets().values()].every((t) => t.column !== "blocked")).toBe(
      true,
    );
  });
});
