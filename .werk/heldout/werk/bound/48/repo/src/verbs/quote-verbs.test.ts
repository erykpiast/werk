// quote at the command-line seam (#werk-v0-seams, #werk-excerpt): a unique quote writes one
// excerpt ghost with its pointer and its held link, and every other count refuses and writes nothing.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../test/project.ts";

const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");

const message = (kind: string, text: string, speaker = "person", at = "t") =>
  JSON.stringify({ speaker, at, session: "6ae61be7", kind, text });

/** A project with a real root card X and a chat log "pricing" of five lines. */
function withChat(): Project {
  const project = freshProject();
  const root = { seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "x", kind: "card", title: "X" } };
  appendFileSync(logOf(project), `${JSON.stringify(root)}\n`);
  mkdirSync(join(project.dir, ".werk", "chats"));
  writeFileSync(
    join(project.dir, ".werk", "chats", "pricing.jsonl"),
    [
      message("spoken", "do we bill per seat?", "person", "t0"),
      message("tool_call", "grep seats", "agent", "t1"),
      message("spoken", "the seat is the unit; seats are the unit we bill", "person", "t2"),
      message("tool_result", "seats are the unit we bill monthly", "agent", "t3"),
      message("spoken", "per seat it is, per seat", "agent", "t4"),
      "",
    ].join("\n"),
  );
  return project;
}

async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

test("a unique quote writes one excerpt ghost with its pointer, linked from the card, in one event", async () => {
  const project = withChat();
  const run = await ok(project, ["quote", "#x", "pricing", "seats are the unit we bill"]);
  expect(run.out).toBe("x:ex0: proposed, supports x: conversation pricing, message 2, span 22..48\n");
  const written = lines(project);
  expect(written).toHaveLength(2);
  expect(JSON.parse(written[1] as string)).toMatchObject({
    seq: 2,
    actor: "agent",
    type: "excerpt.quoted",
    payload: {
      id: "x:ex0",
      title: "seats are the unit we bill",
      card: "x",
      conversation: "pricing",
      session: "6ae61be7",
      message: 2,
      start: 22,
      end: 48,
      speaker: "person",
      said_at: "t2",
    },
  });
  const show = await ok(project, ["show", "x:ex0"]);
  expect(show.out).toBe(
    "excerpt x:ex0  [open]  proposed\nseats are the unit we bill\n\n  <- supported_by    x  X  (held)\n",
  );
  const second = await ok(project, ["quote", "x", "pricing", "--text", "do we bill"]);
  expect(second.out).toStartWith("x:ex1: proposed");
});

test("a quote in two messages, or twice in one message, refuses, says which, and writes nothing", async () => {
  const project = withChat();
  const before = lines(project);
  const two = await project.werk(["quote", "x", "pricing", "bill"]);
  expect(two).toMatchObject({
    code: 1,
    err: "werk quote: refused: the text occurs in 2 messages (0, 2); quote more of the sentence\n",
  });
  const twice = await project.werk(["quote", "x", "pricing", "the unit"]);
  expect(twice).toMatchObject({
    code: 1,
    err: "werk quote: refused: the text occurs 2 times in message 2; quote more of the sentence\n",
  });
  expect(lines(project)).toEqual(before);
});

test("text only in a tool call or a tool result gives no match", async () => {
  const project = withChat();
  for (const text of ["grep seats", "we bill monthly"]) {
    const run = await project.werk(["quote", "x", "pricing", text]);
    expect(run).toMatchObject({
      code: 1,
      err: "werk quote: refused: no exact match of the text in a spoken message of conversation pricing\n",
    });
  }
  expect(lines(project)).toHaveLength(1);
});

test("a quote refuses an unknown card, a missing chat log, a bad name and empty text", async () => {
  const project = withChat();
  const unknown = await project.werk(["quote", "nowhere", "pricing", "do we bill"]);
  expect(unknown).toMatchObject({ code: 1, err: "werk quote: refused: unknown node #nowhere\n" });
  const missing = await project.werk(["quote", "x", "sales", "do we bill"]);
  expect(missing.code).toBe(1);
  expect(missing.err).toStartWith("werk quote: conversation sales has no chat log at ");
  const bad = await project.werk(["quote", "x", "../pricing", "do we bill"]);
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("a conversation name is letters, digits, dots, dashes and underscores");
  const empty = await project.werk(["quote", "x", "pricing"]);
  expect(empty).toMatchObject({ code: 1, err: "werk quote: needs the text to quote\n" });
  const twice = await project.werk(["quote", "x", "pricing", "do we bill", "--text", "do we bill"]);
  expect(twice).toMatchObject({ code: 1, err: "werk quote: give the text once, as an argument or with --text\n" });
  expect(lines(project)).toHaveLength(1);
});

test("an excerpt cannot be added by hand", async () => {
  const project = withChat();
  const run = await project.werk(["add", "x:ex0", "--title", "seats are the unit we bill", "--kind", "excerpt"]);
  expect(run).toMatchObject({
    code: 1,
    err: "werk add: --kind is card, option or source. An excerpt comes only from a quote.\n",
  });
  expect(lines(project)).toHaveLength(1);
});

test("an excerpt takes a note, and goes with its citing ghost on a discard and on an accept", async () => {
  const project = withChat();
  await ok(project, ["add", "seats", "--title", "We charge per seat", "--parent", "x"]);
  await ok(project, ["quote", "seats", "pricing", "seats are the unit we bill"]);
  await ok(project, ["say", "seats:ex0", "Is this the right quote?"]);
  const discarded = await ok(project, ["discard", "seats"]);
  expect(discarded.out).toBe("seats: discarded\n  and seats:ex0  seats are the unit we bill\n");
  expect((await project.werk(["show", "seats:ex0"])).code).toBe(1);

  await ok(project, ["add", "per-seat", "--title", "We charge per seat", "--parent", "x"]);
  await ok(project, ["quote", "per-seat", "pricing", "seats are the unit we bill"]);
  const accepted = await ok(project, ["accept", "per-seat", "--actor", "you"]);
  expect(accepted.out).toBe("per-seat: accepted\n  and per-seat:ex0  seats are the unit we bill\n");
  const show = await ok(project, ["show", "per-seat"]);
  expect(show.out).toContain("  -> supported_by    per-seat:ex0  seats are the unit we bill\n");
});
