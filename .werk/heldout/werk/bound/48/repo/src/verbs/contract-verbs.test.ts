// The contract check at the command-line seam (#werk-v0-seams): status, edit and kill on a fresh
// project, read back through the log file and through show (#werk-cli-decide, #werk-cli-edit).
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../test/project.ts";

const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");

/** A project whose log holds one real root card, decided with its facts, as an accepted map would. */
function withRoot(): Project {
  const project = freshProject();
  const root = { id: "root", kind: "card", title: "Root", status: "decided", who: "me", no_basis: "the top" };
  appendFileSync(
    logOf(project),
    `${JSON.stringify({ seq: 1, at: "t", actor: "you", type: "node.added", payload: root })}\n` +
      `${JSON.stringify({ seq: 2, at: "t", actor: "you", type: "kill.added", payload: { id: "root", criterion: { form: "revisit" } } })}\n`,
  );
  return project;
}

async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

test("deciding a bare card is refused once, naming who, basis, option and kill criterion with their fixes", async () => {
  const project = withRoot();
  await ok(project, ["add", "x", "--title", "We charge per seat"]);
  const before = lines(project);
  const run = await project.werk(["status", "#x", "decided"]);
  expect(run.code).toBe(1);
  expect(run.err).toBe(
    [
      "werk status: refused: #x cannot be decided: 4 facts are missing",
      "  who: no one is named to decide #x",
      "    werk edit x --who you|me|prototype",
      "  basis: no decided card is a basis of #x",
      '    werk link x <card> --type depends_on --why "<what x takes from <card>>"',
      '    or: werk edit x --no-basis "<why no decided card is a basis of x>"',
      "  option: no option was weighed against #x, and its who is not set",
      '    werk add x:opt0 --kind option --title "<the option>" --why_not "<why it lost>"',
      "    then: werk link x:opt0 x --type alternative_to",
      '    or: werk edit x --unchallenged "<why no option was weighed against x>"',
      "  kill criterion: no kill criterion is on record for #x",
      '    werk kill x --metric "<metric>" --source "<source>" --threshold "<threshold>" --window "<window>"',
      '    or: werk kill x --manual "<the test you run>"',
      '    or: werk kill x --no-metric "<why no metric applies>"',
      "    or: werk kill x --revisit",
      "",
    ].join("\n"),
  );
  expect(lines(project)).toEqual(before);
  expect((await project.werk(["status", "x", "open"])).code).toBe(1);
});

test("a card with who me needs no option; a card with who you does", async () => {
  const project = withRoot();
  await ok(project, ["add", "m", "--title", "M", "--parent", "root", "--who", "me"]);
  await ok(project, ["kill", "m", "--revisit"]);
  expect((await ok(project, ["status", "m", "decided"])).out).toBe("m: decided\n");
  expect((await ok(project, ["show", "m"])).out).toStartWith("card m  [decided]  proposed\n");

  await ok(project, ["add", "y", "--title", "Y", "--parent", "root", "--who", "you"]);
  await ok(project, ["kill", "y", "--no-metric", "cheap to undo"]);
  const refused = await project.werk(["status", "y", "decided"]);
  expect(refused.err).toStartWith("werk status: refused: #y cannot be decided: 1 fact is missing\n  option: ");
  await ok(project, ["add", "y:opt0", "--kind", "option", "--title", "Flat fee", "--why_not", "Big teams underpay"]);
  await ok(project, ["link", "y:opt0", "y", "--type", "alternative_to"]);
  await ok(project, ["status", "y", "decided"]);
});

test("a waiver with an empty reason is refused; a waiver with a reason prints on the card", async () => {
  const project = withRoot();
  await ok(project, ["add", "t", "--title", "T"]);
  const before = lines(project);
  for (const flag of ["--no-basis", "--unchallenged"]) {
    const run = await project.werk(["edit", "t", flag, ""]);
    expect(run.code).toBe(1);
    expect(run.err).toContain("a waiver needs a written reason");
  }
  expect((await project.werk(["edit", "t"])).err).toBe("werk edit: needs --who, --no-basis or --unchallenged\n");
  expect(lines(project)).toEqual(before);
  await ok(project, ["edit", "t", "--who", "you", "--no-basis", "root of a tree"]);
  await ok(project, ["edit", "t", "--unchallenged", "no real choice"]);
  await ok(project, ["kill", "t", "--manual", "I use it every week"]);
  await ok(project, ["status", "t", "decided"]);
  expect((await ok(project, ["show", "t"])).out).toBe(
    [
      "card t  [decided]  proposed",
      "T",
      "who: you",
      "basis waived: root of a tree",
      "option waived: no real choice",
      "kill criteria:",
      "  1. manual test: I use it every week",
      "",
    ].join("\n"),
  );
});

