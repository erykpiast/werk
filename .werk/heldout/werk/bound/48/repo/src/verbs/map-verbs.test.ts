// The map verbs at the command-line seam (#werk-v0-seams): add, link, unlink, accept, discard
// and show on a fresh project, read back through the log file and through show.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../test/project.ts";

const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");

/** A project whose log holds one real root card, as a person's accepted map would. */
function withRoot(): Project {
  const project = freshProject();
  const root = {
    seq: 1,
    at: "t",
    actor: "you",
    type: "node.added",
    payload: { id: "root", kind: "card", title: "Root" },
  };
  appendFileSync(logOf(project), `${JSON.stringify(root)}\n`);
  return project;
}

async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

test("adding a card under a parent appends one event, and the card shows under its parent as a ghost", async () => {
  const project = withRoot();
  const run = await ok(project, ["add", "seats", "--title", "We charge per seat", "--parent", "#root", "--who", "me"]);
  expect(run.out).toBe("seats: proposed\n");
  const added = lines(project);
  expect(added).toHaveLength(2);
  expect(JSON.parse(added[1] as string)).toMatchObject({
    seq: 2,
    actor: "agent",
    type: "node.proposed",
    payload: { id: "seats", kind: "card", title: "We charge per seat", parent: "root", who: "me" },
  });
  const root = await ok(project, ["show", "root"]);
  expect(root.out).toContain("  <- refines         seats  We charge per seat  (ghost, held)");
  const seats = await ok(project, ["show", "seats"]);
  expect(seats.out).toStartWith("card seats  [open]  proposed\nWe charge per seat\nwho: me\nparent: root  Root\n");
});

test("a refused write appends nothing and prints the rule it breaks", async () => {
  const project = withRoot();
  await ok(project, ["add", "a", "--title", "A", "--parent", "root"]);
  const before = lines(project);
  const again = await project.werk(["add", "a", "--title", "A, reworded", "--parent", "root"]);
  expect(again.code).toBe(1);
  expect(again.err).toBe(
    "werk add: refused: a ghost's words are frozen: #a is proposed; discard it and propose it again\n",
  );
  const decided = await project.werk(["add", "b", "--title", "B", "--status", "decided"]);
  expect(decided.code).toBe(1);
  expect(decided.err).toContain("refused: a card reaches decided only through werk status");
  const excerpt = await project.werk(["add", "c", "--title", "C", "--kind", "excerpt"]);
  expect(excerpt.code).toBe(1);
  const orphan = await project.werk(["add", "d", "--title", "D", "--parent", "nowhere"]);
  expect(orphan).toMatchObject({ code: 1, err: "werk add: refused: unknown node #nowhere\n" });
  const untitled = await project.werk(["add", "e"]);
  expect(untitled).toMatchObject({ code: 1, err: "werk add: needs --title\n" });
  expect(lines(project)).toEqual(before);
});

test("a hand-inserted bad line is listed as a problem with its position, and later events still fold", async () => {
  const project = withRoot();
  appendFileSync(
    logOf(project),
    `${JSON.stringify({ seq: 2, at: "t", actor: "agent", type: "edge.added", payload: { from: "root", to: "ghost-town", type: "refines" } })}\n`,
  );
  await ok(project, ["add", "after", "--title", "After the bad line", "--parent", "root"]);
  const show = await ok(project, ["show", "after"]);
  expect(show.err).toBe("werk: log line 2 set aside: unknown node #ghost-town\n");
  expect(show.out).toContain("parent: root  Root");
  expect(JSON.parse(lines(project)[2] as string).seq).toBe(3);
});

test("a depends_on link needs a reason, and never points to an ancestor or a descendant", async () => {
  const project = withRoot();
  await ok(project, ["add", "a", "--title", "A", "--parent", "root"]);
  await ok(project, ["add", "a1", "--title", "A1", "--parent", "a"]);
  await ok(project, ["add", "b", "--title", "B", "--parent", "root"]);
  const before = lines(project);
  const bare = await project.werk(["link", "a1", "b", "--type", "depends_on"]);
  expect(bare).toMatchObject({
    code: 1,
    err: "werk link: refused: a depends_on link needs a reason: what the card takes from the other card\n",
  });
  const up = await project.werk(["link", "a1", "#a", "--type", "depends_on", "--why", "uses it"]);
  expect(up.err).toBe("werk link: refused: a depends_on link cannot point to an ancestor: #a is above #a1\n");
  const down = await project.werk(["link", "a", "a1", "--type", "depends_on", "--why", "uses it"]);
  expect(down.err).toBe("werk link: refused: a depends_on link cannot point to a descendant: #a1 is below #a\n");
  const untyped = await project.werk(["link", "a", "b"]);
  expect(untyped.code).toBe(1);
  expect(lines(project)).toEqual(before);
  const linked = await ok(project, ["link", "a1", "b", "--type", "depends_on", "--why", "A1 reads the grid of B"]);
  expect(linked.out).toBe("a1 -> b depends_on: linked, held until both ends are accepted\n");
  expect((await ok(project, ["show", "a1"])).out).toContain(
    "  -> depends_on      b  B  (ghost, held)\n       why: A1 reads the grid of B\n",
  );
  expect((await ok(project, ["unlink", "a1", "b", "--type", "depends_on"])).out).toBe("a1 -> b depends_on: unlinked\n");
  expect((await ok(project, ["show", "a1"])).out).not.toContain("depends_on");
  expect((await project.werk(["unlink", "a1", "b", "--type", "depends_on"])).code).toBe(1);
  expect((await project.werk(["unlink", "a1", "b"])).code).toBe(1);
});

