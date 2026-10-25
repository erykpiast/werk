import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);

const spoken = (text: string, extra: Record<string, unknown> = {}) => ({
  speaker: "person",
  at: "10:02",
  session: "6ae61be7",
  kind: "spoken",
  text,
  ...extra,
});
const chat = (name: string, ...lines: unknown[]) => {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.jsonl`),
    lines
      .map((l) => `${typeof l === "string" ? l : JSON.stringify(l)}\n`)
      .join(""),
  );
};
const withCard = async () => {
  await werk("add", "x", "--title", "We charge per seat");
};

test("a quote that occurs once writes one event, and show prints the words, speaker and span", async () => {
  await withCard();
  chat(
    "pricing",
    spoken("do we bill per seat?"),
    { kind: "tool_result", text: "seats are the unit we bill" },
    spoken("yes: seats are the unit we bill"),
  );
  const result = await werk(
    "quote",
    "#x",
    "pricing",
    "seats are the unit we bill",
  );
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe(
    "x:ex0: proposed, supports x: conversation pricing, message 2, span 5..31",
  );
  expect(project.events()).toHaveLength(2);
  const shown = (await werk("show", "x:ex0")).stdout;
  expect(shown).toContain("seats are the unit we bill");
  expect(shown).toContain("said by person at 10:02");
  expect(shown).toContain("session 6ae61be7, message 2, span 5..31");
  expect((await werk("show", "x")).stdout).toContain(
    "Say:\n  person: seats are the unit we bill",
  );
});

test("the words may come with --text, and a second quote takes the next id", async () => {
  await withCard();
  chat("c", spoken("alpha beta"), spoken("gamma"));
  expect((await werk("quote", "x", "c", "--text", "alpha")).stdout).toContain(
    "x:ex0",
  );
  expect((await werk("quote", "x", "c", "gamma")).stdout).toContain("x:ex1");
});

test("a quote in two messages fails, names two messages, and appends nothing", async () => {
  await withCard();
  chat("c", spoken("a grid"), spoken("the grid"));
  const result = await werk("quote", "x", "c", "grid");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("a match in 2 messages");
  expect(project.events()).toHaveLength(1);
});

test("a quote twice in one message fails and names the count", async () => {
  await withCard();
  chat("c", spoken("the grid wins, and the grid is faster."));
  const result = await werk("quote", "x", "c", "the grid");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("2 matches in one message");
  expect(project.events()).toHaveLength(1);
});

test("text that is only in a tool result or tooling line gives no match", async () => {
  await withCard();
  chat(
    "c",
    { kind: "tool_result", text: "seats" },
    { kind: "tooling", text: "seats" },
    { kind: "tool_call", text: "seats" },
    spoken("other"),
  );
  const result = await werk("quote", "x", "c", "seats");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("no match");
  expect(project.events()).toHaveLength(1);
});

test("a matched message with no session, speaker or time is refused", async () => {
  await withCard();
  chat("c", spoken("lonely words", { session: "", at: undefined }));
  const result = await werk("quote", "x", "c", "lonely");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("no session, time");
  expect(project.events()).toHaveLength(1);
});

test("a bad conversation name, a missing chat log and an unknown card are refused", async () => {
  await withCard();
  chat("c", spoken("words"));
  const name = await werk("quote", "x", "../c", "words");
  expect([name.code, name.stderr]).toEqual([
    1,
    expect.stringContaining("not a conversation name"),
  ]);
  const none = await werk("quote", "x", "nope", "words");
  expect([none.code, none.stderr]).toEqual([
    1,
    expect.stringContaining("no chat log"),
  ]);
  const card = await werk("quote", "ghost", "c", "words");
  expect([card.code, card.stderr]).toEqual([
    1,
    expect.stringContaining("unknown-card"),
  ]);
  expect(project.events()).toHaveLength(1);
});

test("the text is given once: none or both is refused", async () => {
  await withCard();
  chat("c", spoken("words"));
  const none = await werk("quote", "x", "c");
  expect(none.code).toBe(2);
  expect(none.stderr).toContain("needs the text to quote");
  const both = await werk("quote", "x", "c", "words", "--text", "words");
  expect(both.code).toBe(2);
  expect(both.stderr).toContain("give the text once");
  expect((await werk("quote", "x")).code).toBe(2);
  expect((await werk("quote", "x", "c", "w", "extra")).code).toBe(2);
  expect((await werk("quote", "--nope", "x")).code).toBe(2);
  expect(project.events()).toHaveLength(1);
});

test("adding an excerpt by hand, and editing or retitling one, is refused", async () => {
  await withCard();
  chat("c", spoken("words here"));
  const added = await werk("add", "e", "--title", "t", "--kind", "excerpt");
  expect(added.code).not.toBe(0);
  await werk("quote", "x", "c", "words");
  const retitle = await werk("propose", "x:ex0", "--title", "other");
  expect(retitle.code).toBe(1);
  expect(retitle.stderr).toContain("excerpt");
  expect(project.events()).toHaveLength(2);
});
