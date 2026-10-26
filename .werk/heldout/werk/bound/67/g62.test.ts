import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { make } from "./lib.ts";

const head = (s: string) => s.split("\n")[0];

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("a", { title: "A", parent: "root" });
  p.card("b", { title: "B", parent: "root" });
  const before = p.lines();
  const add = await p.w(
    "add",
    "use-log",
    "--title",
    "Use a log",
    "--body",
    "Events append.",
    "--why",
    "Replay works",
    "--parent",
    "root",
  );
  expect(add.out).toContain("proposed");
  const after = p.lines();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const s = await p.w("show", "use-log");
  expect(s.out).toContain("Use a log");
  expect(s.out).toContain("Events append.");
  expect(s.out).toContain("why: Replay works");
  expect(head(s.out)).toContain("proposed");
  const acc = await p.w("accept", "use-log", "--actor", "you");
  expect(acc.code).toBe(0);
  const after2 = p.lines();
  expect(after2.length).toBe(after.length + 1);
  expect(after2.slice(0, after.length)).toEqual(after);
  const s2 = await p.w("show", "use-log");
  expect(s2.out).toContain("Use a log");
  expect(s2.out).toContain("Events append.");
  expect(s2.out).toContain("why: Replay works");
  expect(head(s2.out)).not.toContain("proposed");
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  expect((await p.w("add", "g", "--title", "Ghost", "--parent", "root")).code).toBe(0);
  const n = p.lines().length;
  const bad = await p.w("accept", "g");
  expect(bad.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  expect(head((await p.w("show", "g")).out)).toContain("proposed");
  expect((await p.w("accept", "g", "--actor", "you")).code).toBe(0);
  expect(head((await p.w("show", "g")).out)).not.toContain("proposed");
});

test("62.3 the words of a ghost are frozen", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  expect((await p.w("add", "log", "--title", "Use a log", "--parent", "root")).code).toBe(0);
  let n = p.lines().length;
  const edit = await p.w("edit", "log", "--body", "A new body");
  expect(edit.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  n = p.lines().length;
  const rt = await p.w("retitle", "log", "Use an append-only log");
  expect(rt.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  const again = await p.w("add", "log", "--title", "Other title", "--parent", "root");
  expect(again.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  const s = await p.w("show", "log");
  expect(s.out).toContain("Use a log");
  expect(head(s.out)).toContain("proposed");
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  expect((await p.w("add", "log", "--title", "Use a log", "--parent", "root")).code).toBe(0);
  expect((await p.w("accept", "log", "--actor", "you")).code).toBe(0);
  const before = p.lines();
  const rt = await p.w("retitle", "log", "Use an append-only log");
  expect(rt.code).toBe(0);
  const after = p.lines();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const s = await p.w("show", "log");
  expect(s.out).toContain("Use an append-only log");
  expect(s.out).not.toMatch(/Use a log\b/);
  expect(before.some((l) => l.includes('"Use a log"'))).toBe(true);
  expect(p.lines().some((l) => l.includes('"Use a log"'))).toBe(true);
  const ed = await p.w("edit", "log", "--body", "Every write appends one line.");
  expect(ed.code).toBe(0);
  const s2 = await p.w("show", "log");
  expect(s2.out).toContain("Every write appends one line.");
  expect(s2.out).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("card", { title: "The card", parent: "root" });
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "user", at: "10:00", session: "s1", kind: "spoken", text: "we never rewrite the log" })}\n`,
  );
  const steps: [string[], string][] = [
    [
      ["add", "card:opt0", "--kind", "option", "--title", "Use a table", "--why_not", "a table forgets history"],
      "card:opt0",
    ],
    [
      [
        "add",
        "src-a",
        "--kind",
        "source",
        "--title",
        "Notes",
        "--finding",
        "logs replay",
        "--url",
        "https://example.com",
      ],
      "src-a",
    ],
    [["quote", "card", "talk", "we never rewrite the log"], "card:ex0"],
  ];
  for (const [args] of steps) {
    const n = p.lines();
    const r = await p.w(...args);
    if (r.code !== 0) console.log(args[1], r.err);
    expect(r.code).toBe(0);
    expect(r.out).toContain("proposed");
    const m = p.lines();
    expect(m.length).toBe(n.length + 1);
    expect(m.slice(0, n.length)).toEqual(n);
  }
  expect((await p.w("link", "card:opt0", "card", "--type", "alternative_to")).code).toBe(0);
  const opt = await p.w("show", "card:opt0");
  expect(opt.out).toContain("Use a table");
  expect(opt.out).toContain("a table forgets history");
  expect(head(opt.out)).toContain("proposed");
  const src = await p.w("show", "src-a");
  expect(src.out).toContain("Notes");
  expect(src.out).toContain("logs replay");
  expect(head(src.out)).toContain("proposed");
  const ex = await p.w("show", "card:ex0");
  expect(ex.out).toContain("we never rewrite the log");
  expect(head(ex.out)).toContain("proposed");
  expect((await p.w("accept", "card:opt0", "--actor", "you")).code).toBe(0);
  const opt2 = await p.w("show", "card:opt0");
  expect(head(opt2.out)).not.toContain("proposed");
  expect(opt2.out).toContain("why not: a table forgets history");
  expect(head((await p.w("show", "src-a")).out)).toContain("proposed");
  expect(head((await p.w("show", "card:ex0")).out)).toContain("proposed");
});
