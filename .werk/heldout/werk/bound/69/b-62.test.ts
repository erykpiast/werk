// Held-out steps 62.x: an agent proposes, the person accepts, ghost words stay frozen.
import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { head, project } from "./b-helpers.ts";

setDefaultTimeout(120_000);

/** Asserts that the log grew by exactly `n` lines at the end and kept every earlier line. */
function grewBy(before: string[], after: string[], n: number) {
  expect(after.length).toBe(before.length + n);
  expect(after.slice(0, before.length)).toEqual(before);
}

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("storage", "Storage", "root");
  const l0 = p.log();
  const add = await p.ok("add", "use-log", "--title", "Use a log", "--body", "Every write appends", "--why", "History stays");
  expect(add).toContain("proposed");
  const l1 = p.log();
  grewBy(l0, l1, 1);
  const show = await p.ok("show", "use-log");
  expect(show).toContain("Use a log");
  expect(show).toContain("Every write appends");
  expect(show).toContain("History stays");
  expect(head(show)).toContain("proposed");
  const acc = await p.w("accept", "use-log", "--actor", "you");
  expect(acc.code).toBe(0);
  grewBy(l1, p.log(), 1);
  const real = await p.ok("show", "use-log");
  expect(real).toContain("Use a log");
  expect(real).toContain("Every write appends");
  expect(real).toContain("History stays");
  expect(head(real)).not.toContain("proposed");
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = project();
  p.real("root", "Root");
  await p.ok("add", "use-log", "--title", "Use a log");
  const n = p.log().length;
  const bare = await p.w("accept", "use-log");
  expect(bare.code).not.toBe(0);
  expect(p.log().length).toBe(n);
  expect(head(await p.ok("show", "use-log"))).toContain("proposed");
  await p.ok("accept", "use-log", "--actor", "you");
  expect(head(await p.ok("show", "use-log"))).not.toContain("proposed");
});

test("62.3 the words of a ghost are frozen", async () => {
  const p = project();
  p.real("root", "Root");
  await p.ok("add", "use-log", "--title", "Use a log", "--body", "Every write appends");
  let n = p.log().length;
  const body = await p.w("propose", "use-log", "--ops", JSON.stringify([{ tag: "elaborated", old: "Every write appends", new: "Each write appends one line" }]));
  expect(body.code).not.toBe(0);
  expect(p.log().length).toBe(n);
  n = p.log().length;
  const title = await p.w("propose", "use-log", "--title", "Use an append-only log");
  expect(title.code).not.toBe(0);
  expect(p.log().length).toBe(n);
  const again = await p.w("add", "use-log", "--title", "Use a database");
  expect(again.code).not.toBe(0);
  expect(p.log().length).toBe(n);
  const show = await p.ok("show", "use-log");
  expect(show.split("\n")[1]).toBe("Use a log");
  expect(head(show)).toContain("proposed");
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = project();
  p.real("root", "Root");
  await p.ok("add", "use-log", "--title", "Use a log", "--body", "Every write appends");
  await p.ok("accept", "use-log", "--actor", "you");
  const l0 = p.log();
  const r = await p.w("propose", "use-log", "--title", "Use an append-only log");
  expect(r.code).toBe(0);
  grewBy(l0, p.log(), 1);
  const show = await p.ok("show", "use-log");
  expect(show).toContain("Use an append-only log");
  expect(show).not.toContain("Use a log\n");
  expect(show).not.toMatch(/Use a log(?!\w)(?! *\+)/);
  expect(p.log().some((l) => l.includes('"Use a log"'))).toBe(true);
  await p.ok("propose", "use-log", "--ops", JSON.stringify([{ tag: "elaborated", old: "Every write appends", new: "Each write appends one line" }]));
  const after = await p.ok("show", "use-log");
  expect(after).toContain("Each write appends one line");
  expect(after).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("storage", "Storage", "root");
  mkdirSync(join(p.dir, ".werk", "chats"));
  const msg = (text: string) => JSON.stringify({ speaker: "person", at: "t1", session: "s1", kind: "spoken", text });
  writeFileSync(join(p.dir, ".werk", "chats", "talk.jsonl"), `${msg("we store every write in one log file")}\n`);

  const steps: [string[], string][] = [
    [["add", "storage:opt0", "--kind", "option", "--title", "Use a database", "--why_not", "needs a server"], "storage:opt0"],
    [["add", "src-bench", "--kind", "source", "--title", "Benchmark", "--finding", "a log is fast", "--url", "https://example.com/bench"], "src-bench"],
    [["quote", "storage", "talk", "one log file"], ""],
  ];
  const ids: string[] = [];
  for (const [args, id] of steps) {
    const l0 = p.log();
    const out = await p.ok(...args);
    expect(out).toContain("proposed");
    grewBy(l0, p.log(), 1);
    ids.push(id || (out.split(":").slice(0, 2).join(":")));
  }
  await p.ok("link", "storage:opt0", "storage", "--type", "alternative_to");
  const opt = await p.ok("show", ids[0] as string);
  expect(opt).toContain("Use a database");
  expect(opt).toContain("needs a server");
  expect(head(opt)).toContain("proposed");
  const src = await p.ok("show", ids[1] as string);
  expect(src).toContain("Benchmark");
  expect(src).toContain("a log is fast");
  expect(head(src)).toContain("proposed");
  const ex = await p.ok("show", ids[2] as string);
  expect(ex).toContain("one log file");
  expect(head(ex)).toContain("proposed");

  await p.ok("accept", "storage:opt0", "--actor", "you");
  const optAfter = await p.ok("show", "storage:opt0");
  expect(head(optAfter)).not.toContain("proposed");
  expect(optAfter).toContain("needs a server");
  expect(head(await p.ok("show", ids[1] as string))).toContain("proposed");
  expect(head(await p.ok("show", ids[2] as string))).toContain("proposed");
});
