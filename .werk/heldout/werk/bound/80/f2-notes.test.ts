import { expect, test } from "bun:test";
import { mk } from "./lib.ts";

test("68.1 agent writes a note and sees it on the card", async () => {
  const h = mk();
  h.card("werk-chat", { title: "The composer sends a live agent turn", status: "decided" });
  const n = h.count();
  const r = await h.w("say", "#werk-chat", "The reply streams over SSE");
  expect(r.code).toBe(0);
  expect(h.count()).toBe(n + 1);
  const ev = h.events().at(-1);
  expect(ev.type).toBe("note.added");
  expect(ev.payload.id).toBe("werk-chat");
  expect(await h.ok("show", "#werk-chat")).toContain("The reply streams over SSE");
});

test("68.2 inbox shows a whole card thread in order (agent notes)", async () => {
  const h = mk();
  h.card("werk-chat", {});
  for (const t of ["first", "second", "third"]) await h.ok("say", "#werk-chat", t);
  const out = await h.ok("inbox");
  console.log(JSON.stringify(out));
  expect(out).toContain("#werk-chat");
  expect(out.indexOf("first")).toBeGreaterThan(-1);
  expect(out.indexOf("second")).toBeGreaterThan(out.indexOf("first"));
  expect(out.indexOf("third")).toBeGreaterThan(out.indexOf("second"));
});

test("68.3 inbox groups notes by card (agent notes)", async () => {
  const h = mk();
  h.card("werk-chat", {});
  h.card("visual", {});
  await h.ok("say", "#werk-chat", "chat one");
  await h.ok("say", "#visual", "visual one");
  await h.ok("say", "#werk-chat", "chat two");
  const out = await h.ok("inbox");
  console.log(JSON.stringify(out));
  const vi = out.indexOf("#visual");
  const ch = out.indexOf("#werk-chat");
  expect(vi).toBeGreaterThan(-1);
  expect(ch).toBeGreaterThan(-1);
  // one group per card: each id header once
  expect(out.split("#werk-chat").length - 1).toBe(1);
  expect(out.indexOf("chat one")).toBeLessThan(out.indexOf("chat two"));
  const chatGroupStart = ch;
  const visGroupStart = vi;
  const visualGroup = visGroupStart < chatGroupStart ? out.slice(visGroupStart, chatGroupStart) : out.slice(visGroupStart);
  expect(visualGroup).toContain("visual one");
  expect(visualGroup).not.toContain("chat one");
  expect(visualGroup).not.toContain("chat two");
});

test("68.4 agent note on a ghost card shows in inbox", async () => {
  const h = mk();
  h.card("visual", {});
  await h.ok("add", "werk-pane", "--title", "Pane");
  const r = await h.w("say", "#werk-pane", "Describe the pane here");
  expect(r.code).toBe(0);
  const out = await h.ok("inbox");
  console.log(JSON.stringify(out));
  expect(out).toContain("#werk-pane");
  expect(out).toContain("Describe the pane here");
});

test("68.5 note on unknown card fails and changes nothing", async () => {
  const h = mk();
  h.card("werk-chat", {});
  const size = h.logText().length;
  const r = await h.w("say", "#no-such-card", "lost note");
  expect(r.code).not.toBe(0);
  expect(r.err + r.out).toContain("no-such-card");
  expect(r.err + r.out).toMatch(/unknown|no node|not in the map/);
  expect(h.logText().length).toBe(size);
  expect(await h.ok("inbox")).not.toContain("lost note");
});

