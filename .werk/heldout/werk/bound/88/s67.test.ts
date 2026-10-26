import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const count = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter(Boolean).length;
const line = (text: string, speaker = "user") => JSON.stringify({ speaker, at: "t", session: "s", kind: "spoken", text });

function setup(lines: string[]): Project {
  const p = freshProject();
  appendFileSync(logOf(p), `${JSON.stringify({ seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "card", kind: "card", title: "Card" } })}\n`);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(join(p.dir, ".werk", "chats", "sess.jsonl"), lines.join("\n") + "\n");
  return p;
}

test("67.3 a quote with one changed character fails and changes nothing", async () => {
  const p = setup([line("the tool never guesses")]);
  const before = count(p);
  const r = await p.werk(["quote", "card", "sess", "the tool never gueses"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(count(p)).toBe(before);
  const find = await p.werk(["show", "card"]);
  expect(find.out).not.toContain("card:ex0");
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});

test("67.4 a quote in two messages fails and names both", async () => {
  const lines = ["a", "b", "c", "it fails instead of guessing", "d", "e", "f", "again fails instead of guessing"].map((t) => line(t));
  const p = setup(lines);
  // messages 3 and 7
  const before = count(p);
  const r = await p.werk(["quote", "card", "sess", "fails instead of guessing"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("3");
  expect(r.err).toContain("7");
  expect(r.err).toMatch(/message.*3.*7/);
  expect(count(p)).toBe(before);
  expect((await p.werk(["show", "card"])).out).not.toContain("card:ex0");
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});
