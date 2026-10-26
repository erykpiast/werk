import { expect, test } from "bun:test";
import { Map_ } from "./b-lib.ts";

const firstLine = (out: string) => out.split("\n")[0] as string;

/** Splits a printed command into words; double quotes group, and a `<placeholder>` is filled in. */
function words(line: string, card: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|(\S+)/g)) {
    let w = m[1] ?? (m[2] as string);
    if (m[1] !== undefined) w = "filler";
    else if (w === "<card>") w = card;
    else if (w === "you|me|prototype") w = "you";
    out.push(w);
  }
  return out;
}

/** A decided card "base", and a card "x" that leans on it, with a real option. */
async function withBase(m: Map_) {
  await m.root();
  await m.real("base", "Base");
  await m.decideAlone("base");
}

test("64.1 missing kill criterion: refusal prints the fix command", async () => {
  const m = new Map_();
  await withBase(m);
  await m.real("x", "X");
  await m.ok("edit", "x", "--who", "you");
  await m.ok("link", "x", "base", "--type", "depends_on", "--why", "uses base");
  await m.real("x:opt0", "Other way", undefined, ["--kind", "option", "--why_not", "worse"]);
  await m.ok("link", "x:opt0", "x", "--type", "alternative_to");
  const before = m.count();
  const r = await m.w("status", "x", "decided");
  expect(r.code).not.toBe(0);
  const text = r.err + r.out;
  expect(text).toContain("kill criterion");
  expect(text).toContain("werk kill x");
  expect(firstLine((await m.ok("show", "x")).out)).toContain("[open]");
  expect(m.count()).toBe(before);
  const cmd = text.split("\n").map((l) => l.trim().replace(/^or: /, "")).find((l) => l.startsWith("werk kill x") && l.includes("--revisit"));
  expect(cmd).toBeDefined();
  const [, ...args] = (cmd as string).split(" ");
  await m.ok(...args);
  await m.ok("status", "x", "decided");
  expect(firstLine((await m.ok("show", "x")).out)).toContain("[decided]");
});

test("64.2 several missing facts each with a command", async () => {
  const m = new Map_();
  await withBase(m);
  await m.real("x", "X", undefined, ["--body", "some text"]);
  const before = m.count();
  const r = await m.w("status", "x", "decided");
  expect(r.code).not.toBe(0);
  const text = r.err + r.out;
  for (const fact of ["who:", "basis:", "option:", "kill criterion:"]) expect(text).toContain(fact);
  const cmds = text.split("\n").map((l) => l.trim().replace(/^(or|then): /, "")).filter((l) => l.startsWith("werk "));
  for (const f of ["edit x --who", "link x <card>", "add x:opt0", "kill x"]) expect(cmds.some((c) => c.includes(f))).toBe(true);
  expect(m.count()).toBe(before);
  expect(firstLine((await m.ok("show", "x")).out)).toContain("[open]");
  // run, in turn, the first command of each fact (the option needs its link too)
  const pick = (needle: string) => cmds.find((c) => c.includes(needle)) as string;
  for (const needle of ["edit x --who", "link x <card>", "add x:opt0", "link x:opt0 x", "kill x"]) {
    const line = pick(needle);
    const [, ...args] = words(line, "base");
    await m.ok(...args);
  }
  let st = await m.w("status", "x", "decided");
  if (st.code !== 0) {
    // the option the agent added is still a ghost; the person accepts it, then the decide is tried again
    await m.ok("accept", "x:opt0", "--actor", "you");
    st = await m.w("status", "x", "decided");
  }
  expect(st.code, st.err).toBe(0);
  expect(firstLine((await m.ok("show", "x")).out)).toContain("[decided]");
});

test("64.3 ghost obeys the contract through held edges", async () => {
  const m = new Map_();
  await withBase(m);
  for (const id of ["g1", "g2"]) {
    await m.ghost(id, id);
    await m.ok("edit", id, "--who", "you");
    await m.ok("add", `${id}:opt0`, "--kind", "option", "--title", "alt", "--why_not", "worse");
    await m.ok("link", `${id}:opt0`, id, "--type", "alternative_to");
    await m.ok("kill", id, "--revisit");
  }
  await m.ok("link", "g1", "base", "--type", "depends_on", "--why", "uses base");
  const ok = await m.w("status", "g1", "decided");
  expect(ok.code, ok.err).toBe(0);
  expect(firstLine((await m.ok("show", "g1")).out)).toContain("[decided]");
  const before = m.count();
  const bad = await m.w("status", "g2", "decided");
  expect(bad.code).not.toBe(0);
  const text = bad.err + bad.out;
  expect(text).toContain("basis");
  expect(text).toContain("werk link g2");
  expect(firstLine((await m.ok("show", "g2")).out)).not.toContain("[decided]");
  expect(m.count()).toBe(before);
});

async function decidedX(m: Map_) {
  await withBase(m);
  await m.real("x", "X", undefined, ["--body", "A long body of text."]);
  await m.ok("edit", "x", "--who", "you");
  await m.ok("link", "x", "base", "--type", "depends_on", "--why", "uses base");
  await m.real("x:opt0", "Other way", undefined, ["--kind", "option", "--why_not", "worse"]);
  await m.ok("link", "x:opt0", "x", "--type", "alternative_to");
  await m.ok("kill", "x", "--revisit");
  await m.ok("status", "x", "decided");
}

test("64.4 an amend that drops a required fact is refused", async () => {
  const m = new Map_();
  await decidedX(m);
  const shown = (await m.ok("show", "x")).out;
  const before = m.raw();
  const r = await m.w("unlink", "x", "base", "--type", "depends_on");
  expect(r.code).not.toBe(0);
  const text = r.err + r.out;
  expect(text).toContain("basis");
  expect(text).toContain("werk link x");
  expect(firstLine((await m.ok("show", "x")).out)).toContain("[decided]");
  expect((await m.ok("show", "x")).out).toBe(shown);
  expect(m.raw()).toBe(before);
});

test("64.5 an amend that keeps every fact succeeds", async () => {
  const m = new Map_();
  await decidedX(m);
  await m.ok("propose", "x", "--ops", JSON.stringify([{ tag: "removed", old: "A long body of text." }, { tag: "new", new: "Short." }]));
  const before = m.count();
  const r = await m.w("accept", "x", "--actor", "you");
  expect(r.code, r.err).toBe(0);
  const s = (await m.ok("show", "x")).out;
  expect(firstLine(s)).toContain("[decided]");
  expect(s).toContain("Short.");
  expect(s).not.toContain("A long body");
  const types = m.events().slice(before).map((e) => e.type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});
