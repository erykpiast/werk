// Held-out steps 11.1-11.5 and 68.1-68.5: werk show rollups and sections, say and inbox.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter(Boolean);

function seed(p: Project, type: string, payload: object): void {
  const event = { seq: lines(p).length + 1, at: "t", actor: "you", type, payload };
  appendFileSync(logOf(p), `${JSON.stringify(event)}\n`);
}
const card = (p: Project, id: string, fields: Record<string, unknown> = {}) =>
  seed(p, "node.added", { id, kind: "card", title: `Title ${id}`, ...fields });

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

// 11.1
test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = freshProject();
  card(p, "root", { status: "decided" });
  card(p, "c1", { parent: "root", status: "open" });
  card(p, "c2", { parent: "root", status: "proto" });
  card(p, "g1", { parent: "c1", status: "decided" });
  const out = (await ok(p, ["show", "root"])).out;
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups).toHaveLength(1);
  const line = rollups[0] as string;
  expect(line).toContain("4 cards");
  expect(line).toContain("1 open");
  expect(line).toContain("1 proto");
  expect(line).toContain("2 decided");
  const n = (name: string) => Number(new RegExp(`(\\d+) ${name}`).exec(line)?.[1] ?? 0);
  expect(n("open") + n("proto") + n("decided")).toBe(n("cards"));
});

// 11.2
test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = freshProject();
  card(p, "parent", { status: "decided" });
  card(p, "child", { parent: "parent", status: "decided" });
  card(p, "g-open", { parent: "child", status: "open" });
  card(p, "g-dec", { parent: "child", status: "decided" });
  const out = (await ok(p, ["show", "parent"])).out;
  const link = out.split("\n").find((l) => /<-\s+refines\s+child\b/.test(l));
  expect(link).toBeDefined();
  expect(link).toContain("3 cards");
  expect(link).not.toContain("4 cards");
  const own = out.split("\n").find((l) => l.startsWith("subtree:"));
  expect(own).toContain("4 cards");
});

// 11.3
test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = freshProject();
  card(p, "root", { status: "decided" });
  card(p, "base", { parent: "root", status: "decided", title: "The base card" });
  card(p, "subj", { parent: "root", status: "open", title: "The subject card" });
  seed(p, "edge.added", { from: "subj", to: "base", type: "depends_on", why: "it takes the storage format" });
  seed(p, "node.added", { id: "subj:opt0", kind: "option", title: "Use SQLite", why_not: "needs a native build" });
  seed(p, "edge.added", { from: "subj:opt0", to: "subj", type: "alternative_to" });
  seed(p, "excerpt.quoted", {
    id: "subj-quote",
    title: "keep one log per conversation",
    card: "subj",
    conversation: "c1",
    session: "s1",
    message: 0,
    start: 0,
    end: 29,
    speaker: "person",
    said_at: "t0",
  });
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "Writes are 3x faster"]);
  await ok(p, ["link", "subj", "bench", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "subj"])).out;
  const at = (s: string) => out.indexOf(s);
  expect(out).toMatch(/->\s+depends_on\s+base/);
  expect(out).toContain("why: it takes the storage format");
  const lastLink = Math.max(out.lastIndexOf("->"), out.lastIndexOf("<-"));
  expect(at("\nOptions\n")).toBeGreaterThan(lastLink);
  expect(out).toContain("Use SQLite");
  expect(out).toContain("why not: needs a native build");
  expect(at("\nSay\n")).toBeGreaterThan(-1);
  expect(out).toContain('person: "keep one log per conversation"');
  expect(at("\nEv\n")).toBeGreaterThan(-1);
  const benchLine = out.slice(at("\nEv\n")).split("\n").find((l) => l.includes("Benchmark notes"));
  expect(out).toContain("finding: Writes are 3x faster");
  expect(benchLine).toContain("proposed");
});

// 11.4
test("11.4 a card with no options prints no Options section", async () => {
  const p = freshProject();
  card(p, "root", { status: "decided" });
  seed(p, "node.added", { id: "src1", kind: "source", title: "A source", finding: "It found a thing" });
  seed(p, "edge.added", { from: "root", to: "src1", type: "supported_by" });
  seed(p, "excerpt.quoted", {
    id: "root-quote",
    title: "hello there",
    card: "root",
    conversation: "c1",
    session: "s1",
    message: 0,
    start: 0,
    end: 11,
    speaker: "person",
    said_at: "t0",
  });
  const out = (await ok(p, ["show", "root"])).out;
  expect(out).toContain("\nSay\n");
  expect(out).toContain("\nEv\n");
  expect(out).not.toContain("\nOptions\n");
});

