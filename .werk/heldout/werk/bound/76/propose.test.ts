import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { card, chat, chatLine, events, lines, logPath, ok, real, seed, w, withRoot } from "./h.ts";

test("62.1 propose, then accept; log only grows at the end", async () => {
  const p = withRoot();
  seed(p, [card("x", "X", { parent: "root" })]);
  const before = lines(p);
  const r = await ok(p, "add", "use-log", "--title", "Use a log", "--body", "Append only.", "--why", "History matters.");
  expect(r.out).toContain("proposed");
  const a = lines(p);
  expect(a.length).toBe(before.length + 1);
  expect(a.slice(0, before.length)).toEqual(before);
  const s = (await ok(p, "show", "use-log")).out;
  for (const t of ["Use a log", "Append only.", "History matters.", "proposed"]) expect(s).toContain(t);
  const acc = await w(p, "accept", "use-log", "--actor", "you");
  expect(acc.code).toBe(0);
  const b = lines(p);
  expect(b.length).toBe(a.length + 1);
  expect(b.slice(0, a.length)).toEqual(a);
  const s2 = (await ok(p, "show", "use-log")).out;
  for (const t of ["Use a log", "Append only.", "History matters."]) expect(s2).toContain(t);
  expect(s2.split("\n")[0]).not.toContain("proposed");
});

test("62.2 accept without the claim refuses", async () => {
  const p = withRoot();
  await ok(p, "add", "c1", "--title", "A card");
  const n = lines(p).length;
  const r = await w(p, "accept", "c1");
  expect(r.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "show", "c1")).out.split("\n")[0]).toContain("proposed");
  await ok(p, "accept", "c1", "--actor", "you");
  expect((await ok(p, "show", "c1")).out.split("\n")[0]).not.toContain("proposed");
});

test("62.3 ghost words are frozen", async () => {
  const p = withRoot();
  await ok(p, "add", "c1", "--title", "Use a log");
  const n = lines(p).length;
  for (const args of [
    ["edit", "c1", "--body", "new body"],
    ["retitle", "c1", "Use an append-only log"],
    ["add", "c1", "--title", "Different title"],
  ]) {
    const r = await w(p, ...args);
    expect(r.code).not.toBe(0);
    expect(lines(p).length).toBe(n);
  }
  const s = (await ok(p, "show", "c1")).out;
  expect(s).toContain("Use a log");
  expect(s).not.toContain("append-only");
  expect(s.split("\n")[0]).toContain("proposed");
});

test("62.4 retitle on a real card keeps the old title in the log", async () => {
  const p = withRoot();
  await real(p, "c1", "Use a log");
  const n = lines(p).length;
  const r = await w(p, "retitle", "c1", "Use an append-only log");
  expect(r.code).toBe(0);
  expect(lines(p).length).toBe(n + 1);
  const s = (await ok(p, "show", "c1")).out;
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(readFileSync(logPath(p), "utf8")).toContain('"title":"Use a log"');
  await ok(p, "edit", "c1", "--body", "A new body.");
  const s2 = (await ok(p, "show", "c1")).out;
  expect(s2).toContain("A new body.");
  expect(s2).toContain("Use an append-only log");
});

test("62.5 option, source and excerpt enter as ghosts", async () => {
  const p = withRoot();
  await real(p, "c1", "Real card");
  chat(p, "conv", [chatLine("spoken", "an excerpt is words someone said", "person")]);
  const n0 = lines(p).length;
  const o = await ok(p, "add", "c1:opt", "--kind", "option", "--title", "Alt", "--why_not", "too slow");
  expect(o.out).toContain("proposed");
  expect(lines(p).length).toBe(n0 + 1);
  const s = await ok(p, "add", "src", "--kind", "source", "--title", "Src", "--finding", "f", "--url", "http://x");
  expect(s.out).toContain("proposed");
  expect(lines(p).length).toBe(n0 + 2);
  const q = await ok(p, "quote", "c1", "conv", "words someone said");
  expect(q.out).toContain("proposed");
  expect(lines(p).length).toBe(n0 + 3);
  const exId = /^(\S+):/.exec(q.out)?.[1] as string;
  for (const id of ["c1:opt", "src", exId]) expect((await ok(p, "show", id)).out.split("\n")[0]).toContain("proposed");
  expect((await ok(p, "show", "c1:opt")).out).toContain("why not: too slow");
  await ok(p, "link", "c1:opt", "c1", "--type", "alternative_to");
  await ok(p, "accept", "c1:opt", "--actor", "you");
  const opt = (await ok(p, "show", "c1:opt")).out;
  expect(opt.split("\n")[0]).not.toContain("proposed");
  expect(opt).toContain("why not: too slow");
  expect((await ok(p, "show", "src")).out.split("\n")[0]).toContain("proposed");
  expect((await ok(p, "show", exId)).out.split("\n")[0]).toContain("proposed");
});