test("accepting a ghost child also accepts its ghost parents, sources and options, and its held links go live", async () => {
  const project = withRoot();
  await ok(project, ["add", "mid", "--title", "Mid", "--parent", "root"]);
  await ok(project, ["add", "leaf", "--title", "Leaf", "--parent", "mid"]);
  await ok(project, ["add", "leaf:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(project, ["link", "leaf:opt0", "leaf", "--type", "alternative_to"]);
  await ok(project, ["add", "survey", "--kind", "source", "--title", "Survey", "--finding", "Most pay per seat"]);
  await ok(project, ["link", "leaf", "survey", "--type", "supported_by"]);
  await ok(project, ["add", "side", "--title", "Side", "--parent", "root"]);
  const accept = await ok(project, ["accept", "#leaf", "--actor", "you"]);
  expect(accept.out).toBe("leaf: accepted\n  and mid  Mid\n  and leaf:opt0  Other\n  and survey  Survey\n");
  const leaf = (await ok(project, ["show", "leaf"])).out;
  expect(leaf).toStartWith("card leaf  [open]\n");
  expect(leaf).toContain("  -> refines         mid  Mid\n");
  expect(leaf).toContain("  -> supported_by    survey  Survey\n");
  expect(leaf).toContain("  <- alternative_to  leaf:opt0  Other\n");
  expect((await ok(project, ["show", "side"])).out).toStartWith("card side  [open]  proposed\n");
  const accepted = lines(project)
    .slice(-4)
    .map((line) => JSON.parse(line));
  expect(accepted.map((event) => [event.type, event.actor, event.payload.id])).toEqual([
    ["change.accepted", "you", "mid"],
    ["change.accepted", "you", "leaf"],
    ["change.accepted", "you", "leaf:opt0"],
    ["change.accepted", "you", "survey"],
  ]);
  const twice = await project.werk(["accept", "leaf", "--actor", "you"]);
  expect(twice).toMatchObject({
    code: 1,
    err: "werk accept: refused: only a ghost or a pending change can be accepted: #leaf is real and has no pending change\n",
  });
});

test("accept without --actor you exits non-zero and appends nothing", async () => {
  const project = withRoot();
  await ok(project, ["add", "a", "--title", "A", "--parent", "root"]);
  const before = lines(project);
  for (const args of [
    ["accept", "a"],
    ["accept", "a", "--actor", "agent"],
  ]) {
    const run = await project.werk(args);
    expect(run.code).toBe(1);
    expect(run.err).toContain("pass --actor you");
  }
  expect(lines(project)).toEqual(before);
});

test("discarding a ghost keeps a ghost source another card cites, and drops one that only it cited", async () => {
  const project = withRoot();
  await ok(project, ["add", "C", "--title", "We charge per seat", "--parent", "root"]);
  await ok(project, ["add", "C:child", "--title", "Seats are counted monthly", "--parent", "C"]);
  await ok(project, ["add", "D", "--title", "The invoice shows the seat count", "--parent", "root"]);
  await ok(project, ["add", "S", "--kind", "source", "--title", "Pricing survey"]);
  await ok(project, ["add", "T", "--kind", "source", "--title", "Churn study"]);
  await ok(project, ["link", "C", "S", "--type", "supported_by"]);
  await ok(project, ["link", "C", "T", "--type", "supported_by"]);
  await ok(project, ["link", "D", "S", "--type", "supported_by"]);
  const discard = await ok(project, ["discard", "C"]);
  expect(discard.out).toBe("C: discarded\n  and C:child  Seats are counted monthly\n  and T  Churn study\n");
  for (const gone of ["C", "C:child", "T"]) expect((await project.werk(["show", gone])).code).toBe(1);
  expect((await ok(project, ["show", "S"])).out).toContain(
    "  <- supported_by    D  The invoice shows the seat count  (ghost, held)",
  );
  await ok(project, ["accept", "D", "--actor", "you"]);
  expect((await ok(project, ["show", "S"])).out).toStartWith("source S  [open]\n");
  await ok(project, ["add", "C", "--title", "We charge per seat, per month", "--parent", "root"]);
  expect((await project.werk(["discard", "root"])).err).toBe(
    "werk discard: refused: only a ghost or a pending change can be discarded: #root is real and has no pending change\n",
  );
});

test("show refuses a node the map does not hold", async () => {
  const project = withRoot();
  expect(await project.werk(["show", "nope"])).toMatchObject({ code: 1, err: "werk show: no node #nope in the map\n" });
});
