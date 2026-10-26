import { expect, test } from "bun:test";
import { children, project, real, seed, show } from "./a-helpers.ts";

const header = (out: string) => out.split("\n")[0] ?? "";
const rollup = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";
const edgeLines = (out: string, id: string) =>
  out.split("\n").filter((l) => /^\s+(->|<-)/.test(l) && l.includes(` ${id} `));

test("63.1 a link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "storage", "Storage", "root");
  await p.werk(["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  const link = await p.werk([
    "link",
    "sqlite",
    "storage",
    "--type",
    "depends_on",
    "--why",
    "SQLite is the storage engine",
  ]);
  expect(link.err).toBe("");
  expect(link.code).toBe(0);
  const s = await show(p, "sqlite");
  expect(s.out).toMatch(/-> depends_on\s+storage\s+Storage\s+\(held\)/);
  const st = await show(p, "storage");
  expect(edgeLines(st.out, "sqlite").filter((l) => l.includes("depends_on") && !l.includes("held"))).toEqual([]);
  expect((await p.werk(["accept", "sqlite", "--actor", "you"])).code).toBe(0);
  const s2 = await show(p, "sqlite");
  expect(s2.out).toMatch(/-> depends_on\s+storage\s+Storage\s*\n/);
  expect(p.events().filter((e) => e.type.startsWith("link") && e.payload.to === "storage")).toHaveLength(1);
});

test("63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "platform", "Platform", "root");
  await p.werk(["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await p.werk(["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await p.werk(["add", "email", "--title", "Email service", "--parent", "platform"]);
  expect((await p.werk(["link", "magic", "email", "--type", "depends_on", "--why", "sends the link"])).code).toBe(0);
  expect((await p.werk(["accept", "magic", "--actor", "you"])).code).toBe(0);
  expect(header((await show(p, "magic")).out)).not.toContain("proposed");
  const auth = await show(p, "auth");
  expect(header(auth.out)).not.toContain("proposed");
  expect(auth.out).toMatch(/parent: platform\s+Platform/);
  expect(header((await show(p, "email")).out)).toContain("proposed");
  expect((await show(p, "magic")).out).toMatch(/-> depends_on\s+email\s+Email service\s+\((ghost, )?held\)/);
});

test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const p = project();
  seed(p, "root", { title: "Root", status: "decided", who: "you", unchallenged: "root", no_basis: "root" });
  seed(p, "storage", { title: "Storage", parent: "root", status: "decided", who: "you" });
  await p.werk(["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await p.werk(["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"]);
  await p.werk(["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await p.werk([
    "add",
    "bench",
    "--kind",
    "source",
    "--title",
    "Benchmark notes",
    "--finding",
    "SQLite is fast enough",
  ]);
  await p.werk(["link", "sqlite", "bench", "--type", "supported_by"]);
  // The contract check of a decide also needs a kill criterion; the step does not name it, so it is set here.
  await p.werk(["kill", "sqlite", "--revisit"]);
  const who = await p.werk(["edit", "sqlite", "--who", "me"]);
  const status = await p.werk(["status", "sqlite", "decided"]);
  expect((await p.werk(["accept", "sqlite", "--actor", "you"])).code).toBe(0);
  const s = await show(p, "sqlite");
  expect(header(s.out)).toContain("[decided]");
  expect(header(s.out)).not.toContain("proposed");
  expect(s.out).toContain("who: me");
  const opt = await show(p, "sqlite:opt0");
  expect(header(opt.out)).not.toContain("proposed");
  expect(opt.out).toContain("why not: needs a server");
  const src = await show(p, "bench");
  expect(header(src.out)).not.toContain("proposed");
  expect(src.out).toMatch(/<- supported_by\s+sqlite\s+Use SQLite\s*\n/);
  expect(who.code).toBe(0);
  expect(status.err).toBe("");
  expect(status.code).toBe(0);
});

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "platform", "Platform", "root");
  await p.werk(["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await p.werk(["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await p.werk(["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "leak"]);
  await p.werk(["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  expect((await p.werk(["discard", "auth"])).code).toBe(0);
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await show(p, id)).code).not.toBe(0);
  const find = await p.werk(["find"]);
  for (const t of ["Auth", "Magic links", "Passwords"]) expect(find.out).not.toContain(t);
  const pl = await show(p, "platform");
  expect(header(pl.out)).not.toContain("proposed");
  expect(children(pl.out)).toEqual([]);
});

test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = project();
  seed(p, "root", { title: "Root", status: "decided", who: "you", unchallenged: "root", no_basis: "root" });
  seed(p, "storage", { title: "Storage", parent: "root", status: "decided", who: "you", unchallenged: "only one" });
  seed(p, "files", { title: "Files", parent: "storage", status: "decided", who: "you", unchallenged: "only one" });
  const before = await show(p, "storage");
  const beforeRollup = rollup(before.out);
  expect(beforeRollup).not.toBe("");
  expect(before.out).not.toMatch(/stale/i);
  await p.werk(["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await p.werk(["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "server"]);
  await p.werk(["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await p.werk(["edit", "sqlite", "--who", "you"]);
  await p.werk(["kill", "sqlite", "--revisit"]);
  expect((await p.werk(["status", "sqlite", "decided"])).code).toBe(0);
  const mid = await show(p, "storage");
  expect(rollup(mid.out)).toBe(beforeRollup);
  expect(mid.out).not.toMatch(/stale/i);
  expect((await p.werk(["accept", "sqlite", "--actor", "you"])).code).toBe(0);
  const after = await show(p, "storage");
  const n = (l: string) => Number(/(\d+) cards?/.exec(l)?.[1]);
  expect(n(rollup(after.out))).toBe(n(beforeRollup) + 1);
});
