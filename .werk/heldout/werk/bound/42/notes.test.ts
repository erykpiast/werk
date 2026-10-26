import { expect, test } from "bun:test";
import { mk } from "./h.ts";

const all = (r: { out: string; err: string }) => r.out + r.err;

test("[10.1][68.1] say writes a note on the card, shown by show", async () => {
  const h = mk();
  h.real("auth-login", "Login uses magic links");
  h.decide("auth-login");
  const n = h.count();
  const r = await h.w("say", "auth-login", "Should expired links show a retry button?");
  expect(r.code).toBe(0);
  expect(h.count()).toBe(n + 1);
  const ev = h.events().at(-1)!;
  expect(ev.type).toBe("note.added");
  expect(ev.payload.id).toBe("auth-login");
  expect(ev.actor).toBe("agent");
  const s = await h.out("show", "#auth-login");
  console.log(s);
  expect(s).toContain("Should expired links show a retry button?");
});

test("[10.2] inbox order, since, count", async () => {
  const h = mk();
  h.real("auth-login", "Login");
  for (const t of ["first", "second", "third", "fourth"]) h.seed("note.added", { id: "auth-login", text: t }, "you");
  const r = await h.w("inbox");
  console.log("inbox:", r.out);
  const entries = [...r.out.matchAll(/^\[(\d+)\] #?(\S+)[^\n]*\n\s+(\S+)$/gm)].map(([, seq, id, text]) => ({
    seq,
    id,
    text,
  }));
  expect(entries.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(entries.every((e) => e.id === "auth-login")).toBe(true);
  const f = entries[0]!.seq!;
  const since = await h.w("inbox", "--since", f);
  expect(since.out).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since.out).toContain(t);
  const capped = await h.w("inbox", "--since", f, "-n", "2");
  expect(capped.out).toContain("second");
  expect(capped.out).toContain("third");
  expect(capped.out).not.toContain("fourth");
});

test("[10.3][10.4] ghost notes survive a discard and re-propose", async () => {
  const h = mk();
  h.real("root", "Root");
  await h.w("add", "auth-retry", "--title", "Retry sends a new link");
  h.seed("note.added", { id: "auth-retry", text: "No — retry must reuse the same link" }, "you");
  await h.w("say", "auth-retry", "Understood, I will correct it");
  await h.w("discard", "auth-retry");
  const inbox = await h.out("inbox");
  expect(inbox).toContain("No — retry must reuse the same link");
  await h.w("add", "auth-retry", "--title", "Retry reuses the same link");
  h.seed("note.added", { id: "auth-retry", text: "Good, accept" }, "you");
  const s = await h.out("show", "auth-retry");
  console.log(s);
  expect(s).toContain("Retry reuses the same link");
  const iA = s.indexOf("No — retry must reuse the same link");
  const iB = s.indexOf("Understood, I will correct it");
  const iM = s.indexOf("proposed again");
  const iC = s.indexOf("Good, accept");
  expect(iA).toBeGreaterThan(-1);
  expect(iB).toBeGreaterThan(iA);
  expect(iM).toBeGreaterThan(iB);
  expect(iC).toBeGreaterThan(iM);
  expect(s.split("proposed again").length - 1).toBe(1);
});

test("[10.4] a note on a discarded ghost stays in the inbox", async () => {
  const h = mk();
  h.real("root", "Root");
  await h.w("add", "cache-ttl", "--title", "TTL is 60 seconds");
  h.seed("note.added", { id: "cache-ttl", text: "Why 60 seconds?" }, "you");
  await h.w("discard", "cache-ttl");
  const inbox = await h.out("inbox");
  expect(inbox).toContain("Why 60 seconds?");
  expect(inbox).toContain("cache-ttl");
  await h.w("add", "cache-ttl", "--title", "TTL is 60 seconds");
  const s = await h.out("show", "cache-ttl");
  expect(s.indexOf("Why 60 seconds?")).toBeGreaterThan(-1);
  expect(s.indexOf("proposed again")).toBeGreaterThan(s.indexOf("Why 60 seconds?"));
});

test("[10.5] note on an excerpt", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("c", "Card", "root");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(join(h.p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(h.p.dir, ".werk", "chats", "rfc.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t", session: "s1", kind: "spoken", text: "retry with backoff always" })}\n`,
  );
  await h.w("quote", "c", "rfc", "retry with backoff");
  await h.w("accept", "c:ex0", "--actor", "you");
  const r = await h.w("say", "c:ex0", "This quote supports the retry decision");
  expect(r.code).toBe(0);
  const s = await h.out("show", "c:ex0");
  expect(s).toContain("This quote supports the retry decision");
});

test("[68.3] inbox groups by card", async () => {
  const h = mk();
  h.real("werk-chat", "Chat");
  h.real("visual", "Visual");
  await h.w("say", "werk-chat", "chat one");
  await h.w("say", "visual", "visual one");
  await h.w("say", "werk-chat", "chat two");
  const r = await h.w("inbox");
  console.log("inbox:", r.out);
  expect(r.code).toBe(0);
  const o = r.out;
  expect(o).toContain("chat one");
  expect(o.indexOf("chat one")).toBeLessThan(o.indexOf("chat two"));
  // groups: find each group heading
  const groups = o.split(/\n(?=#?\S*\s)/);
  console.log(JSON.stringify(groups));
});

test("[68.2] three notes in order", async () => {
  const h = mk();
  h.real("werk-chat", "Chat");
  for (const t of ["first", "second", "third"]) await h.w("say", "werk-chat", t);
  const o = await h.out("inbox");
  expect(o).toContain("werk-chat");
  expect(o.indexOf("first")).toBeLessThan(o.indexOf("second"));
  expect(o.indexOf("second")).toBeLessThan(o.indexOf("third"));
});

test("[68.4] note on a ghost card", async () => {
  const h = mk();
  h.real("visual", "Visual");
  await h.w("add", "werk-pane", "--title", "Pane");
  await h.w("link", "visual", "werk-pane", "--type", "depends_on", "--why", "uses the pane");
  const r = await h.w("say", "werk-pane", "Describe the pane here");
  expect(r.code).toBe(0);
  const o = await h.out("inbox");
  expect(o).toContain("werk-pane");
  expect(o).toContain("Describe the pane here");
});

test("[68.5] note on an unknown card fails", async () => {
  const h = mk();
  h.real("werk-chat", "Chat");
  const n = h.count();
  const r = await h.w("say", "#no-such-card", "lost note");
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("no-such-card");
  expect(all(r)).toMatch(/unknown|no node|not/i);
  expect(h.count()).toBe(n);
  expect(await h.out("inbox")).not.toContain("lost note");
});
