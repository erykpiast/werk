// Propose, accept and discard of a change to a real card at the command-line seam (#werk-v0-seams,
// #werk-cli-propose): the cover rule, an unquoted old, an amend of a decided card, and a discard.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../test/project.ts";

const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");

const BODY = "We charge per seat.\n\n- monthly\n- yearly\n\n```sh\nwerk show x\n\nwerk accept x\n```";

/**
 * A decided root, and #seats under it with a body of three blocks. `seats` is decided with every
 * fact, unless `kill` is false: then it was decided before a kill criterion was required.
 */
function withSeats(status: "open" | "decided", kill = true): Project {
  const project = freshProject();
  const events = [
    {
      type: "node.added",
      payload: { id: "root", kind: "card", title: "Root", status: "decided", who: "me", no_basis: "the top" },
    },
    { type: "kill.added", payload: { id: "root", criterion: { form: "revisit" } } },
    {
      type: "node.added",
      payload: {
        id: "seats",
        kind: "card",
        title: "We charge per seat",
        why: "Seats track value.",
        body: BODY,
        status,
        who: "me",
        parent: "root",
      },
    },
    ...(kill ? [{ type: "kill.added", payload: { id: "seats", criterion: { form: "revisit" } } }] : []),
  ];
  appendFileSync(
    logOf(project),
    events.map((event, i) => `${JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...event })}\n`).join(""),
  );
  return project;
}

async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

const keep = (old: string) => ({ tag: "elaborated", old, new: old });
const ops = (...list: object[]) => ["--ops", JSON.stringify(list)];

test("a proposal that leaves a body block unnamed is refused and lists that block", async () => {
  const project = withSeats("decided");
  const before = lines(project);
  const run = await project.werk([
    "propose",
    "seats",
    ...ops(keep("We charge per seat."), { tag: "removed", old: "- monthly\n- yearly" }),
  ]);
  expect(run.code).toBe(1);
  expect(run.err).toBe(
    "werk propose: refused: every block of the body of #seats must be the old of an elaborated or removed op; " +
      "this block is at risk:\n    ```sh\n    werk show x\n\n    werk accept x\n    ```\n",
  );
  expect(lines(project)).toEqual(before);
  expect((await project.werk(["propose", "seats", "--ops", "[oops"])).err).toStartWith(
    "werk propose: --ops is not JSON",
  );
  expect((await project.werk(["propose", "seats"])).err).toBe("werk propose: needs --title, --why or --ops\n");
  expect(lines(project)).toEqual(before);
});

test("a quoted old that is not a real block shows as removed plus new", async () => {
  const project = withSeats("open");
  const run = await ok(project, [
    "propose",
    "seats",
    ...ops(
      { tag: "elaborated", old: "We charge per user.", new: "We charge per team." },
      keep("We charge per seat."),
      keep("- monthly\n- yearly"),
      keep("```sh\nwerk show x\n\nwerk accept x\n```"),
    ),
  ]);
  expect(run.out).toStartWith(
    "seats: proposed\npending change:\n  body:\n    [-We charge per user.-]  (not a block of the body)\n\n    {+We charge per team.+}\n\n    We charge per seat.\n",
  );
});

test("a proposal is staged: the card shows the pending change and keeps its words until the accept", async () => {
  const project = withSeats("open");
  await ok(project, ["propose", "#seats", "--title", "We charge per active seat"]);
  const show = (await ok(project, ["show", "seats"])).out;
  expect(show).toStartWith("card seats  [open]  pending change\nWe charge per seat\n");
  expect(show).toContain("pending change:\n  title: [-We charge per seat-]{+We charge per active seat+}\n");
  const accept = await ok(project, ["accept", "seats", "--actor", "you"]);
  expect(accept.out).toBe("seats: accepted\n");
  expect(JSON.parse(lines(project).at(-1) as string)).toMatchObject({ type: "change.accepted", actor: "you" });
  const after = (await ok(project, ["show", "seats"])).out;
  expect(after).toStartWith("card seats  [open]\nWe charge per active seat\n");
  expect(after).not.toContain("pending change");
});

test("accepting a proposal on a decided card leaves it decided with the new words, and records one amend", async () => {
  const project = withSeats("decided");
  await ok(project, [
    "propose",
    "seats",
    "--why",
    "Seats track the value a team gets.",
    ...ops(
      { tag: "elaborated", old: "We charge per seat.", new: "We charge per active seat." },
      { tag: "removed", old: "- monthly\n- yearly" },
      keep("```sh\nwerk show x\n\nwerk accept x\n```"),
    ),
  ]);
  const before = lines(project).length;
  const run = await ok(project, ["accept", "seats", "--actor", "you"]);
  expect(run.out).toBe("seats: accepted\n");
  const written = lines(project).slice(before);
  expect(written.map((line) => JSON.parse(line))).toMatchObject([
    { type: "change.accepted", actor: "you", payload: { id: "seats" } },
  ]);
  const show = (await ok(project, ["show", "seats"])).out;
  expect(show).toStartWith("card seats  [decided]\nWe charge per seat\nwhy: Seats track the value a team gets.\n");
  expect(show).toContain("\nWe charge per active seat.\n\n```sh\nwerk show x\n\nwerk accept x\n```\n");
  expect(show).not.toContain("monthly");
});

test("an amend that misses a required fact is refused, and the card keeps its words and its pending change", async () => {
  const project = withSeats("decided", false);
  await ok(project, ["propose", "seats", "--title", "We charge per active seat"]);
  const before = lines(project);
  const run = await project.werk(["accept", "seats", "--actor", "you"]);
  expect(run.code).toBe(1);
  expect(run.err).toStartWith(
    "werk accept: refused: #seats is decided, and after this change 1 fact is missing\n  kill criterion:",
  );
  expect(lines(project)).toEqual(before);
  expect((await ok(project, ["show", "seats"])).out).toStartWith(
    "card seats  [decided]  pending change\nWe charge per seat\n",
  );
});

test("discard drops the pending change and leaves the card as it was", async () => {
  const project = withSeats("decided");
  const before = (await ok(project, ["show", "seats"])).out;
  await ok(project, ["propose", "seats", "--title", "We charge per active seat", "--why", "Other."]);
  const logged = lines(project).length;
  const run = await ok(project, ["discard", "seats"]);
  expect(run.out).toBe("seats: discarded\n");
  expect(
    lines(project)
      .slice(logged)
      .map((line) => JSON.parse(line)),
  ).toMatchObject([{ type: "change.discarded", payload: { id: "seats" } }]);
  expect((await ok(project, ["show", "seats"])).out).toBe(before);
  expect((await project.werk(["discard", "seats"])).code).toBe(1);
});
