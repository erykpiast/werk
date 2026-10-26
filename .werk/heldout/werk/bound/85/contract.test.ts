import { expect, test } from "bun:test";
import { freshProject, type Project } from "../src/test/project.ts";
import { card, decided, edge, events, kill, lines, ok, proposed, seed, w } from "./h.ts";

const openRoot = { type: "node.added", payload: { id: "root", kind: "card", title: "Root", status: "open" } };
const opt = (id: string, to: string) => [
  { type: "node.added", payload: { id, kind: "option", title: "Opt", why_not: "no" } },
  { type: "edge.added", payload: { from: id, to, type: "alternative_to" } },
];
const show = async (p: Project, id: string) => (await w(p, ["show", id])).out;
/** Run one printed command line: the leading word is the werk name. */
const runPrinted = async (p: Project, line: string) => {
  const args = line.trim().replace(/^or: |^then: /, "").replace(/^werk /, "");
  const argv = [...args.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
  return ok(p, argv);
};
const printed = (err: string, re: RegExp) => err.split("\n").map((l) => l.trim()).filter((l) => re.test(l));

test("64.1", async () => {
  const p = freshProject();
  seed(p, [openRoot, decided("basis"), card("c", { who: "me" }), edge("c", "basis"), ...opt("o", "c")]);
  const n = lines(p).length;
  const r = await w(p, ["status", "c", "decided"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("kill criterion");
  expect(r.err).toMatch(/werk kill c /);
  expect(await show(p, "c")).toContain("[open]");
  expect(lines(p).length).toBe(n);
  await runPrinted(p, "werk kill c --revisit");
  const r2 = await w(p, ["status", "c", "decided"]);
  expect(r2.code).toBe(0);
  expect(await show(p, "c")).toContain("[decided]");
});

test("64.2", async () => {
  const p = freshProject();
  seed(p, [openRoot, card("c", { body: "body text" })]);
  const r = await w(p, ["status", "c", "decided"]);
  expect(r.code).not.toBe(0);
  for (const f of ["who:", "basis:", "option:", "kill criterion:"]) expect(r.err).toContain(f);
  expect(r.err).toMatch(/werk edit c --who/);
  expect(r.err).toMatch(/werk link c <card> --type depends_on/);
  expect(r.err).toMatch(/werk add c:opt0 --kind option/);
  expect(r.err).toMatch(/werk kill c /);
  expect(await show(p, "c")).toContain("[open]");
  seed(p, [decided("basis")]);
  await ok(p, ["edit", "c", "--who", "you"]);
  await ok(p, ["link", "c", "basis", "--type", "depends_on", "--why", "takes it"]);
  await ok(p, ["add", "c:opt0", "--kind", "option", "--title", "O", "--why_not", "no"]);
  await ok(p, ["link", "c:opt0", "c", "--type", "alternative_to"]);
  await ok(p, ["kill", "c", "--revisit"]);
  await ok(p, ["accept", "c:opt0", "--actor", "you"]);
  const r2 = await w(p, ["status", "c", "decided"]);
  expect(r2.err).toBe("");
  expect(r2.code).toBe(0);
  expect(await show(p, "c")).toContain("[decided]");
});

test("64.3", async () => {
  const p = freshProject();
  seed(p, [openRoot, decided("basis"), proposed("g1", { who: "you" }), proposed("g2", { who: "you" })]);
  for (const g of ["g1", "g2"]) {
    await ok(p, ["add", `${g}:opt0`, "--kind", "option", "--title", "O", "--why_not", "no"]);
    await ok(p, ["link", `${g}:opt0`, g, "--type", "alternative_to"]);
    await ok(p, ["kill", g, "--revisit"]);
  }
  await ok(p, ["link", "g1", "basis", "--type", "depends_on", "--why", "takes it"]);
  const r = await w(p, ["status", "g1", "decided"]);
  expect(r.code).toBe(0);
  expect(await show(p, "g1")).toContain("[decided]");
  const r2 = await w(p, ["status", "g2", "decided"]);
  expect(r2.code).not.toBe(0);
  expect(r2.err).toContain("basis");
  expect(r2.err).toMatch(/werk link g2 <card> --type depends_on/);
  expect(await show(p, "g2")).not.toContain("[decided]");
});

async function decidedFull() {
  const p = freshProject();
  seed(p, [openRoot, decided("basis"), card("c", { who: "me", body: "A long body\n\nwith two blocks" }), edge("c", "basis"), ...opt("o", "c"), kill("c")]);
  await ok(p, ["status", "c", "decided"]);
  return p;
}

test("64.4", async () => {
  const p = await decidedFull();
  const before = await show(p, "c");
  const n = lines(p).length;
  const r = await w(p, ["unlink", "c", "basis", "--type", "depends_on"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("basis");
  expect(r.err).toMatch(/werk link c <card> --type depends_on/);
  expect(await show(p, "c")).toBe(before);
  expect(lines(p).length).toBe(n);
});

test("64.5", async () => {
  const p = await decidedFull();
  const r = await ok(p, ["propose", "c", "--ops", JSON.stringify([{ tag: "elaborated", old: "A long body", new: "Short." }, { tag: "removed", old: "with two blocks" }])]);
  const n = lines(p).length;
  const a = await w(p, ["accept", "c", "--actor", "you"]);
  expect(a.code).toBe(0);
  const s = await show(p, "c");
  expect(s).toContain("[decided]");
  expect(s).toContain("Short.");
  const types = events(p).slice(n).map((e) => e.type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});