test("a card on an open basis is refused, and the message names the basis", async () => {
  const project = withRoot();
  await ok(project, ["add", "b", "--title", "B", "--parent", "root"]);
  await ok(project, ["add", "c", "--title", "C", "--parent", "root", "--who", "me"]);
  await ok(project, ["link", "c", "b", "--type", "depends_on", "--why", "C reads the grid of B"]);
  await ok(project, ["kill", "c", "--revisit"]);
  const run = await project.werk(["status", "c", "decided"]);
  expect(run.code).toBe(1);
  expect(run.err).toBe(
    [
      "werk status: refused: #c cannot be decided: 1 fact is missing",
      "  basis: #c waits on its basis: #b is open",
      "    werk status b decided",
      "",
    ].join("\n"),
  );
});

test("removing the last option of a decided card is refused; a kill criterion on an old decided card is allowed", async () => {
  const project = withRoot();
  await ok(project, ["add", "q", "--title", "Q", "--parent", "root", "--who", "you"]);
  await ok(project, ["add", "q:opt0", "--kind", "option", "--title", "O", "--why_not", "Slower"]);
  await ok(project, ["link", "q:opt0", "q", "--type", "alternative_to"]);
  await ok(project, ["kill", "q", "--revisit"]);
  await ok(project, ["status", "q", "decided"]);
  await ok(project, ["accept", "q", "--actor", "you"]);
  const before = lines(project);
  const unlink = await project.werk(["unlink", "q:opt0", "q", "--type", "alternative_to"]);
  expect(unlink.code).toBe(1);
  expect(unlink.err).toStartWith("werk unlink: refused: #q is decided, and this change removes a fact it has\n");
  expect(lines(project)).toEqual(before);

  // An old card, decided before kill criteria were required, receives one.
  const old = { id: "old", kind: "card", title: "Old", status: "decided", who: "me", parent: "root" };
  appendFileSync(
    logOf(project),
    `${JSON.stringify({ seq: before.length + 1, at: "t", actor: "you", type: "node.added", payload: old })}\n`,
  );
  const metric = ["--metric", "install time", "--source", "PostHog", "--threshold", "> 4 min", "--window", "7 days"];
  expect((await ok(project, ["kill", "old", ...metric])).out).toBe(
    "old: kill criterion recorded: metric: install time, from PostHog, threshold > 4 min, window 7 days\n",
  );
  expect((await project.werk(["kill", "old", "--metric", "install time"])).err).toBe(
    "werk kill: refused: a metric kill criterion needs its source\n",
  );
  expect((await project.werk(["kill", "old", "--revisit", "--manual", "x"])).code).toBe(1);
});

test("a ghost with held edges, options and a kill criterion is set decided and commits decided on accept", async () => {
  const project = withRoot();
  await ok(project, ["add", "dep", "--title", "Dep", "--parent", "root", "--who", "me"]);
  await ok(project, ["kill", "dep", "--revisit"]);
  await ok(project, ["status", "dep", "decided"]);
  await ok(project, ["accept", "dep", "--actor", "you"]);
  await ok(project, ["add", "g", "--title", "G", "--parent", "root", "--who", "you"]);
  await ok(project, ["link", "g", "dep", "--type", "depends_on", "--why", "G reads the seats of Dep"]);
  await ok(project, ["add", "g:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(project, ["link", "g:opt0", "g", "--type", "alternative_to"]);
  await ok(project, ["kill", "g", "--revisit"]);
  await ok(project, ["status", "g", "decided"]);
  expect((await ok(project, ["accept", "g", "--actor", "you"])).out).toBe("g: accepted\n  and g:opt0  Other\n");
  const shown = (await ok(project, ["show", "g"])).out;
  expect(shown).toStartWith("card g  [decided]\n");
  expect(shown).toContain("  -> depends_on      dep  Dep\n");
  expect(shown).toContain("  <- alternative_to  g:opt0  Other\n");
});
