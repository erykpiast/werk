import { expect, test } from "bun:test";
import { Map_ } from "./b-lib.ts";

const firstLine = (out: string) => out.split("\n")[0] as string;
const isGhost = (out: string) => /\bproposed\b/.test(firstLine(out));
const subtree = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";

test("63.1 link to a ghost is held, live on accept with no extra link event", async () => {
  const m = new Map_();
  await m.root();
  await m.real("storage", "Storage");
  await m.ghost("sqlite", "Use SQLite", "storage");
  // "as its basis" is a depends_on link from the new card to Storage
  const link = await m.w("link", "sqlite", "storage", "--type", "depends_on", "--why", "SQLite is the basis of storage");
  expect(link.code, link.err).toBe(0);
  expect((await m.ok("show", "sqlite")).out).toMatch(/depends_on\s+storage.*\(held\)/);
  expect((await m.ok("show", "storage")).out).not.toMatch(/depends_on\s+sqlite/);
  await m.ok("accept", "sqlite", "--actor", "you");
  const s = (await m.ok("show", "sqlite")).out;
  expect(s).toMatch(/depends_on\s+storage/);
  expect(s).not.toMatch(/depends_on\s+storage.*\(held\)/);
  const links = m.events().filter((e) => e.type === "edge.added" && e.payload.type === "depends_on");
  expect(links).toHaveLength(1);
});

test("63.1b (control) held link to a non-ancestor basis goes live with one link event", async () => {
  const m = new Map_();
  await m.root();
  await m.real("storage", "Storage");
  await m.real("basis", "Basis");
  await m.ghost("sqlite", "Use SQLite", "storage");
  await m.ok("link", "sqlite", "basis", "--type", "depends_on", "--why", "w");
  expect((await m.ok("show", "sqlite")).out).toMatch(/depends_on\s+basis.*\(held\)/);
  await m.ok("accept", "sqlite", "--actor", "you");
  expect((await m.ok("show", "sqlite")).out).not.toMatch(/depends_on\s+basis.*\(held\)/);
  expect(m.events().filter((e) => e.type === "edge.added" && e.payload.type === "depends_on")).toHaveLength(1);
});

test("63.2 accept ghost child accepts ghost parent, not a ghost it depends on", async () => {
  const m = new Map_();
  await m.root();
  await m.real("platform", "Platform");
  await m.ghost("auth", "Auth", "platform");
  await m.ghost("magic", "Magic links", "auth");
  await m.ghost("email", "Email service", "platform");
  await m.ok("link", "magic", "email", "--type", "depends_on", "--why", "sends mail");
  await m.ok("accept", "magic", "--actor", "you");
  expect(isGhost((await m.ok("show", "magic")).out)).toBe(false);
  const a = (await m.ok("show", "auth")).out;
  expect(isGhost(a)).toBe(false);
  expect(a).toContain("parent: platform");
  expect(isGhost((await m.ok("show", "email")).out)).toBe(true);
  expect((await m.ok("show", "magic")).out).toMatch(/depends_on\s+email.*held/);
});

test("63.3 accept takes own ghost options and sources", async () => {
  const m = new Map_();
  await m.root();
  await m.real("storage", "Storage");
  await m.decideAlone("storage");
  await m.ghost("sqlite", "Use SQLite", "storage");
  await m.ok("add", "pg", "--kind", "option", "--title", "Use Postgres", "--why_not", "too heavy");
  await m.ok("link", "pg", "sqlite", "--type", "alternative_to");
  await m.ok("add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast");
  await m.ok("link", "sqlite", "bench", "--type", "supported_by");
  await m.ok("edit", "sqlite", "--who", "you");
  await m.ok("edit", "sqlite", "--no-basis", "nothing to build on");
  await m.ok("kill", "sqlite", "--revisit");
  const st = await m.w("status", "sqlite", "decided");
  expect(st.code, st.err).toBe(0);
  await m.ok("accept", "sqlite", "--actor", "you");
  const s = (await m.ok("show", "sqlite")).out;
  expect(isGhost(s)).toBe(false);
  expect(firstLine(s)).toContain("[decided]");
  expect(s).toContain("who: you");
  const o = (await m.ok("show", "pg")).out;
  expect(isGhost(o)).toBe(false);
  expect(o).toContain("too heavy");
  expect(isGhost((await m.ok("show", "bench")).out)).toBe(false);
  expect(s).toMatch(/supported_by\s+bench/);
  expect(s).not.toMatch(/supported_by\s+bench.*\(held\)/);
});

test("63.4 discarding ghost parent discards its branch", async () => {
  const m = new Map_();
  await m.root();
  await m.real("platform", "Platform");
  await m.ghost("auth", "Auth", "platform");
  await m.ghost("magic", "Magic links", "auth");
  await m.ok("add", "pw", "--kind", "option", "--title", "Passwords", "--why_not", "weak");
  await m.ok("link", "pw", "magic", "--type", "alternative_to");
  await m.ok("discard", "auth");
  for (const id of ["auth", "magic", "pw"]) expect((await m.w("show", id)).code).not.toBe(0);
  const p = (await m.ok("show", "platform")).out;
  expect(isGhost(p)).toBe(false);
  for (const t of ["Auth", "Magic", "Passwords", "ghost"]) expect(p).not.toContain(t);
});

test("63.5 a ghost changes no count of a real card", async () => {
  const m = new Map_();
  await m.root();
  await m.real("storage", "Storage");
  await m.decideAlone("storage");
  await m.real("child", "Child", "storage");
  await m.decideAlone("child");
  const before = (await m.ok("show", "storage")).out;
  expect(before).not.toMatch(/stale|paused|waits/i);
  await m.ghost("sqlite", "Use SQLite", "storage");
  await m.ok("add", "pg", "--kind", "option", "--title", "Postgres", "--why_not", "heavy");
  await m.ok("link", "pg", "sqlite", "--type", "alternative_to");
  await m.ok("edit", "sqlite", "--who", "you");
  await m.ok("edit", "sqlite", "--no-basis", "none");
  await m.ok("kill", "sqlite", "--revisit");
  expect((await m.w("status", "sqlite", "decided")).code).toBe(0);
  const mid = (await m.ok("show", "storage")).out;
  expect(subtree(mid)).toBe(subtree(before));
  expect(mid).not.toMatch(/stale|paused|waits/i);
  await m.ok("accept", "sqlite", "--actor", "you");
  const after = (await m.ok("show", "storage")).out;
  expect(subtree(after)).not.toBe(subtree(before));
  expect(subtree(after)).toContain("3 cards");
});