// ---- 63 ----
test("63.1 a link to a ghost is held, goes live on accept, no extra link event", async () => {
  const p = withRoot();
  await real(p, "storage", "Storage");
  await ok(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await ok(p, "link", "sqlite", "storage", "--type", "depends_on", "--why", "stores in storage");
  expect((await ok(p, "show", "sqlite")).out).toMatch(/depends_on\s+storage\s+Storage\s+\(held\)/);
  expect((await ok(p, "show", "storage")).out).not.toMatch(/depends_on\s+sqlite|<- depends_on/);
  await ok(p, "accept", "sqlite", "--actor", "you");
  const live = (await ok(p, "show", "sqlite")).out;
  expect(live).toMatch(/-> depends_on\s+storage\s+Storage\n/);
  expect(live).not.toContain("held");
  expect(events(p).filter((e) => e.type === "edge.added" && e.payload.type === "depends_on").length).toBe(1);
});

test("63.2 accept takes the ghost parent but not a ghost it depends on", async () => {
  const p = withRoot();
  await real(p, "platform", "Platform");
  await ok(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await ok(p, "add", "magic", "--title", "Magic links", "--parent", "auth");
  await ok(p, "add", "email", "--title", "Email service", "--parent", "platform");
  await ok(p, "link", "magic", "email", "--type", "depends_on", "--why", "sends mail");
  await ok(p, "accept", "magic", "--actor", "you");
  expect((await ok(p, "show", "magic")).out.split("\n")[0]).not.toContain("proposed");
  const auth = (await ok(p, "show", "auth")).out;
  expect(auth.split("\n")[0]).not.toContain("proposed");
  expect(auth).toContain("parent: platform");
  expect((await ok(p, "show", "email")).out.split("\n")[0]).toContain("proposed");
  expect((await ok(p, "show", "magic")).out).toMatch(/depends_on\s+email\s+Email service\s+\(ghost, held\)/);
});

test("63.3 accept takes own ghost options and sources; status and who work on a ghost", async () => {
  const p = withRoot();
  await real(p, "storage", "Storage");
  await ok(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await ok(p, "add", "sqlite:pg", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  await ok(p, "link", "sqlite:pg", "sqlite", "--type", "alternative_to");
  await ok(p, "add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast");
  await ok(p, "link", "sqlite", "bench", "--type", "supported_by");
  const who = await w(p, "edit", "sqlite", "--who", "me");
  expect(who.code).toBe(0);
  const d = await w(p, "status", "sqlite", "decided");
  expect(d.err).toBe("");
  expect(d.code).toBe(0);
  await ok(p, "accept", "sqlite", "--actor", "you");
  const s = (await ok(p, "show", "sqlite")).out;
  expect(s).toContain("[decided]");
  expect(s).toContain("who: me");
  const opt = (await ok(p, "show", "sqlite:pg")).out;
  expect(opt.split("\n")[0]).not.toContain("proposed");
  expect(opt).toContain("why not: needs a server");
  const src = (await ok(p, "show", "bench")).out;
  expect(src.split("\n")[0]).not.toContain("proposed");
  expect(src).toMatch(/supported_by\s+sqlite\s+Use SQLite\n/);
});

test("63.4 discarding a ghost parent discards its branch", async () => {
  const p = withRoot();
  await real(p, "platform", "Platform");
  await ok(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await ok(p, "add", "magic", "--title", "Magic links", "--parent", "auth");
  await ok(p, "add", "magic:pw", "--kind", "option", "--title", "Passwords", "--why_not", "weak");
  await ok(p, "link", "magic:pw", "magic", "--type", "alternative_to");
  await ok(p, "discard", "auth");
  for (const id of ["auth", "magic", "magic:pw"]) expect((await w(p, "show", id)).code).not.toBe(0);
  const plat = (await ok(p, "show", "platform")).out;
  expect(plat).not.toContain("ghost");
  expect(plat).not.toMatch(/<- refines\s+auth/);
});

test("63.5 a ghost changes no count of a real card until accepted", async () => {
  const p = withRoot();
  seed(p, [card("storage", "Storage", { parent: "root" }), card("kid", "Kid", { status: "decided", parent: "storage" })]);
  const before = (await ok(p, "show", "storage")).out;
  expect(before).toMatch(/subtree: 2 cards/);
  await ok(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--status", "open");
  await ok(p, "add", "sqlite:o", "--kind", "option", "--title", "Alt", "--why_not", "no");
  await ok(p, "link", "sqlite:o", "sqlite", "--type", "alternative_to");
  const after = (await ok(p, "show", "storage")).out;
  const sub = (o: string) => /subtree: [^\n]*/.exec(o)?.[0];
  expect(sub(after)).toBe(sub(before));
  expect(after.split("\n")[0]).toBe(before.split("\n")[0]);
  await ok(p, "accept", "sqlite", "--actor", "you");
  expect(sub((await ok(p, "show", "storage")).out)).toMatch(/subtree: 3 cards/);
});