test("10.2 inbox lists person's notes in order, --since, -n (CLI side with person notes)", async () => {
  const h = mk();
  h.card("auth-login", { title: "Login" });
  for (const t of ["first", "second", "third", "fourth"]) h.seed("note.added", { id: "auth-login", text: t });
  const out = await h.ok("inbox");
  const entries = [...out.matchAll(/^\[(\d+)\] #(\S+)\s.*\n\s+(\S+)$/gm)].map(([, seq, id, text]) => ({ seq, id, text }));
  expect(entries.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(entries.every((e) => e.id === "auth-login")).toBe(true);
  const first = entries[0]!.seq;
  const since = await h.ok("inbox", "--since", first);
  expect(since).not.toContain("first");
  expect(since).toContain("second");
  expect(since).toContain("fourth");
  const capped = await h.ok("inbox", "--since", first, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.4 note on a discarded ghost stays in inbox (CLI side)", async () => {
  const h = mk();
  await h.ok("add", "cache-ttl", "--title", "TTL is 60s");
  h.seed("note.added", { id: "cache-ttl", text: "Why 60 seconds?" });
  await h.ok("discard", "cache-ttl");
  expect(await h.ok("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  await h.ok("add", "cache-ttl", "--title", "TTL is 30s");
  const out = await h.ok("show", "cache-ttl");
  expect(out).toContain("Why 60 seconds?");
  expect(out).toContain("proposed again");
});

test("66.1 remove takes subtree, keeps log history", async () => {
  const h = mk();
  h.card("storage", { title: "Storage" });
  h.card("cache", { title: "Cache", parent: "storage" });
  h.card("index", { title: "Index", parent: "storage" });
  h.card("eviction", { title: "Eviction", parent: "cache" });
  const before = h.logText().split("\n").filter(Boolean);
  expect((await h.w("remove", "cache", "--actor", "you")).code).toBe(0);
  const cache = await h.w("show", "cache");
  expect(cache.out + cache.err).toMatch(/removed/);
  const ev = await h.w("show", "eviction");
  expect(ev.out + ev.err).toMatch(/removed/);
  const st = await h.ok("show", "storage");
  expect(st).not.toContain("cache");
  expect(st).not.toContain("eviction");
  expect(st).toContain("index");
  expect(await h.ok("removed")).toContain("cache");
  const after = h.logText().split("\n").filter(Boolean);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.length).toBe(before.length + 1);
});

test("66.2 restore brings back subtree and links", async () => {
  const h = mk();
  h.card("storage", { title: "Storage" });
  h.card("cache", { title: "Cache", parent: "storage" });
  h.card("eviction", { title: "Eviction", parent: "cache" });
  h.card("memory-budget", { title: "Memory budget", status: "decided" });
  h.seed("edge.added", { from: "cache", to: "memory-budget", type: "depends_on", why: "needs budget" });
  await h.ok("remove", "cache", "--actor", "you");
  expect((await h.w("restore", "cache", "--actor", "you")).code).toBe(0);
  const c = await h.w("show", "cache");
  expect(c.code).toBe(0);
  expect(c.out + c.err).not.toMatch(/removed/);
  expect(c.out).toContain("memory-budget");
  expect(await h.ok("show", "storage")).toContain("cache");
  expect(await h.ok("show", "cache")).toContain("eviction");
  expect((await h.ok("removed")).trim()).not.toContain("cache");
});

test("66.3 remove with reparent lifts children", async () => {
  const h = mk();
  h.card("storage", { title: "Storage" });
  h.card("bad-layer", { title: "Bad layer", parent: "storage" });
  h.card("write-path", { title: "Write path", parent: "bad-layer" });
  h.card("read-path", { title: "Read path", parent: "bad-layer" });
  expect((await h.w("remove", "bad-layer", "--actor", "you", "--reparent")).code).toBe(0);
  const bl = await h.w("show", "bad-layer");
  expect(bl.out + bl.err).toMatch(/removed/);
  const st = await h.ok("show", "storage");
  expect(st).toMatch(/<- refines\s+write-path/);
  expect(st).toMatch(/<- refines\s+read-path/);
  for (const id of ["write-path", "read-path"]) {
    const r = await h.w("show", id);
    expect(r.code).toBe(0);
    expect(r.out + r.err).not.toMatch(/removed/);
  }
});
