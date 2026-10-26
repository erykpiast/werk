import { expect, test } from "bun:test";
import { freshProject, type Project } from "../src/test/project.ts";
import { card, decided, events, lines, ok, proposed, root, seed, w } from "./h.ts";

const note = (id: string, text: string, actor = "you") => ({ type: "note.added", actor, payload: { id, text } });
const base = () => {
  const p = freshProject();
  seed(p, [...root()]);
  return p;
};
const show = async (p: Project, id: string) => (await w(p, ["show", id])).out;
const posOf = (inbox: string, text: string) => {
  const m = new RegExp(`\\[(\\d+)\\][^\\n]*\\n\\s+${text}\\b`).exec(inbox);
  return m ? m[1]! : undefined;
};

test("10.2", async () => {
  const p = base();
  seed(p, [decided("auth-login"), note("auth-login", "first"), note("auth-login", "second"), note("auth-login", "third"), note("auth-login", "fourth")]);
  let s = (await ok(p, ["inbox"])).out;
  const order = ["first", "second", "third", "fourth"].map((t) => s.indexOf(t));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(s).toContain("auth-login");
  const first = posOf(s, "first")!;
  expect(first).toBeDefined();
  s = (await ok(p, ["inbox", "--since", first])).out;
  expect(s).toContain("second");
  expect(s).toContain("fourth");
  expect(s).not.toContain("first");
  s = (await ok(p, ["inbox", "--since", first, "-n", "2"])).out;
  expect(s).toContain("second");
  expect(s).toContain("third");
  expect(s).not.toContain("fourth");
  expect(s).not.toContain("first");
});

test("10.3 (thread via show)", async () => {
  const p = base();
  await ok(p, ["add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root"]);
  seed(p, [note("auth-retry", "No — retry must reuse the same link")]);
  await ok(p, ["say", "auth-retry", "Understood, I will correct it"]);
  await ok(p, ["discard", "auth-retry"]);
  await ok(p, ["add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root"]);
  const s = await show(p, "auth-retry");
  console.log("10.3 show:", s);
  expect(s).toContain("No — retry must reuse the same link");
  expect(s).toContain("Understood, I will correct it");
  expect(s.match(/proposed again/g)?.length).toBe(1);
  expect(s).toContain("Retry reuses the same link");
  expect(s.indexOf("proposed again")).toBeGreaterThan(s.indexOf("Understood"));
  seed(p, [note("auth-retry", "Good, accept")]);
  const s2 = await show(p, "auth-retry");
  expect(s2.indexOf("Good, accept")).toBeGreaterThan(s2.indexOf("proposed again"));
});

test("10.4 inbox part", async () => {
  const p = base();
  await ok(p, ["add", "cache-ttl", "--title", "TTL", "--parent", "root"]);
  seed(p, [note("cache-ttl", "Why 60 seconds?")]);
  await ok(p, ["discard", "cache-ttl"]);
  let s = (await ok(p, ["inbox"])).out;
  expect(s).toContain("Why 60 seconds?");
  expect(s).toContain("cache-ttl");
  await ok(p, ["add", "cache-ttl", "--title", "TTL again", "--parent", "root"]);
  const sh = await show(p, "cache-ttl");
  expect(sh).toContain("Why 60 seconds?");
  expect(sh.match(/proposed again/g)?.length).toBe(1);
  expect(sh.indexOf("proposed again")).toBeGreaterThan(sh.indexOf("Why 60 seconds?"));
});

test("10.5", async () => {
  const p = base();
  seed(p, [decided("c"), { type: "node.added", payload: { id: "rfc", kind: "source", title: "RFC" } }, {
    type: "excerpt.quoted", actor: "agent", payload: { id: "src-rfc-quote", title: "words", card: "c", conversation: "x", session: "s", message: 0, start: 0, end: 5, speaker: "person", said_at: "t" } }]);
  const r = await w(p, ["say", "src-rfc-quote", "This quote supports the retry decision"]);
  expect(r.code).toBe(0);
  expect(await show(p, "src-rfc-quote")).toContain("This quote supports the retry decision");
});

test("68.1", async () => {
  const p = base();
  seed(p, [decided("werk-chat", { title: "The composer sends a live agent turn" })]);
  const n = lines(p).length;
  const r = await w(p, ["say", "#werk-chat", "The reply streams over SSE"]);
  expect(r.code).toBe(0);
  expect(lines(p).length).toBe(n + 1);
  const ev = events(p)[n]!;
  expect(ev.type).toBe("note.added");
  expect(ev.payload.id).toBe("werk-chat");
  expect((await w(p, ["show", "#werk-chat"])).out).toContain("The reply streams over SSE");
});

test("68.2", async () => {
  const p = base();
  seed(p, [decided("werk-chat")]);
  for (const t of ["first", "second", "third"]) await ok(p, ["say", "werk-chat", t]);
  const s = (await ok(p, ["inbox"])).out;
  console.log("68.2 inbox:", JSON.stringify(s));
  expect(s).toContain("werk-chat");
  expect(s.indexOf("first")).toBeGreaterThanOrEqual(0);
  expect(s.indexOf("second")).toBeGreaterThan(s.indexOf("first"));
  expect(s.indexOf("third")).toBeGreaterThan(s.indexOf("second"));
});

test("68.3", async () => {
  const p = base();
  seed(p, [decided("werk-chat"), decided("visual")]);
  await ok(p, ["say", "werk-chat", "chat one"]);
  await ok(p, ["say", "visual", "visual one"]);
  await ok(p, ["say", "werk-chat", "chat two"]);
  const s = (await ok(p, ["inbox"])).out;
  console.log("68.3 inbox:", JSON.stringify(s));
  // groups: the notes of one card sit together
  expect(s).toContain("chat one");
  const iv = s.indexOf("visual one");
  expect(iv).toBeGreaterThanOrEqual(0);
  const c1 = s.indexOf("chat one");
  const c2 = s.indexOf("chat two");
  expect(c2).toBeGreaterThan(c1);
  expect(iv < c1 || iv > c2).toBe(true);
});

test("68.4", async () => {
  const p = base();
  seed(p, [decided("visual"), proposed("werk-pane", { title: "Pane" }), { type: "edge.added", payload: { from: "visual", to: "werk-pane", type: "supported_by" } }]);
  const r = await w(p, ["say", "werk-pane", "Describe the pane here"]);
  expect(r.code).toBe(0);
  const s = (await ok(p, ["inbox"])).out;
  console.log("68.4 inbox:", JSON.stringify(s));
  expect(s).toContain("werk-pane");
  expect(s).toContain("Describe the pane here");
});

test("68.5", async () => {
  const p = base();
  seed(p, [decided("werk-chat")]);
  const n = lines(p).length;
  const r = await w(p, ["say", "#no-such-card", "lost note"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no-such-card");
  expect(r.err).toMatch(/unknown/);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["inbox"])).out).not.toContain("lost note");
});
