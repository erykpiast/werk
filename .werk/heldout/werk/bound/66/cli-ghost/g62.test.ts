import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { card, chat, head, lines, logOf, ok, w, withRoot } from "./helpers.ts";

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = withRoot();
  card(p, "storage", "Storage");
  await ok(p, "add", "earlier", "--title", "Earlier ghost");
  const first = lines(p);
  const add = await ok(
    p,
    "add",
    "use-log",
    "--title",
    "Use a log",
    "--body",
    "Every write appends.",
    "--why",
    "History stays.",
  );
  expect(add.out).toContain("proposed");
  const second = lines(p);
  expect(second).toHaveLength(first.length + 1);
  expect(second.slice(0, first.length)).toEqual(first);
  const ghost = (await ok(p, "show", "use-log")).out;
  for (const words of ["Use a log", "Every write appends.", "History stays."]) expect(ghost).toContain(words);
  expect(ghost.split("\n")[0]).toContain("proposed");

  expect((await w(p, "accept", "use-log", "--actor", "you")).code).toBe(0);
  const third = lines(p);
  expect(third).toHaveLength(second.length + 1);
  expect(third.slice(0, second.length)).toEqual(second);
  const real = (await ok(p, "show", "use-log")).out;
  for (const words of ["Use a log", "Every write appends.", "History stays."]) expect(real).toContain(words);
  expect(real.split("\n")[0]).not.toContain("proposed");
  expect(real).not.toContain("ghost");
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = withRoot();
  await ok(p, "add", "use-log", "--title", "Use a log");
  const before = lines(p);
  const refused = await w(p, "accept", "use-log");
  expect(refused.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(await head(p, "use-log")).toContain("proposed");
  await ok(p, "accept", "use-log", "--actor", "you");
  expect(await head(p, "use-log")).not.toContain("proposed");
});

test("62.3 the words of a ghost are frozen", async () => {
  const p = withRoot();
  await ok(p, "add", "use-log", "--title", "Use a log", "--body", "Old body.");
  const before = lines(p);
  const body = await w(
    p,
    "propose",
    "use-log",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "Old body.", new: "New body." }]),
  );
  expect(body.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await w(p, "propose", "use-log", "--title", "Use an append-only log");
  expect(retitle.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const again = await w(p, "add", "use-log", "--title", "Something else");
  expect(again.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const show = (await ok(p, "show", "use-log")).out;
  expect(show).toContain("Use a log");
  expect(show.split("\n")[0]).toContain("proposed");
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = withRoot();
  await ok(p, "add", "use-log", "--title", "Use a log", "--body", "Old body.");
  await ok(p, "accept", "use-log", "--actor", "you");
  const before = lines(p);
  const retitle = await w(p, "propose", "use-log", "--title", "Use an append-only log");
  expect(retitle.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const show = (await ok(p, "show", "use-log")).out;
  expect(show).toContain("Use an append-only log");
  expect(show).not.toContain("Use a log");
  expect(readFileSync(logOf(p), "utf8").split("\n")[before.length - 2]).toContain('"Use a log"');
  await ok(
    p,
    "propose",
    "use-log",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "Old body.", new: "New body." }]),
  );
  const edited = (await ok(p, "show", "use-log")).out;
  expect(edited).toContain("New body.");
  expect(edited).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = withRoot();
  card(p, "storage", "Storage");
  chat(p, "c1", [{ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "keep the log append only" }]);
  const adds: [string, string[]][] = [
    [
      "storage:opt0",
      ["add", "storage:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"],
    ],
    ["bench", ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "writes are fast"]],
    ["storage:ex0", ["quote", "storage", "c1", "append only"]],
  ];
  for (const [, args] of adds) {
    const before = lines(p);
    const run = await ok(p, ...args);
    expect(run.out).toContain("proposed");
    const after = lines(p);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  }
  await ok(p, "link", "storage:opt0", "storage", "--type", "alternative_to");
  const option = (await ok(p, "show", "storage:opt0")).out;
  expect(option).toContain("Use Postgres");
  expect(option).toContain("why not: needs a server");
  expect(option.split("\n")[0]).toContain("proposed");
  const source = (await ok(p, "show", "bench")).out;
  expect(source).toContain("Benchmark notes");
  expect(source).toContain("finding: writes are fast");
  expect(source.split("\n")[0]).toContain("proposed");
  const excerpt = (await ok(p, "show", "storage:ex0")).out;
  expect(excerpt).toContain("append only");
  expect(excerpt.split("\n")[0]).toContain("proposed");

  await ok(p, "accept", "storage:opt0", "--actor", "you");
  const real = (await ok(p, "show", "storage:opt0")).out;
  expect(real.split("\n")[0]).not.toContain("proposed");
  expect(real).toContain("why not: needs a server");
  expect(await head(p, "bench")).toContain("proposed");
  expect(await head(p, "storage:ex0")).toContain("proposed");
});
