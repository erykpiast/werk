import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createProject,
  decide,
  events,
  mapOf,
  type Project,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const ghost = (id: string) => mapOf(p).nodes.get(id)?.proposed === true;
const pendingLink = (from: string, to: string) =>
  mapOf(p).ghostEdges.some((e) => e.from === from && e.to === to);
const liveLink = (from: string, to: string) =>
  mapOf(p).edges.some((e) => e.from === from && e.to === to);

/** The agent adds an excerpt that supports a card: add the excerpt, then link it. */
async function agentAddsExcerpt() {
  const added = await werk(
    p,
    "add",
    "said",
    "--kind",
    "excerpt",
    "--title",
    "Dana: we never lose a write",
  );
  const linked = await werk(p, "link", "card", "said", "--type", "supported_by");
  return { added, linked };
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the check mark", async () => {
  await decide(p, "card", { title: "The card", body: "its words" });
  const before = mapOf(p).nodes.get("card");
  const { added, linked } = await agentAddsExcerpt();
  expect(added.stderr).toBe("");
  expect(added.code).toBe(0);
  expect(added.stdout.trim()).toBe("proposed");
  expect(linked.code).toBe(0);

  expect(ghost("said")).toBe(true);
  expect(pendingLink("card", "said")).toBe(true);
  expect(liveLink("card", "said")).toBe(false);
  const after = mapOf(p).nodes.get("card");
  expect(after?.status).toBe(before?.status);
  expect(after?.title).toBe(before?.title);
  expect(after?.body).toBe(before?.body);
  expect(events(p).length).toBeGreaterThan(0);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  await decide(p, "card", { title: "The card" });
  const { added, linked } = await agentAddsExcerpt();
  expect(added.stderr).toBe("");
  expect(added.code).toBe(0);
  expect(linked.code).toBe(0);
  expect(ghost("said")).toBe(true);

  const accepted = await werk(p, "accept", "said", "--actor", "you");
  expect(accepted.code).toBe(0);
  expect(ghost("said")).toBe(false);
  const shown = await werk(p, "show", "card");
  expect(shown.stdout).toMatch(/supported_by\s+said/);
  expect(liveLink("card", "said")).toBe(true);
});
