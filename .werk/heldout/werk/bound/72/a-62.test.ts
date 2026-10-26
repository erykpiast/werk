import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { project, real, show } from "./a-helpers.ts";

const header = (out: string) => out.split("\n")[0] ?? "";

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "other", "Other", "root");
  const before = p.lines();
  const add = await p.werk([
    "add",
    "log",
    "--title",
    "Use a log",
    "--body",
    "One file per map.",
    "--why",
    "History stays.",
  ]);
  expect(add.out).toContain("proposed");
  const mid = p.lines();
  expect(mid).toHaveLength(before.length + 1);
  expect(mid.slice(0, before.length)).toEqual(before);
  const s = await show(p, "log");
  expect(s.out).toContain("Use a log");
  expect(s.out).toContain("One file per map.");
  expect(s.out).toContain("History stays.");
  expect(header(s.out)).toContain("proposed");
  const acc = await p.werk(["accept", "log", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const end = p.lines();
  expect(end).toHaveLength(mid.length + 1);
  expect(end.slice(0, mid.length)).toEqual(mid);
  const s2 = await show(p, "log");
  for (const t of ["Use a log", "One file per map.", "History stays."]) expect(s2.out).toContain(t);
  expect(header(s2.out)).not.toContain("proposed");
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = project();
  await real(p, "root", "Root");
  await p.werk(["add", "log", "--title", "Use a log"]);
  const n = p.lines().length;
  const bare = await p.werk(["accept", "log"]);
  expect(bare.code).not.toBe(0);
  expect(p.lines()).toHaveLength(n);
  expect(header((await show(p, "log")).out)).toContain("proposed");
  expect((await p.werk(["accept", "log", "--actor", "you"])).code).toBe(0);
  expect(header((await show(p, "log")).out)).not.toContain("proposed");
});

test("62.3 the words of a ghost are frozen", async () => {
  const p = project();
  await real(p, "root", "Root");
  await p.werk(["add", "log", "--title", "Use a log"]);
  const n = p.lines().length;
  const edit = await p.werk(["edit", "log", "--body", "A new body"]);
  expect(edit.code).not.toBe(0);
  expect(p.lines()).toHaveLength(n);
  const re = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(re.code).not.toBe(0);
  expect(p.lines()).toHaveLength(n);
  const again = await p.werk(["add", "log", "--title", "Something else"]);
  expect(again.code).not.toBe(0);
  expect(p.lines()).toHaveLength(n);
  const s = await show(p, "log");
  expect(s.out.split("\n")[1]).toBe("Use a log");
  expect(header(s.out)).toContain("proposed");
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = project();
  await real(p, "root", "Root");
  await p.werk(["add", "log", "--title", "Use a log"]);
  await p.werk(["accept", "log", "--actor", "you"]);
  const before = p.lines();
  const re = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(re.code).toBe(0);
  const after = p.lines();
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const s = await show(p, "log");
  expect(s.out).toContain("Use an append-only log");
  expect(s.out).not.toContain("Use a log");
  expect(readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8")).toContain('"Use a log"');
  expect(after.some((l) => l.includes('"Use a log"'))).toBe(true);
  expect((await p.werk(["edit", "log", "--body", "Every write appends."])).code).toBe(0);
  const s2 = await show(p, "log");
  expect(s2.out).toContain("Every write appends.");
  expect(s2.out).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "log", "Use a log", "root");
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", "design.jsonl"),
    `${JSON.stringify({ kind: "spoken", speaker: "user", at: "2026-01-01T00:00:00Z", session: "s1", text: "we keep one log forever" })}\n`,
  );
  const adds: [string[], string][] = [
    [["add", "log:opt0", "--kind", "option", "--title", "Use a database", "--why_not", "needs a server"], "log:opt0"],
    [
      [
        "add",
        "paper",
        "--kind",
        "source",
        "--title",
        "Log paper",
        "--finding",
        "logs scale",
        "--url",
        "http://example.invalid",
      ],
      "paper",
    ],
    [["quote", "log", "design", "one log forever"], "log:ex0"],
  ];
  for (const [args, id] of adds) {
    const before = p.lines();
    const r = await p.werk(args);
    expect(r.code).toBe(0);
    expect(r.out).toContain("proposed");
    const after = p.lines();
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(header((await show(p, id)).out)).toContain("proposed");
  }
  expect((await show(p, "log:opt0")).out).toContain("needs a server");
  expect((await show(p, "paper")).out).toContain("logs scale");
  expect((await show(p, "log:ex0")).out).toContain("one log forever");
  expect((await p.werk(["accept", "log:opt0", "--actor", "you"])).code).toBe(0);
  const opt = await show(p, "log:opt0");
  expect(header(opt.out)).not.toContain("proposed");
  expect(opt.out).toContain("why not: needs a server");
  expect(header((await show(p, "paper")).out)).toContain("proposed");
  expect(header((await show(p, "log:ex0")).out)).toContain("proposed");
});
