// Held-out steps 68.x and 11.x at the command line.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter(Boolean);

function seed(p: Project, type: string, payload: object, actor = "you"): void {
  const seq = lines(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "2026-10-01T00:00:00.000Z", actor, type, payload })}\n`);
}

function card(p: Project, id: string, fields: Record<string, unknown> = {}): void {
  seed(p, "node.added", { id, kind: "card", title: id, ...fields });
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

// 68.1
test("68.1 an agent writes a note on a card and sees it on the card", async () => {
  const p = freshProject();
  card(p, "werk-chat", { title: "The composer sends a live agent turn", status: "decided", who: "me" });
  const before = lines(p).length;
  const said = await p.werk(["say", "#werk-chat", "The reply streams over SSE"]);
  expect(said.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  const event = JSON.parse(after.at(-1) as string);
  expect(event.type).toBe("note.added");
  expect(event.payload.id).toBe("werk-chat");
  const show = await ok(p, ["show", "#werk-chat"]);
  expect(show.out).toContain("The reply streams over SSE");
});

// 68.2
test("68.2 an agent reads a whole card thread in order from the inbox", async () => {
  const p = freshProject();
  card(p, "werk-chat");
  for (const text of ["first", "second", "third"]) await ok(p, ["say", "werk-chat", text]);
  const inbox = await ok(p, ["inbox"]);
  console.log("68.2 inbox:", JSON.stringify(inbox.out));
  expect(inbox.out).toContain("#werk-chat");
  const i1 = inbox.out.indexOf("first");
  const i2 = inbox.out.indexOf("second");
  const i3 = inbox.out.indexOf("third");
  expect(i1).toBeGreaterThan(-1);
  expect(i2).toBeGreaterThan(i1);
  expect(i3).toBeGreaterThan(i2);
});

// 68.3
test("68.3 the inbox groups notes by card", async () => {
  const p = freshProject();
  card(p, "werk-chat");
  card(p, "visual");
  await ok(p, ["say", "werk-chat", "chat one"]);
  await ok(p, ["say", "visual", "visual one"]);
  await ok(p, ["say", "werk-chat", "chat two"]);
  const inbox = await ok(p, ["inbox"]);
  console.log("68.3 inbox:", JSON.stringify(inbox.out));
  // A group: the notes of one card under one heading for that card.
  const chatGroups = inbox.out.match(/#werk-chat/g) ?? [];
  expect(chatGroups.length).toBe(1);
  const chatStart = inbox.out.indexOf("#werk-chat");
  const visualStart = inbox.out.indexOf("#visual");
  expect(visualStart).toBeGreaterThan(-1);
  const chatGroup = visualStart > chatStart ? inbox.out.slice(chatStart, visualStart) : inbox.out.slice(chatStart);
  const visualGroup = visualStart > chatStart ? inbox.out.slice(visualStart) : inbox.out.slice(visualStart, chatStart);
  expect(chatGroup.indexOf("chat one")).toBeGreaterThan(-1);
  expect(chatGroup.indexOf("chat two")).toBeGreaterThan(chatGroup.indexOf("chat one"));
  expect(visualGroup).toContain("visual one");
  expect(visualGroup).not.toContain("chat one");
  expect(visualGroup).not.toContain("chat two");
});

// 68.4
test("68.4 an agent writes a note on a ghost card", async () => {
  const p = freshProject();
  card(p, "root");
  card(p, "visual", { parent: "root" });
  await ok(p, ["add", "werk-pane", "--title", "The pane", "--parent", "root"]);
  await ok(p, ["link", "visual", "werk-pane", "--type", "depends_on", "--why", "the pane holds it"]);
  const said = await p.werk(["say", "werk-pane", "Describe the pane here"]);
  expect(said.code).toBe(0);
  const inbox = await ok(p, ["inbox"]);
  console.log("68.4 inbox:", JSON.stringify(inbox.out));
  expect(inbox.out).toMatch(/#werk-pane[\s\S]*Describe the pane here/);
});

// 68.5
test("68.5 a note on an unknown card fails and changes nothing", async () => {
  const p = freshProject();
  card(p, "werk-chat");
  const size = statSync(logOf(p)).size;
  const run = await p.werk(["say", "#no-such-card", "lost note"]);
  expect(run.code).not.toBe(0);
  expect(run.out + run.err).toMatch(/unknown[\s\S]*#no-such-card|#no-such-card[\s\S]*unknown/);
  expect(statSync(logOf(p)).size).toBe(size);
  const inbox = await ok(p, ["inbox"]);
  expect(inbox.out).not.toContain("lost note");
});

// 11.1
test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = freshProject();
  card(p, "root", { status: "decided", who: "me" });
  card(p, "c1", { parent: "root", status: "open" });
  card(p, "c2", { parent: "root", status: "proto" });
  card(p, "g1", { parent: "c1", status: "decided", who: "me" });
  const show = await ok(p, ["show", "root"]);
  console.log("11.1 show:", show.out);
  const rollups = show.out.split("\n").filter((l) => /^subtree:/.test(l));
  expect(rollups.length).toBe(1);
  const line = rollups[0] as string;
  expect(line).toMatch(/\b4 cards\b/);
  expect(line).toMatch(/\b1 open\b/);
  expect(line).toMatch(/\b1 proto\b/);
  expect(line).toMatch(/\b2 decided\b/);
  const sum = [...line.matchAll(/(\d+) (open|proto|decided)/g)].reduce((s, m) => s + Number(m[1]), 0);
  expect(sum).toBe(4);
});

// 11.2
test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = freshProject();
  card(p, "parent");
  card(p, "child", { parent: "parent" });
  card(p, "g1", { parent: "child", status: "open" });
  card(p, "g2", { parent: "child", status: "decided", who: "me" });
  const show = await ok(p, ["show", "parent"]);
  console.log("11.2 show:", show.out);
  const link = show.out.split("\n").find((l) => /<- refines\s+child\b/.test(l));
  expect(link).toBeDefined();
  expect(link).toMatch(/\(3 cards/);
  expect(show.out).toMatch(/^subtree: 4 cards/m);
});

// 11.3
test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = freshProject();
  card(p, "root");
  card(p, "base", { parent: "root", title: "Base card" });
  card(p, "price", { parent: "root", title: "We charge per seat" });
  seed(p, "edge.added", { from: "price", to: "base", type: "depends_on", why: "seats come from the base" });
  seed(p, "node.added", { id: "price:opt0", kind: "option", title: "Per project", why_not: "Projects vary" });
  seed(p, "edge.added", { from: "price:opt0", to: "price", type: "alternative_to" });
  seed(
    p,
    "excerpt.quoted",
    {
      id: "price:ex0",
      title: "Seats are what the buyer counts",
      card: "price",
      conversation: "c",
      session: "s",
      message: 0,
      start: 0,
      end: 31,
      speaker: "person",
      said_at: "t",
    },
    "agent",
  );
  await ok(p, [
    "add",
    "src-survey",
    "--kind",
    "source",
    "--title",
    "Buyer survey",
    "--finding",
    "8 of 10 pay per seat",
  ]);
  await ok(p, ["link", "price", "src-survey", "--type", "supported_by"]);
  const show = await ok(p, ["show", "price"]);
  console.log("11.3 show:", show.out);
  const out = show.out;
  expect(out).toMatch(/-> depends_on\s+base[^\n]*\n\s+why: seats come from the base/);
  const linksEnd = out.lastIndexOf("  -> ");
  const opt = out.indexOf("\nOptions\n");
  expect(opt).toBeGreaterThan(linksEnd);
  expect(out.slice(opt)).toContain("Per project");
  expect(out.slice(opt)).toContain("why not: Projects vary");
  expect(out).toMatch(/\nSay\n[^\n]*person: "Seats are what the buyer counts"/);
  expect(out).toMatch(/\nEv\n[^\n]*Buyer survey[^\n]*proposed\n\s+finding: 8 of 10 pay per seat/);
});

// 11.4
test("11.4 a card with no options prints no Options section", async () => {
  const p = freshProject();
  card(p, "price", { title: "We charge per seat" });
  seed(
    p,
    "excerpt.quoted",
    {
      id: "price:ex0",
      title: "Seats count",
      card: "price",
      conversation: "c",
      session: "s",
      message: 0,
      start: 0,
      end: 11,
      speaker: "person",
      said_at: "t",
    },
    "agent",
  );
  seed(p, "node.added", { id: "src-a", kind: "source", title: "A source", finding: "It found a thing" });
  seed(p, "edge.added", { from: "price", to: "src-a", type: "supported_by" });
  const show = await ok(p, ["show", "price"]);
  expect(show.out).toContain("\nSay\n");
  expect(show.out).toContain("\nEv\n");
  expect(show.out).not.toContain("\nOptions\n");
});

// 11.5
test("11.5 show with no id prints the root card", async () => {
  const p = freshProject();
  card(p, "root", { title: "The root card" });
  card(p, "second", { parent: "root", title: "Second card" });
  const show = await ok(p, ["show"]);
  console.log("11.5 show:", show.out);
  expect(show.out).toContain("The root card");
  expect(show.out).toMatch(/^subtree: 2 cards/m);
  expect(show.out).toMatch(/<- refines\s+second\s+Second card\s+\(1 card/);
});
