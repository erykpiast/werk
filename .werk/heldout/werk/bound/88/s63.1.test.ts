import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { card, events, ok, seed } from "./util.ts";

test("63.1 a link to a ghost is held and goes live on accept with one link event", async () => {
  const p = freshProject();
  seed(p, [card("storage", { title: "Storage" })]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--why", "x"]);
  // The agent links "Use SQLite" to "Storage" as its basis: a depends_on link.
  const link = await p.werk(["link", "sqlite", "storage", "--type", "depends_on", "--why", "SQLite is a storage choice"]);
  expect(link.err).toBe("");
  expect(link.code).toBe(0);
  const show = (await ok(p, ["show", "sqlite"])).out;
  expect(show).toMatch(/-> depends_on +storage +Storage +\(held\)/);
  const storage = (await ok(p, ["show", "storage"])).out;
  expect(storage).not.toMatch(/<- depends_on +sqlite +Use SQLite +\((ghost, )?held\)/);
  expect(storage).not.toMatch(/<- depends_on +sqlite +Use SQLite\n/);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const after = (await ok(p, ["show", "sqlite"])).out;
  expect(after).toMatch(/-> depends_on +storage +Storage\n/);
  expect(after).not.toMatch(/depends_on +storage +Storage +\(held\)/);
  const links = events(p).filter((e) => e.type === "edge.added" && e.payload.type === "depends_on" && e.payload.from === "sqlite" && e.payload.to === "storage");
  expect(links).toHaveLength(1);
}, 60000);
