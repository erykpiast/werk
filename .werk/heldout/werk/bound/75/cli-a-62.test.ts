// Held-out steps 62.1-62.5: propose, accept, frozen ghost words and retitle, through the command
// line and the log file. An excerpt enters only through a quote of a conversation.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../src/test/project.ts";
import { card, decided, isGhost, lines, logOf, ok, show, withMap } from "./cli-a-lib.ts";

/** The log grew by exactly one line at the end, and every earlier line is the same. */
function grewByOne(project: Project, before: string[]) {
  const after = lines(project);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  return JSON.parse(after.at(-1) as string);
}

const base = () =>
  withMap([card("root", "Root"), card("storage", "Storage", "root"), card("api", "API", "root"), decided("api")]);

test("62.1 An agent proposes a card and a person accepts it into the map", async () => {
  const project = base();
  let before = lines(project);
  const add = await ok(project, [
    "add",
    "use-log",
    "--title",
    "Use a log",
    "--body",
    "Every change is one line",
    "--why",
    "A log keeps history",
    "--parent",
    "storage",
  ]);
  expect(add.out).toContain("proposed");
  grewByOne(project, before);
  const ghost = (await ok(project, ["show", "use-log"])).out;
  for (const words of ["Use a log", "Every change is one line", "A log keeps history"]) expect(ghost).toContain(words);
  expect(isGhost(ghost)).toBe(true);
  before = lines(project);
  const accept = await project.werk(["accept", "use-log", "--actor", "you"]);
  expect(accept.code).toBe(0);
  grewByOne(project, before);
  const real = (await ok(project, ["show", "use-log"])).out;
  for (const words of ["Use a log", "Every change is one line", "A log keeps history"]) expect(real).toContain(words);
  expect(isGhost(real)).toBe(false);
  expect(real).not.toContain("ghost");
}, 60_000);

test("62.2 An accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const project = base();
  await ok(project, ["add", "use-log", "--title", "Use a log", "--parent", "storage"]);
  const before = lines(project);
  const refused = await project.werk(["accept", "use-log"]);
  expect(refused.code).not.toBe(0);
  expect(lines(project)).toEqual(before);
  expect(isGhost((await ok(project, ["show", "use-log"])).out)).toBe(true);
  await ok(project, ["accept", "use-log", "--actor", "you"]);
  expect(isGhost((await ok(project, ["show", "use-log"])).out)).toBe(false);
}, 60_000);

test("62.3 The words of a ghost are frozen", async () => {
  const project = base();
  await ok(project, ["add", "use-log", "--title", "Use a log", "--parent", "storage"]);
  const before = lines(project);
  const edit = await project.werk(["edit", "use-log", "--body", "A new body"]);
  expect(edit.code).not.toBe(0);
  expect(lines(project)).toEqual(before);
  const retitle = await project.werk(["retitle", "use-log", "Use an append-only log"]);
  expect(retitle.code).not.toBe(0);
  expect(lines(project)).toEqual(before);
  const again = await project.werk(["add", "use-log", "--title", "Use a database", "--parent", "storage"]);
  expect(again.code).not.toBe(0);
  expect(lines(project)).toEqual(before);
  const out = (await ok(project, ["show", "use-log"])).out;
  expect(out.split("\n")[1]).toBe("Use a log");
  expect(isGhost(out)).toBe(true);
}, 60_000);

test("62.4 A retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const project = base();
  await ok(project, ["add", "use-log", "--title", "Use a log", "--parent", "storage"]);
  await ok(project, ["accept", "use-log", "--actor", "you"]);
  const before = lines(project);
  const retitle = await project.werk(["retitle", "use-log", "Use an append-only log"]);
  expect(retitle.code).toBe(0);
  grewByOne(project, before);
  const out = (await ok(project, ["show", "use-log"])).out;
  expect(out).toContain("Use an append-only log");
  expect(out).not.toContain("Use a log");
  const earlier = before.find((line) => line.includes('"id":"use-log"') && line.includes("node.proposed"));
  expect(earlier).toContain('"title":"Use a log"');
  expect(readFileSync(logOf(project), "utf8")).toContain(earlier as string);
  await ok(project, ["edit", "use-log", "--body", "Each change is one appended line"]);
  const edited = (await ok(project, ["show", "use-log"])).out;
  expect(edited).toContain("Each change is one appended line");
  expect(edited).toContain("Use an append-only log");
}, 60_000);

test("62.5 An option, a source and an excerpt also enter as ghosts", async () => {
  const project = base();
  await ok(project, ["add", "use-log", "--title", "Use a log", "--parent", "storage"]);
  await ok(project, ["accept", "use-log", "--actor", "you"]);
  mkdirSync(join(project.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(project.dir, ".werk", "chats", "storage-talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "we keep every change in a log file" })}\n`,
  );

  let before = lines(project);
  const option = await ok(project, [
    "add",
    "use-log:opt0",
    "--kind",
    "option",
    "--title",
    "Use a database",
    "--why_not",
    "A database hides history",
  ]);
  expect(option.out).toContain("proposed");
  grewByOne(project, before);
  // The option sits under the card through its alternative_to link.
  await ok(project, ["link", "use-log:opt0", "use-log", "--type", "alternative_to"]);

  before = lines(project);
  const source = await ok(project, [
    "add",
    "log-paper",
    "--kind",
    "source",
    "--title",
    "Log paper",
    "--url",
    "https://example.com/log",
    "--finding",
    "Logs make replay simple",
  ]);
  expect(source.out).toContain("proposed");
  grewByOne(project, before);

  before = lines(project);
  // A plain add refuses an excerpt; a quote of a conversation is the way an excerpt enters.
  const quote = await ok(project, ["quote", "use-log", "storage-talk", "every change in a log file"]);
  expect(quote.out).toContain("proposed");
  const excerptEvent = grewByOne(project, before);
  const excerptId = excerptEvent.payload.id as string;

  const optionShow = (await ok(project, ["show", "use-log:opt0"])).out;
  expect(optionShow).toContain("Use a database");
  expect(optionShow).toContain("why not: A database hides history");
  expect(isGhost(optionShow)).toBe(true);
  const sourceShow = (await ok(project, ["show", "log-paper"])).out;
  for (const words of ["Log paper", "url: https://example.com/log", "finding: Logs make replay simple"]) {
    expect(sourceShow).toContain(words);
  }
  expect(isGhost(sourceShow)).toBe(true);
  const excerptShow = (await ok(project, ["show", excerptId])).out;
  for (const words of ["every change in a log file", "speaker: person", "conversation: storage-talk"]) {
    expect(excerptShow).toContain(words);
  }
  expect(isGhost(excerptShow)).toBe(true);

  await ok(project, ["accept", "use-log:opt0", "--actor", "you"]);
  const accepted = (await ok(project, ["show", "use-log:opt0"])).out;
  expect(isGhost(accepted)).toBe(false);
  expect(accepted).toContain("why not: A database hides history");
  expect(isGhost((await show(project, "log-paper")).out)).toBe(true);
  expect(isGhost((await show(project, excerptId)).out)).toBe(true);
}, 60_000);
