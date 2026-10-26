import { expect, test } from "bun:test";
import { card, chat, chatLine, events, lines, ok, seed, serve, w, withRoot } from "./h.ts";

async function note(s: Awaited<ReturnType<typeof serve>>, id: string, text: string) {
  const r = await s.post("/api/notes", { id, text });
  expect(r.status).toBe(200);
}

test("10.1 agent note shows on the card thread, marked as agent", async () => {
  const p = withRoot();
  seed(p, [card("auth-login", "Login uses magic links", { status: "decided", parent: "root" })]);
  await ok(p, "say", "auth-login", "Should expired links show a retry button?");
  const show = (await ok(p, "show", "auth-login")).out;
  expect(show).toMatch(/Thread\n\s+\[\d+\] agent: Should expired links show a retry button\?/);
  const s = await serve(p);
  const html = await (await s.get("/api/card/auth-login")).json();
  expect(html.html).toContain("Should expired links show a retry button?");
  expect(html.html.toLowerCase()).toContain("agent");
});

test("10.2 inbox lists the person's notes in order; since and -n narrow", async () => {
  const p = withRoot();
  seed(p, [card("auth-login", "Login", { parent: "root" })]);
  const s = await serve(p);
  for (const t of ["first", "second", "third", "fourth"]) await note(s, "auth-login", t);
  const all = (await ok(p, "inbox")).out;
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(all.match(/\[(\d+)\] #auth-login/g)?.length).toBe(4);
  const firstSeq = Number(/\[(\d+)\] #auth-login[^\n]*\n\s+first/.exec(all)?.[1]);
  expect(firstSeq).toBeGreaterThan(0);
  const since = (await ok(p, "inbox", "--since", String(firstSeq))).out;
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = (await ok(p, "inbox", "--since", String(firstSeq), "-n", "2")).out;
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3 corrected ghost keeps earlier notes, one marker", async () => {
  const p = withRoot();
  await ok(p, "add", "auth-retry", "--title", "Retry sends a new link");
  const s = await serve(p);
  await note(s, "auth-retry", "No — retry must reuse the same link");
  await ok(p, "say", "auth-retry", "Understood, I will correct it");
  await ok(p, "discard", "auth-retry");
  await ok(p, "add", "auth-retry", "--title", "Retry reuses the same link");
  await note(s, "auth-retry", "Good, accept");
  const show = (await ok(p, "show", "auth-retry")).out;
  expect(show).toContain("Retry reuses the same link");
  const a = show.indexOf("No — retry must reuse the same link");
  const b = show.indexOf("Understood, I will correct it");
  const m = show.indexOf("proposed again");
  const c = show.indexOf("Good, accept");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  expect(m).toBeGreaterThan(b);
  expect(show.match(/proposed again/g)?.length).toBe(1);
  expect(c).toBeGreaterThan(m);
  const card = await (await s.get("/api/card/auth-retry")).json();
  expect(card.html).toContain("Good, accept");
  expect(card.html.match(/proposed again/g)?.length).toBe(1);
});

test("10.4 note on discarded ghost stays in inbox and on thread", async () => {
  const p = withRoot();
  await ok(p, "add", "cache-ttl", "--title", "TTL is 60 seconds");
  const s = await serve(p);
  await note(s, "cache-ttl", "Why 60 seconds?");
  await ok(p, "discard", "cache-ttl");
  expect((await ok(p, "inbox")).out).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  await ok(p, "add", "cache-ttl", "--title", "TTL is 60 seconds");
  const show = (await ok(p, "show", "cache-ttl")).out;
  expect(show.indexOf("Why 60 seconds?")).toBeGreaterThan(-1);
  expect(show.indexOf("proposed again")).toBeGreaterThan(show.indexOf("Why 60 seconds?"));
  expect(show.match(/proposed again/g)?.length).toBe(1);
});

test("10.5 agent note on an excerpt", async () => {
  const p = withRoot();
  // An excerpt id comes only from a quote; the step names its id, so the log gets the quote event with that id.
  seed(p, [
    card("c", "Cited", { parent: "root" }),
    { type: "node.added", payload: { id: "rfc", kind: "source", title: "RFC" } },
    {
      type: "excerpt.quoted",
      payload: { id: "src-rfc-quote", title: "retry is safe", card: "c", conversation: "conv", session: "s", message: 0, start: 0, end: 13, speaker: "person", said_at: "t" },
    },
  ]);
  const r = await w(p, "say", "src-rfc-quote", "This quote supports the retry decision");
  expect(r.code).toBe(0);
  const s = await serve(p);
  const html = await (await s.get("/api/card/src-rfc-quote")).json();
  expect(html.html).toContain("This quote supports the retry decision");
});

// ---- 68 ----
test("68.1 say then show", async () => {
  const p = withRoot();
  seed(p, [card("werk-chat", "The composer sends a live agent turn", { status: "decided", parent: "root" })]);
  const n = lines(p).length;
  const r = await w(p, "say", "#werk-chat", "The reply streams over SSE");
  expect(r.code).toBe(0);
  expect(lines(p).length).toBe(n + 1);
  const e = events(p).at(-1);
  expect(e.type).toBe("note.added");
  expect(e.payload.id).toBe("werk-chat");
  expect((await ok(p, "show", "#werk-chat")).out).toContain("The reply streams over SSE");
});

test("68.2 agent reads a whole thread in order from the inbox", async () => {
  const p = withRoot();
  seed(p, [card("werk-chat", "Chat", { parent: "root" })]);
  for (const t of ["first", "second", "third"]) await ok(p, "say", "werk-chat", t);
  const out = (await ok(p, "inbox")).out;
  expect(out).toContain("#werk-chat");
  const i = ["first", "second", "third"].map((t) => out.indexOf(t));
  expect(i.every((x) => x >= 0)).toBe(true);
  expect([...i].sort((a, b) => a - b)).toEqual(i);
});

test("68.3 inbox groups notes by card", async () => {
  const p = withRoot();
  seed(p, [card("werk-chat", "Chat", { parent: "root" }), card("visual", "Visual", { parent: "root" })]);
  await ok(p, "say", "werk-chat", "chat one");
  await ok(p, "say", "visual", "visual one");
  await ok(p, "say", "werk-chat", "chat two");
  const out = (await ok(p, "inbox")).out;
  expect(out).toContain("chat one");
  expect(out).toContain("chat two");
  expect(out).toContain("visual one");
});

test("68.4 note on a ghost card shows in inbox", async () => {
  const p = withRoot();
  seed(p, [card("visual", "Visual", { parent: "root" })]);
  await ok(p, "add", "werk-pane", "--title", "Pane");
  await ok(p, "link", "visual", "werk-pane", "--type", "depends_on", "--why", "uses the pane");
  expect((await w(p, "say", "werk-pane", "Describe the pane here")).code).toBe(0);
  const out = (await ok(p, "inbox")).out;
  expect(out).toContain("#werk-pane");
  expect(out).toContain("Describe the pane here");
});

test("68.5 note on unknown card fails and changes nothing", async () => {
  const p = withRoot();
  seed(p, [card("werk-chat", "Chat", { parent: "root" })]);
  const n = lines(p).length;
  const r = await w(p, "say", "#no-such-card", "lost note");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no-such-card");
  expect(r.err).toContain("unknown");
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "inbox")).out).not.toContain("lost note");
});