// 11.5
test("11.5 show with no id prints the root card", async () => {
  const p = freshProject();
  card(p, "root", { title: "The root card", status: "decided" });
  card(p, "second", { parent: "root", title: "The second card", status: "open" });
  const out = (await ok(p, ["show"])).out;
  expect(out).toContain("The root card");
  expect(out).toMatch(/^subtree: 2 cards/m);
  const link = out.split("\n").find((l) => /<-\s+refines\s+second\b/.test(l));
  expect(link).toBeDefined();
  expect(link).toContain("(1 card");
});

// 68.1
test("68.1 an agent writes a note on a card and sees it on the card", async () => {
  const p = freshProject();
  card(p, "werk-chat", { title: "The composer sends a live agent turn", status: "decided" });
  const before = lines(p).length;
  const run = await p.werk(["say", "#werk-chat", "The reply streams over SSE"]);
  expect(run.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  const event = JSON.parse(after.at(-1) as string);
  expect(event.type).toBe("note.added");
  expect(event.payload.id).toBe("werk-chat");
  const out = (await ok(p, ["show", "#werk-chat"])).out;
  expect(out).toContain("The reply streams over SSE");
});

/** The inbox's notes grouped by card id, in output order. */
function groups(inbox: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [, id, text] of inbox.matchAll(/^\[\d+\] #(\S+).*\n\s+(.*)$/gm)) {
    map.set(id as string, [...(map.get(id as string) ?? []), text as string]);
  }
  return map;
}

// 68.2
test("68.2 an agent reads a whole card thread in order from the inbox", async () => {
  const p = freshProject();
  card(p, "werk-chat", { title: "Chat" });
  for (const text of ["first", "second", "third"]) await ok(p, ["say", "#werk-chat", text]);
  const out = (await ok(p, ["inbox"])).out;
  expect(out).toContain("#werk-chat");
  expect(groups(out).get("werk-chat")).toEqual(["first", "second", "third"]);
});

// 68.3
test("68.3 the inbox groups notes by card", async () => {
  const p = freshProject();
  card(p, "werk-chat", { title: "Chat" });
  card(p, "visual", { title: "Visual" });
  await ok(p, ["say", "#werk-chat", "chat one"]);
  await ok(p, ["say", "#visual", "visual one"]);
  await ok(p, ["say", "#werk-chat", "chat two"]);
  const out = (await ok(p, ["inbox"])).out;
  const g = groups(out);
  expect(g.get("werk-chat")).toEqual(["chat one", "chat two"]);
  expect(g.get("visual")).toEqual(["visual one"]);
});

// 68.4
test("68.4 an agent writes a note on a ghost card", async () => {
  const p = freshProject();
  card(p, "root", { title: "Root" });
  card(p, "visual", { title: "Visual" });
  await ok(p, ["add", "werk-pane", "--title", "The pane"]);
  await ok(p, ["link", "visual", "werk-pane", "--type", "depends_on", "--why", "it draws in the pane"]);
  const run = await p.werk(["say", "#werk-pane", "Describe the pane here"]);
  expect(run.code).toBe(0);
  const out = (await ok(p, ["inbox"])).out;
  expect(groups(out).get("werk-pane")).toEqual(["Describe the pane here"]);
});

// 68.5
test("68.5 a note on an unknown card fails and changes nothing", async () => {
  const p = freshProject();
  card(p, "werk-chat", { title: "Chat" });
  const size = statSync(logOf(p)).size;
  const run = await p.werk(["say", "#no-such-card", "lost note"]);
  expect(run.code).not.toBe(0);
  expect(run.out + run.err).toContain("no-such-card");
  expect(run.out + run.err).toMatch(/unknown|no node|not in the map|no card/i);
  expect(statSync(logOf(p)).size).toBe(size);
  const out = (await ok(p, ["inbox"])).out;
  expect(out).not.toContain("lost note");
});
