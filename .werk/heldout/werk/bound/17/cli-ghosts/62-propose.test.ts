// Held-out 62.x: an agent proposes, the person accepts.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { head, project } from "./helpers.ts";

const seeded = () =>
  project([
    { id: "root", title: "Root" },
    { id: "a", title: "A", parent: "root" },
    { id: "b", title: "B", parent: "root" },
  ]);

test("62.1 an agent proposes a card and a person accepts it into the map", () => {
  const p = seeded();
  const lines0 = p.rawLines();
  const add = p.ok("add", "log", "--title", "Use a log", "--body", "One file per map.", "--why", "Replay is easy.");
  expect(add.out).toContain("proposed");
  const lines1 = p.rawLines();
  expect(lines1.length).toBe(lines0.length + 1);
  expect(lines1.slice(0, lines0.length)).toEqual(lines0);
  const ghost = p.show("log");
  expect(ghost).toContain("Use a log");
  expect(ghost).toContain("One file per map.");
  expect(ghost).toContain("why: Replay is easy.");
  expect(head(ghost)).toContain("proposed");

  const accept = p.werk("accept", "log", "--actor", "you");
  expect(accept.code).toBe(0);
  const lines2 = p.rawLines();
  expect(lines2.length).toBe(lines1.length + 1);
  expect(lines2.slice(0, lines1.length)).toEqual(lines1);
  const real = p.show("log");
  expect(real).toContain("Use a log");
  expect(real).toContain("One file per map.");
  expect(real).toContain("why: Replay is easy.");
  expect(head(real)).not.toContain("proposed");
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", () => {
  const p = seeded();
  p.ok("add", "log", "--title", "Use a log");
  const before = p.rawLines();
  const refused = p.werk("accept", "log");
  expect(refused.code).not.toBe(0);
  expect(p.rawLines()).toEqual(before);
  expect(head(p.show("log"))).toContain("proposed");
  p.ok("accept", "log", "--actor", "you");
  expect(head(p.show("log"))).not.toContain("proposed");
});

test("62.3 the words of a ghost are frozen", () => {
  const p = seeded();
  p.ok("add", "log", "--title", "Use a log", "--body", "Old body.");
  const before = p.rawLines();
  const body = p.werk("propose", "log", "--ops", JSON.stringify([{ tag: "elaborated", old: "Old body.", new: "New body." }]));
  expect(body.code).not.toBe(0);
  expect(p.rawLines()).toEqual(before);
  const retitle = p.werk("propose", "log", "--title", "Use an append-only log");
  expect(retitle.code).not.toBe(0);
  expect(p.rawLines()).toEqual(before);
  const again = p.werk("add", "log", "--title", "Use a database");
  expect(again.code).not.toBe(0);
  expect(p.rawLines()).toEqual(before);
  const shown = p.show("log");
  expect(shown.split("\n")[1]).toBe("Use a log");
  expect(head(shown)).toContain("proposed");
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", () => {
  const p = seeded();
  p.ok("add", "log", "--title", "Use a log", "--body", "Old body.");
  p.ok("accept", "log", "--actor", "you");
  const before = p.rawLines();
  const retitle = p.werk("propose", "log", "--title", "Use an append-only log");
  expect(retitle.code).toBe(0);
  const after = p.rawLines();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const shown = p.show("log");
  expect(shown).toContain("Use an append-only log");
  expect(shown).not.toContain("Use a log");
  expect(p.logText()).toContain('"Use a log"');
  p.ok("propose", "log", "--ops", JSON.stringify([{ tag: "elaborated", old: "Old body.", new: "New body." }]));
  const edited = p.show("log");
  expect(edited).toContain("New body.");
  expect(edited).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", () => {
  const p = project([{ id: "store", title: "Store" }]);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "we keep one log per map" })}\n`,
  );
  const step = (args: string[]) => {
    const before = p.rawLines();
    const run = p.ok(...args);
    expect(run.out).toContain("proposed");
    const after = p.rawLines();
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  };
  step(["add", "store:opt0", "--kind", "option", "--title", "Use a database", "--why_not", "needs a server"]);
  p.ok("link", "store:opt0", "store", "--type", "alternative_to");
  step(["add", "rfc", "--kind", "source", "--title", "Log paper", "--url", "https://example.com", "--finding", "logs replay"]);
  step(["quote", "store", "talk", "one log per map"]);

  const opt = p.show("store:opt0");
  expect(head(opt)).toContain("proposed");
  expect(opt).toContain("Use a database");
  expect(opt).toContain("needs a server");
  const src = p.show("rfc");
  expect(head(src)).toContain("proposed");
  expect(src).toContain("Log paper");
  expect(src).toContain("logs replay");
  const ex = p.show("store:ex0");
  expect(head(ex)).toContain("proposed");
  expect(ex).toContain("one log per map");

  p.ok("accept", "store:opt0", "--actor", "you");
  const real = p.show("store:opt0");
  expect(head(real)).not.toContain("proposed");
  expect(real).toContain("needs a server");
  expect(head(p.show("rfc"))).toContain("proposed");
  expect(head(p.show("store:ex0"))).toContain("proposed");
});
