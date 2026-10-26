// say and inbox at the command-line seam (#werk-v0-seams, #werk-cli-notes), with the thread that a
// discard and a new proposal keep (#werk-propose-new-discard-thread).
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../test/project.ts";

const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
const lineCount = (project: Project) => readFileSync(logOf(project), "utf8").split("\n").filter(Boolean).length;

/** Appends a note the person typed in the map, as the map's own write would. */
function personSays(project: Project, id: string, text: string): void {
  const seq = lineCount(project) + 1;
  const event = { seq, at: "t", actor: "you", type: "note.added", payload: { id, text } };
  appendFileSync(logOf(project), `${JSON.stringify(event)}\n`);
}

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

test("say adds a note that the thread of the card shows", async () => {
  const project = withRoot();
  const said = await ok(project, ["say", "#root", "The root holds every card."]);
  expect(said.out).toBe("root: note [2] written\n");
  const show = await ok(project, ["show", "root"]);
  expect(show.out).toEndWith("\nThread\n  [2] agent: The root holds every card.\n");
});

test("say takes a note on an excerpt, and refuses an unknown id or empty text", async () => {
  const project = withRoot();
  const excerpt = {
    seq: 2,
    at: "t",
    actor: "agent",
    type: "excerpt.quoted",
    payload: {
      id: "q",
      title: "Q",
      card: "root",
      conversation: "c",
      session: "s",
      message: 0,
      start: 0,
      end: 1,
      speaker: "person",
      said_at: "t",
    },
  };
  appendFileSync(logOf(project), `${JSON.stringify(excerpt)}\n`);
  await ok(project, ["say", "q", "Is this the right quote?"]);
  const unknown = await project.werk(["say", "nowhere", "Hi"]);
  expect(unknown).toMatchObject({ code: 1, err: "werk say: refused: unknown node #nowhere\n" });
  const empty = await project.werk(["say", "root", ""]);
  expect(empty).toMatchObject({ code: 1, err: "werk say: refused: a note needs text\n" });
  expect(lineCount(project)).toBe(3);
});

test("inbox prints the person's notes after --since, at most -n of them", async () => {
  const project = withRoot();
  personSays(project, "root", "one");
  await ok(project, ["say", "root", "an agent reply"]);
  personSays(project, "root", "two");
  personSays(project, "root", "three");
  const all = await ok(project, ["inbox"]);
  expect(all.out).toBe("[2] #root  Root\n    one\n[4] #root  Root\n    two\n[5] #root  Root\n    three\n");
  const after = await ok(project, ["inbox", "--since", "2", "-n", "1"]);
  expect(after.out).toBe("[4] #root  Root\n    two\n");
  const bad = await project.werk(["inbox", "-n", "0"]);
  expect(bad.code).toBe(2);
  expect(bad.err).toContain("-n is a count of at least 1");
});

test("a discard and a new proposal keep the earlier notes, with one marker between old and new", async () => {
  const project = withRoot();
  await ok(project, ["add", "x", "--title", "Export is its own command", "--parent", "root"]);
  personSays(project, "x", "Say what the export writes.");
  await ok(project, ["discard", "x"]);
  await ok(project, ["add", "x", "--title", "Export writes every order as one file", "--parent", "root"]);
  personSays(project, "x", "Better.");
  const show = await ok(project, ["show", "x"]);
  expect(show.out).toEndWith(
    [
      "Thread",
      "  [3] you: Say what the export writes.",
      "  [5] --- proposed again: the notes above were about the earlier words ---",
      "  [6] you: Better.",
      "",
    ].join("\n"),
  );
  const inbox = await ok(project, ["inbox"]);
  expect(inbox.out).toBe(
    [
      "[3] #x  Export writes every order as one file  (on earlier words, proposed again since)",
      "    Say what the export writes.",
      "[6] #x  Export writes every order as one file",
      "    Better.",
      "",
    ].join("\n"),
  );
});
