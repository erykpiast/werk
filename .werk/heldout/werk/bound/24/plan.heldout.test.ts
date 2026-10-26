import { describe, expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import { card, werk } from "./lib.ts";

const project = useProject();

/** Every 29.x step starts from a planned subtree. A plan is a werk command; the checkout has none. */
async function plan(p: ReturnType<typeof project>) {
  card(p, "root", "Root", { status: "decided" });
  card(p, "c1", "Card one", { parent: "root", status: "decided" });
  return werk(p, "plan", "root");
}

describe("29 second plan", () => {
  for (const id of ["29.1", "29.2", "29.3", "29.4", "29.5"]) {
    test(`${id} needs a first plan of the subtree`, async () => {
      const p = project();
      const first = await plan(p);
      expect(first.stderr).not.toMatch(/unknown verb/);
      expect(first.code).toBe(0);
      const board = await werk(p, "board");
      expect(board.stderr).not.toMatch(/unknown verb/);
    });
  }
});
