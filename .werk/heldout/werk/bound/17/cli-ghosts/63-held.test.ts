// Held-out 63.x: links to ghosts are held, and an accept carries a ghost's own parts.
import { expect, test } from "bun:test";
import { head, project } from "./helpers.ts";

const rollupLine = (show: string) => show.split("\n").find((l) => l.startsWith("subtree:")) ?? "";

test("63.1 a link to a ghost is held, and it goes live on accept with no extra link event", () => {
  const p = project([{ id: "storage", title: "Storage" }]);
  p.ok("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  const link = p.werk("link", "sqlite", "storage", "--type", "depends_on", "--why", "SQLite is how storage is kept");
  expect(link.err).toBe("");
  expect(link.code).toBe(0);
  expect(p.show("sqlite")).toMatch(/-> depends_on\s+storage\s+Storage\s+\(held\)/);
  // The live edges of Storage: lines without the held mark.
  const live = p
    .show("storage")
    .split("\n")
    .filter((l) => l.includes("sqlite") && !l.includes("held"));
  expect(live).toEqual([]);
  p.ok("accept", "sqlite", "--actor", "you");
  const after = p.show("sqlite");
  expect(after).toMatch(/-> depends_on\s+storage\s+Storage\s*\n/);
  const linkEvents = p
    .events()
    .filter((e) => e.type === "edge.added" && e.payload.from === "sqlite" && e.payload.to === "storage" && e.payload.type === "depends_on");
  expect(linkEvents.length).toBe(1);
});

test("63.2 accepting a ghost child accepts its ghost parent, but not a ghost it depends on", () => {
  const p = project([{ id: "platform", title: "Platform" }]);
  p.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  p.ok("add", "magic", "--title", "Magic links", "--parent", "auth");
  p.ok("add", "email", "--title", "Email service", "--parent", "platform");
  p.ok("link", "magic", "email", "--type", "depends_on", "--why", "magic links are sent by email");
  p.ok("accept", "magic", "--actor", "you");
  expect(head(p.show("magic"))).not.toContain("proposed");
  const auth = p.show("auth");
  expect(head(auth)).not.toContain("proposed");
  expect(auth).toContain("parent: platform  Platform");
  expect(auth).toMatch(/-> refines\s+platform\s+Platform\s*\n/);
  expect(head(p.show("email"))).toContain("proposed");
  expect(p.show("magic")).toMatch(/-> depends_on\s+email\s+Email service\s+\(ghost, held\)|-> depends_on\s+email\s+Email service\s+\(held\)/);
});

test("63.3 an accept takes the card's own ghost options and sources with it", () => {
  // Storage is decided so that it can be the basis of a decided child; the decide also needs a kill criterion.
  const p = project([{ id: "storage", title: "Storage", status: "decided", who: "you" }]);
  p.ok("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  p.ok("add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  p.ok("link", "sqlite:opt0", "sqlite", "--type", "alternative_to");
  p.ok("add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "SQLite is fast enough");
  p.ok("link", "sqlite", "bench", "--type", "supported_by");
  p.ok("kill", "sqlite", "--revisit");
  const who = p.werk("edit", "sqlite", "--who", "you");
  const status = p.werk("status", "sqlite", "decided");
  expect(who.code).toBe(0);
  expect(status.code).toBe(0);
  expect(status.err).toBe("");
  p.ok("accept", "sqlite", "--actor", "you");
  const card = p.show("sqlite");
  expect(head(card)).toContain("[decided]");
  expect(head(card)).not.toContain("proposed");
  expect(card).toContain("who: you");
  const opt = p.show("sqlite:opt0");
  expect(head(opt)).not.toContain("proposed");
  expect(opt).toContain("needs a server");
  const src = p.show("bench");
  expect(head(src)).not.toContain("proposed");
  expect(card).toMatch(/-> supported_by\s+bench\s+Benchmark notes\s*\n/);
});

test("63.4 discarding a ghost parent discards its whole ghost branch", () => {
  const p = project([{ id: "platform", title: "Platform" }]);
  p.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  p.ok("add", "magic", "--title", "Magic links", "--parent", "auth");
  p.ok("add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "they leak");
  p.ok("link", "magic:opt0", "magic", "--type", "alternative_to");
  p.ok("discard", "auth");
  for (const id of ["auth", "magic", "magic:opt0"]) expect(p.werk("show", id).code).not.toBe(0);
  const platform = p.show("platform");
  expect(head(platform)).not.toContain("proposed");
  for (const word of ["Auth", "Magic links", "Passwords", "ghost"]) expect(platform).not.toContain(word);
});

test("63.5 a ghost changes no count of a real card until it is accepted", () => {
  const p = project([
    { id: "storage", title: "Storage", status: "decided", who: "you", unchallenged: "only one way" },
    { id: "files", title: "Files", status: "decided", who: "you", unchallenged: "only one way", parent: "storage" },
  ]);
  const before = p.show("storage");
  const rollup0 = rollupLine(before);
  expect(rollup0).not.toBe("");
  expect(head(before)).not.toContain("stale");

  p.ok("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  p.ok("add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  p.ok("link", "sqlite:opt0", "sqlite", "--type", "alternative_to");
  p.ok("edit", "sqlite", "--who", "you");
  p.ok("kill", "sqlite", "--revisit");
  p.ok("status", "sqlite", "decided");
  const during = p.show("storage");
  expect(rollupLine(during)).toBe(rollup0);
  expect(head(during)).not.toContain("stale");

  p.ok("accept", "sqlite", "--actor", "you");
  const after = rollupLine(p.show("storage"));
  const cards = (line: string) => Number(/subtree: (\d+) card/.exec(line)?.[1]);
  expect(cards(after)).toBe(cards(rollup0) + 1);
});
