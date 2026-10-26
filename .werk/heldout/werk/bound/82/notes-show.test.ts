import { expect, test } from "bun:test";
import { all, card, chat, events, freshProject, logLines, root, seed, w } from "./helpers.ts";

const dec = { status: "decided", who: "me" };

test("[68.1] an agent writes a note on a card and sees it on the card", async () => {
  const p = freshProject();
  root(p);
  card(p, "werk-chat", { title: "The composer sends a live agent turn", ...dec });
  const n = logLines(p).length;
  const r = await w(p, "say", "#werk-chat", "The reply streams over SSE");
  expect(r.code, all(r)).toBe(0);
  expect(logLines(p).length).toBe(n + 1);
  const ev = events(p).at(-1);
  expect(ev.type).toBe("note.added");
  expect(ev.payload.id).toBe("werk-chat");
  expect(all(await w(p, "show", "#werk-chat"))).toContain("The reply streams over SSE");
});

test("[68.2] an agent reads a whole card thread in order from the inbox", async () => {
  const p = freshProject();
  root(p);
  card(p, "werk-chat", { title: "Chat", ...dec });
  for (const t of ["first", "second", "third"]) await w(p, "say", "werk-chat", t);
  const r = await w(p, "inbox");
  expect(r.code, all(r)).toBe(0);
  expect(r.out).toContain("werk-chat");
  const i = ["first", "second", "third"].map((t) => r.out.indexOf(t));
  expect(i.every((x) => x >= 0)).toBe(true);
  expect(i[0]).toBeLessThan(i[1] as number);
  expect(i[1]).toBeLessThan(i[2] as number);
});

test("[68.3] the inbox groups notes by card", async () => {
  const p = freshProject();
  root(p);
  card(p, "werk-chat", { title: "Chat", ...dec });
  card(p, "visual", { title: "Visual", ...dec });
  await w(p, "say", "werk-chat", "chat one");
  await w(p, "say", "visual", "visual one");
  await w(p, "say", "werk-chat", "chat two");
  const r = await w(p, "inbox");
  const o = r.out;
  // group: each card id appears once as a heading, its notes beneath it.
  const chatAt = o.indexOf("werk-chat");
  const visAt = o.indexOf("visual");
  expect(chatAt).toBeGreaterThanOrEqual(0);
  expect(visAt).toBeGreaterThanOrEqual(0);
  const first = Math.min(chatAt, visAt);
  const second = Math.max(chatAt, visAt);
  const groupA = o.slice(first, second);
  const groupB = o.slice(second);
  const chatGroup = chatAt < visAt ? groupA : groupB;
  const visGroup = chatAt < visAt ? groupB : groupA;
  expect(chatGroup.indexOf("chat one")).toBeGreaterThanOrEqual(0);
  expect(chatGroup.indexOf("chat two")).toBeGreaterThan(chatGroup.indexOf("chat one"));
  expect(visGroup).toContain("visual one");
  expect(visGroup).not.toContain("chat one");
  expect(visGroup).not.toContain("chat two");
});

test("[68.4] an agent writes a note on a ghost card", async () => {
  const p = freshProject();
  root(p);
  card(p, "visual", { title: "Visual", ...dec });
  await w(p, "add", "werk-pane", "--title", "");
  const p2 = freshProject();
  root(p2);
  card(p2, "visual", { title: "Visual", ...dec });
  seed(p2, "node.proposed", { id: "werk-pane", kind: "card", title: "Pane", parent: "root" });
  seed(p2, "edge.added", { from: "visual", to: "werk-pane", type: "depends_on", why: "needs it" });
  const r = await w(p2, "say", "#werk-pane", "Describe the pane here");
  expect(r.code, all(r)).toBe(0);
  const i = await w(p2, "inbox");
  expect(i.out).toContain("werk-pane");
  expect(i.out).toContain("Describe the pane here");
});

test("[68.5] a note on an unknown card fails and changes nothing", async () => {
  const p = freshProject();
  root(p);
  card(p, "werk-chat", { title: "Chat", ...dec });
  const n = logLines(p).length;
  const r = await w(p, "say", "#no-such-card", "lost note");
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("no-such-card");
  expect(all(r)).toMatch(/unknown|no node|not in the map/i);
  expect(logLines(p).length).toBe(n);
  expect((await w(p, "inbox")).out).not.toContain("lost note");
});

