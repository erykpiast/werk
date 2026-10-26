import { expect, test } from "bun:test";
import { card, events, lines, ok, type Project, seed, w, withRoot } from "./lib.ts";

/** An open card with every fact but the ones left out. */
function open(p: Project, id: string, o: { who?: boolean; basis?: boolean; option?: boolean; kill?: boolean } = {}) {
  card(p, id, { title: `Card ${id}`, body: "Some body text.", parent: undefined, status: "open", ...(o.who ? { who: "me" } : { who: undefined }) });
  if (o.basis) seed(p, "edge.added", { from: id, to: "base", type: "depends_on", why: "builds on base" });
  if (o.option) {
    seed(p, "node.added", { id: `${id}:opt0`, kind: "option", title: "Other way", why_not: "worse" });
    seed(p, "edge.added", { from: `${id}:opt0`, to: id, type: "alternative_to" });
  }
  if (o.kill) seed(p, "kill.added", { id, criterion: { form: "revisit" } });
}

function pBase(): Project {
  const p = withRoot();
  card(p, "base", { title: "Base" });
  return p;
}

const printed = (text: string, verb: string) => text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith(`werk ${verb} `) || l.startsWith(`or: werk ${verb} `));

test("64.1 missing kill criterion: refused, names it, prints command, fix works", async () => {
  const p = pBase();
  open(p, "x", { who: true, basis: true, option: true });
  const n = lines(p).length;
  const r = await w(p, "status", "x", "decided");
  expect(r.code).not.toBe(0);
  const text = r.err + r.out;
  expect(text.toLowerCase()).toContain("kill criterion");
  expect(text).toContain("werk kill x");
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "show", "x")).out).toContain("[open]");
  await ok(p, "kill", "x", "--revisit");
  const d = await w(p, "status", "x", "decided");
  expect(d.code, d.err).toBe(0);
  expect((await ok(p, "show", "x")).out).toContain("[decided]");
});

test("64.2 several missing facts each reported with a command", async () => {
  const p = pBase();
  open(p, "x");
  const r = await w(p, "status", "x", "decided");
  expect(r.code).not.toBe(0);
  const t = (r.err + r.out).toLowerCase();
  expect(t).toContain("who");
  expect(t).toContain("basis");
  expect(t).toContain("option");
  expect(t).toContain("kill criterion");
  expect(r.err + r.out).toContain("werk edit x --who");
  expect(r.err + r.out).toContain("werk kill x");
  expect((await ok(p, "show", "x")).out).toContain("[open]");
  // run each printed command with placeholders filled
  await ok(p, "edit", "x", "--who", "me");
  await ok(p, "link", "x", "base", "--type", "depends_on", "--why", "builds on base");
  await ok(p, "add", "x:opt0", "--kind", "option", "--title", "Other", "--why_not", "worse");
  await ok(p, "link", "x:opt0", "x", "--type", "alternative_to");
  await ok(p, "accept", "x:opt0", "--actor", "you");
  await ok(p, "kill", "x", "--revisit");
  const d = await w(p, "status", "x", "decided");
  expect(d.code, d.err).toBe(0);
  expect((await ok(p, "show", "x")).out).toContain("[decided]");
});

test("64.2b printed commands for each fact exist", async () => {
  const p = pBase();
  open(p, "x");
  const r = await w(p, "status", "x", "decided");
  const t = r.err + r.out;
  console.log(t);
  expect(printed(t, "edit").length).toBeGreaterThan(0);
  expect(printed(t, "kill").length).toBeGreaterThan(0);
  expect(t).toMatch(/werk (link|status) /);
  expect(t).toMatch(/werk (edit x --unchallenged|add)/);
});

test("64.3 a ghost obeys the same check through its held edges", async () => {
  const p = pBase();
  const ghost = (id: string, basis: boolean) => {
    seed(p, "node.proposed", { id, kind: "card", title: `G ${id}`, who: "me" }, "agent");
    if (basis) seed(p, "edge.added", { from: id, to: "base", type: "depends_on", why: "builds" }, "agent");
    seed(p, "node.proposed", { id: `${id}:opt0`, kind: "option", title: "O", why_not: "worse" }, "agent");
    seed(p, "edge.added", { from: `${id}:opt0`, to: id, type: "alternative_to" }, "agent");
    seed(p, "kill.added", { id, criterion: { form: "revisit" } }, "agent");
  };
  ghost("g1", true);
  ghost("g2", false);
  const a = await w(p, "status", "g1", "decided");
  expect(a.code, a.err).toBe(0);
  expect((await ok(p, "show", "g1")).out).toContain("[decided]");
  const b = await w(p, "status", "g2", "decided");
  expect(b.code).not.toBe(0);
  expect((b.err + b.out).toLowerCase()).toContain("basis");
  expect(b.err + b.out).toMatch(/werk (link|edit) g2/);
  expect((await ok(p, "show", "g2")).out).not.toContain("[decided]");
});

async function decided(): Promise<Project> {
  const p = pBase();
  open(p, "x", { who: true, basis: true, option: true, kill: true });
  seed(p, "node.decided", { id: "x" });
  return p;
}

test("64.4 an amend that removes a required fact is refused", async () => {
  const p = await decided();
  const before = (await ok(p, "show", "x")).out;
  const n = lines(p).length;
  const r = await w(p, "unlink", "x", "base", "--type", "depends_on");
  expect(r.code).not.toBe(0);
  expect((r.err + r.out).toLowerCase()).toContain("basis");
  expect(r.err + r.out).toContain("werk ");
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "show", "x")).out).toBe(before);
});

test("64.5 an amend that keeps every fact succeeds; log shows reopen and decide", async () => {
  const p = await decided();
  const n = lines(p).length;
  await ok(p, "propose", "x", "--ops", JSON.stringify([{ tag: "elaborated", old: "Some body text.", new: "One short sentence." }]));
  await ok(p, "accept", "x", "--actor", "you");
  const s = (await ok(p, "show", "x")).out;
  expect(s).toContain("[decided]");
  expect(s).toContain("One short sentence.");
  const types = events(p).slice(n).map((e) => e.type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});
