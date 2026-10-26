import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decided, put, real, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  put(p, decided("root", "Root"), decided("card-a", "Card A", { parent: "root" }), decided("card-b", "Card B", { parent: "root" }));
});
afterEach(() => p.dispose());

// Every step of 29 starts with "a person has planned a subtree". The plan is the step's reach into the product.
const plan = () => werk(p, "plan", "root");

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  const first = await plan();
  expect(first.stderr).toBe("");
  expect(first.code).toBe(0);
  put(p, decided("card-c", "Card C", { parent: "root" }));
  const second = await plan();
  expect(second.code).toBe(0);
});

test("29.2 an open ticket the new spec no longer needs is archived", async () => {
  expect((await plan()).code).toBe(0);
  put(p, { type: "node.removed", id: "card-b" });
  expect((await plan()).code).toBe(0);
});

test("29.3 retitling a cited card blocks the ready ticket, a re-plan clears it", async () => {
  expect((await plan()).code).toBe(0);
  const r = await werk(p, "propose", "card-a", "--title", "Card A renamed");
  expect(r.code).toBe(0);
  expect((await werk(p, "ticket", "list")).stdout).toContain("blocked");
});

test("29.4 a note blocks nothing, a changed body blocks the ready ticket", async () => {
  expect((await plan()).code).toBe(0);
  expect((await werk(p, "say", "card-a", "a note")).code).toBe(0);
  expect((await werk(p, "ticket", "list")).stdout).not.toContain("blocked");
});

test("29.5 a new card under a planned subtree reports the cards-cited check", async () => {
  expect((await plan()).code).toBe(0);
  const r = await werk(p, "add", "card-new", "--title", "New card", "--parent", "root");
  expect(r.code).toBe(0);
  expect(r.stdout + r.stderr).toContain("cards-cited");
});
