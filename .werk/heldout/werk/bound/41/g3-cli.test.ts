import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const size = (p: Project) => readFileSync(logOf(p), "utf8");
const lines = (p: Project) => size(p).split("\n").filter(Boolean).length;
function seed(p: Project, type: string, payload: object): void {
  appendFileSync(logOf(p), `${JSON.stringify({ seq: lines(p) + 1, at: "t", actor: "you", type, payload })}\n`);
}
const card = (p: Project, id: string, status: string, parent?: string, extra: object = {}) =>
  seed(p, "node.added", { id, kind: "card", title: id, status, ...(parent ? { parent } : {}), ...extra });
async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} -> ${r.code}: ${r.err}`);
  return r;
}
function withRoot(): Project {
  const p = freshProject();
  card(p, "root", "decided");
  return p;
}
function person(p: Project, id: string, text: string) {
  seed(p, "note.added", { id, text });
}

test("11.1 rollup counts the card and its refines subtree", async () => {
  const p = withRoot();
  card(p, "a", "open", "root");
  card(p, "b", "proto", "root");
  card(p, "c", "decided", "a");
  const out = (await ok(p, ["show", "root"])).out;
  console.log(out);
  expect(out).toContain("4 cards, 1 open, 1 proto, 2 decided");
});

test("11.2 incoming refines link shows the child's own rollup", async () => {
  const p = freshProject();
  card(p, "root", "decided");
  card(p, "parent", "decided", "root");
  card(p, "child", "decided", "parent");
  card(p, "g1", "open", "child");
  card(p, "g2", "decided", "child");
  const out = (await ok(p, ["show", "parent"])).out;
  console.log(out);
  expect(out).toMatch(/<- refines\s+child.*\(3 cards, 1 open, 2 decided\)/);
  expect(out).toContain("4 cards");
});

test("11.3 card prints options, excerpts and a proposed source with words", async () => {
  const p = withRoot();
  card(p, "base", "decided", "root");
  card(p, "x", "decided", "root");
  seed(p, "edge.added", { from: "x", to: "base", type: "depends_on", why: "needs the base format" });
  seed(p, "node.added", { id: "x:opt0", kind: "option", title: "Use polling", why_not: "too slow" });
  seed(p, "edge.added", { from: "x:opt0", to: "x", type: "alternative_to" });
  seed(p, "excerpt.quoted", {
    id: "x:ex0", title: "we poll too often", card: "x", conversation: "c", session: "s", message: 0, start: 0, end: 17,
    speaker: "person", said_at: "t0",
  });
  await ok(p, ["add", "src1", "--kind", "source", "--title", "Latency study", "--finding", "polling adds 2s"]);
  await ok(p, ["link", "x", "src1", "--type", "supported_by"]);
  const shown = await ok(p, ["show", "x"]);
  const out = shown.out;
  console.log(out, shown.err);
  expect(out).toContain("needs the base format");
  const iLinks = out.indexOf("depends_on");
  const iOpt = out.indexOf("Options");
  expect(iOpt).toBeGreaterThan(iLinks);
  expect(out).toContain("Use polling");
  expect(out).toContain("why not: too slow");
  expect(out).toMatch(/Say\n.*person: "we poll too often"/);
  expect(out).toMatch(/Ev\n.*Latency study.*proposed/);
  expect(out).toContain("polling adds 2s");
});

test("11.4 no options -> no Options section", async () => {
  const p = withRoot();
  card(p, "x", "decided", "root");
  seed(p, "excerpt.quoted", {
    id: "x:ex0", title: "words", card: "x", conversation: "c", session: "s", message: 0, start: 0, end: 5,
    speaker: "person", said_at: "t0",
  });
  await ok(p, ["add", "src1", "--kind", "source", "--title", "Study", "--finding", "found"]);
  await ok(p, ["link", "x", "src1", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "x"])).out;
  expect(out).toContain("Say");
  expect(out).toContain("Ev");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "The Root Title", status: "decided" });
  card(p, "second", "open", "root");
  const out = (await ok(p, ["show"])).out;
  console.log(out);
  expect(out).toContain("The Root Title");
  expect(out).toContain("2 cards");
  expect(out).toMatch(/<- refines\s+second.*\(1 card, 1 open\)/);
});

test("68.1 say writes a note and show prints it", async () => {
  const p = withRoot();
  card(p, "werk-chat", "decided", "root", { title: "The composer sends a live agent turn" });
  const before = lines(p);
  const r = await p.werk(["say", "#werk-chat", "The reply streams over SSE"]);
  expect(r.code).toBe(0);
  const evs = size(p).split("\n").filter(Boolean).slice(before).map((l) => JSON.parse(l));
  expect(evs.length).toBe(1);
  expect(evs[0].type).toBe("note.added");
  expect(evs[0].payload.id).toBe("werk-chat");
  expect((await ok(p, ["show", "#werk-chat"])).out).toContain("The reply streams over SSE");
});

test("68.2 inbox reads a card thread in order", async () => {
  const p = withRoot();
  card(p, "werk-chat", "open", "root");
  for (const t of ["first", "second", "third"]) await ok(p, ["say", "werk-chat", t]);
  const out = (await ok(p, ["inbox"])).out;
  console.log(out);
  expect(out).toContain("werk-chat");
  expect(out.indexOf("first")).toBeGreaterThan(-1);
  expect(out.indexOf("second")).toBeGreaterThan(out.indexOf("first"));
  expect(out.indexOf("third")).toBeGreaterThan(out.indexOf("second"));
});

test("68.3 inbox groups notes by card", async () => {
  const p = withRoot();
  card(p, "werk-chat", "open", "root");
  card(p, "visual", "open", "root");
  await ok(p, ["say", "werk-chat", "chat one"]);
  await ok(p, ["say", "visual", "visual one"]);
  await ok(p, ["say", "werk-chat", "chat two"]);
  const out = (await ok(p, ["inbox"])).out;
  console.log(out);
  const iChat = out.indexOf("#werk-chat");
  const iVis = out.indexOf("#visual");
  expect(iChat).toBeGreaterThan(-1);
  expect(iVis).toBeGreaterThan(-1);
  // one group header per card, and each note falls under its own card's group
  expect(out.split("#werk-chat").length - 1).toBe(1);
  const chatGroup = iChat < iVis ? out.slice(iChat, iVis) : out.slice(iChat);
  const visGroup = iVis < iChat ? out.slice(iVis, iChat) : out.slice(iVis);
  expect(chatGroup.indexOf("chat one")).toBeGreaterThan(-1);
  expect(chatGroup.indexOf("chat two")).toBeGreaterThan(chatGroup.indexOf("chat one"));
  expect(visGroup).toContain("visual one");
  expect(visGroup).not.toContain("chat one");
  expect(visGroup).not.toContain("chat two");
});

test("68.4 note on a ghost card", async () => {
  const p = withRoot();
  card(p, "visual", "open", "root");
  await ok(p, ["add", "werk-pane", "--title", "The pane"]);
  await ok(p, ["link", "visual", "werk-pane", "--type", "depends_on", "--why", "shows it"]);
  const r = await p.werk(["say", "werk-pane", "Describe the pane here"]);
  expect(r.code).toBe(0);
  const out = (await ok(p, ["inbox"])).out;
  console.log(out);
  expect(out).toContain("werk-pane");
  expect(out).toContain("Describe the pane here");
});

test("68.5 note on an unknown card fails and changes nothing", async () => {
  const p = withRoot();
  card(p, "werk-chat", "open", "root");
  const before = size(p);
  const r = await p.werk(["say", "#no-such-card", "lost note"]);
  console.log(r);
  expect(r.code).not.toBe(0);
  expect(r.out + r.err).toContain("no-such-card");
  expect(r.out + r.err).toMatch(/unknown|no node|not in the map|no card/i);
  expect(size(p)).toBe(before);
  const out = (await ok(p, ["inbox"])).out;
  expect(out).not.toContain("lost note");
});