test("[10.2-cli] say on an excerpt", async () => {
  const p = freshProject();
  root(p);
  chat(p, "oauth", [{ kind: "spoken", text: "The client MAY retry." }]);
  await w(p, "quote", "root", "oauth", "MAY retry");
  const r = await w(p, "say", "root:ex0", "This quote supports the retry decision");
  expect(r.code, all(r)).toBe(0);
});

test("[11.1] the rollup counts the card and its refines subtree", async () => {
  const p = freshProject();
  root(p);
  card(p, "r", { title: "R", ...dec, parent: undefined });
  card(p, "c1", { title: "C1", parent: "r", status: "open" });
  card(p, "c2", { title: "C2", parent: "r", status: "proto" });
  card(p, "g", { title: "G", parent: "c1", ...dec });
  const s = all(await w(p, "show", "r"));
  const lines = s.split("\n").filter((l) => l.startsWith("subtree"));
  expect(lines.length).toBe(1);
  expect(lines[0]).toBe("subtree: 4 cards, 1 open, 1 proto, 2 decided");
});

test("[11.2] each incoming refines link shows the child's own rollup", async () => {
  const p = freshProject();
  root(p);
  card(p, "parent", { title: "Parent", ...dec });
  card(p, "child", { title: "Child", parent: "parent", ...dec });
  card(p, "g1", { title: "G1", parent: "child", status: "open" });
  card(p, "g2", { title: "G2", parent: "child", ...dec });
  const s = all(await w(p, "show", "parent"));
  expect(s).toMatch(/<- refines\s+child\s+Child\s+\(3 cards/);
  expect(s).toContain("subtree: 4 cards");
});

test("[11.3] a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = freshProject();
  root(p);
  card(p, "basis", { title: "Basis", ...dec });
  card(p, "c", { title: "C", ...dec });
  seed(p, "edge.added", { from: "c", to: "basis", type: "depends_on", why: "takes the basis" });
  seed(p, "node.added", { id: "c:opt", kind: "option", title: "The other way", why_not: "it is slower" });
  seed(p, "edge.added", { from: "c:opt", to: "c", type: "alternative_to" });
  chat(p, "talk", [{ kind: "spoken", text: "we said exact words here", speaker: "person" }]);
  await w(p, "quote", "c", "talk", "exact words");
  seed(p, "node.proposed", { id: "c:src", kind: "source", title: "A study", finding: "it found a thing" });
  seed(p, "edge.added", { from: "c", to: "c:src", type: "supported_by" });
  const s = all(await w(p, "show", "c"));
  expect(s).toMatch(/depends_on\s+basis/);
  expect(s).toContain("takes the basis");
  const iO = s.indexOf("Options");
  expect(iO).toBeGreaterThan(s.indexOf("depends_on"));
  expect(s.slice(iO)).toContain("The other way");
  expect(s.slice(iO)).toContain("it is slower");
  expect(s).toMatch(/Say\n[\s\S]*person[\s\S]*exact words/);
  expect(s).toMatch(/Ev\n[\s\S]*A study[\s\S]*it found a thing/);
  const ev = s.slice(s.indexOf("Ev\n"));
  expect(ev).toContain("proposed");
});

test("[11.4] a card with no options prints no Options section", async () => {
  const p = freshProject();
  root(p);
  card(p, "c", { title: "C", ...dec });
  chat(p, "talk", [{ kind: "spoken", text: "we said exact words here" }]);
  await w(p, "quote", "c", "talk", "exact words");
  seed(p, "node.added", { id: "c:src", kind: "source", title: "A study", finding: "found" });
  seed(p, "edge.added", { from: "c", to: "c:src", type: "supported_by" });
  const s = all(await w(p, "show", "c"));
  expect(s).toContain("Say");
  expect(s).toContain("Ev");
  expect(s).not.toContain("Options");
});

test("[11.5] show with no id prints the root card", async () => {
  const p = freshProject();
  root(p);
  card(p, "second", { title: "Second", status: "open" });
  const s = all(await w(p, "show"));
  expect(s).toContain("Root");
  expect(s).toContain("subtree: 2 cards");
  expect(s).toMatch(/<- refines\s+second\s+Second\s+\(1 card/);
});
