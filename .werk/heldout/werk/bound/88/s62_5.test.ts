import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, lines, ok, withMap } from "./h62util.ts";

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = withMap([card("root", "Root"), card("log", "Use a log", "root")]);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "a log never loses a write" })}\n`,
  );
  const step = async (args: string[]) => {
    const before = lines(p);
    const run = await ok(p, args);
    expect(run.out).toContain("proposed");
    const after = lines(p);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  };
  await step(["add", "log:opt0", "--kind", "option", "--title", "A table", "--why_not", "A table loses history"]);
  await step(["add", "paper", "--kind", "source", "--title", "Log paper", "--url", "http://x.test/paper", "--finding", "Logs are durable"]);
  // A plain add of an excerpt is refused: an excerpt comes only from a quote.
  await step(["quote", "log", "talk", "never loses a write"]);
  const opt = (await ok(p, ["show", "log:opt0"])).out;
  expect(opt).toContain("A table");
  expect(opt).toContain("why not: A table loses history");
  expect(opt).toContain("proposed");
  const src = (await ok(p, ["show", "paper"])).out;
  expect(src).toContain("Log paper");
  expect(src).toContain("http://x.test/paper");
  expect(src).toContain("Logs are durable");
  expect(src).toContain("proposed");
  const ex = (await ok(p, ["show", "log:ex0"])).out;
  expect(ex).toContain("never loses a write");
  expect(ex).toContain("proposed");
  expect((await p.werk(["accept", "log:opt0", "--actor", "you"])).code).toBe(0);
  const opt2 = (await ok(p, ["show", "log:opt0"])).out;
  expect(opt2).not.toContain("proposed");
  expect(opt2).toContain("why not: A table loses history");
  expect((await ok(p, ["show", "paper"])).out).toContain("proposed");
  expect((await ok(p, ["show", "log:ex0"])).out).toContain("proposed");
}, 60_000);
