import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { decided, events, ok, seed } from "./util.ts";

// Deciding needs who, a basis, an option and a kill criterion. "Storage" is seeded as a real DECIDED card
// so it is the decided basis (the parent) of the ghost; the agent supplies option, kill and who as held facts.
test("63.3 an accept takes the ghost's options and sources; status and who work on a ghost", async () => {
  const p = freshProject();
  seed(p, decided("storage", { title: "Storage" }));
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--why", "x"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Too heavy"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "SQLite is fast"]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["edit", "sqlite", "--who", "you"]);
  await ok(p, ["status", "sqlite", "decided"]); // throws on a refusal
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const show = (await ok(p, ["show", "sqlite"])).out;
  expect(show).toMatch(/^card sqlite {2}\[decided\]\n/);
  expect(show).toContain("who: you");
  expect(show).toMatch(/-> supported_by +bench +Benchmark notes\n/);
  expect(show).not.toContain("held");
  const opt = (await ok(p, ["show", "sqlite:opt0"])).out;
  expect(opt).toMatch(/^option sqlite:opt0 {2}\[open\]\n/);
  expect(opt).toContain("why not: Too heavy");
  const src = (await ok(p, ["show", "bench"])).out;
  expect(src).toMatch(/^source bench {2}\[open\]\n/);
  expect(src).toMatch(/<- supported_by +sqlite +Use SQLite\n/);
  expect(events(p).filter((e) => e.type === "change.accepted").map((e) => e.payload.id).sort()).toEqual(["bench", "sqlite", "sqlite:opt0"]);
}, 60000);
