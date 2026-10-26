import { expect, test } from "bun:test";
import { card, events, head, ok, w, withRoot } from "./helpers.ts";

test("63.1 a link to a ghost is held, and goes live on accept with no extra link event", async () => {
  const p = withRoot();
  card(p, "storage", "Storage", "root", "decided");
  await ok(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await ok(p, "link", "sqlite", "storage", "--type", "depends_on", "--why", "the storage choice is the basis");
  expect((await ok(p, "show", "sqlite")).out).toMatch(/-> depends_on +storage {2}Storage {2}\(held\)/);
  const storage = (await ok(p, "show", "storage")).out;
  const liveLines = storage.split("\n").filter((l) => l.includes("depends_on") && l.includes("sqlite"));
  for (const l of liveLines) expect(l).toContain("held");
  await ok(p, "accept", "sqlite", "--actor", "you");
  expect((await ok(p, "show", "sqlite")).out).toMatch(/-> depends_on +storage {2}Storage\n/);
  const links = events(p).filter(
    (e) =>
      e.type === "edge.added" &&
      e.payload.from === "sqlite" &&
      e.payload.to === "storage" &&
      e.payload.type === "depends_on",
  );
  expect(links).toHaveLength(1);
});

test("63.2 accepting a ghost child accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = withRoot();
  card(p, "platform", "Platform");
  await ok(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await ok(p, "add", "magic", "--title", "Magic links", "--parent", "auth");
  await ok(p, "add", "email", "--title", "Email service", "--parent", "platform");
  await ok(p, "link", "magic", "email", "--type", "depends_on", "--why", "links go out by email");
  await ok(p, "accept", "magic", "--actor", "you");
  expect(await head(p, "magic")).not.toContain("proposed");
  const auth = (await ok(p, "show", "auth")).out;
  expect(auth.split("\n")[0]).not.toContain("proposed");
  expect(auth).toContain("parent: platform  Platform");
  expect(await head(p, "email")).toContain("proposed");
  expect((await ok(p, "show", "magic")).out).toMatch(/-> depends_on +email {2}Email service {2}\((ghost, )?held\)/);
});

test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const p = withRoot();
  card(p, "storage", "Storage", "root", "decided");
  await ok(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await ok(p, "add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  await ok(p, "link", "sqlite:opt0", "sqlite", "--type", "alternative_to");
  await ok(p, "add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast enough");
  await ok(p, "link", "sqlite", "bench", "--type", "supported_by");
  const who = await w(p, "edit", "sqlite", "--who", "me");
  expect(who.code).toBe(0);
  // The contract check needs a kill criterion before a decide.
  await ok(p, "kill", "sqlite", "--revisit");
  const decide = await w(p, "status", "sqlite", "decided");
  expect(decide.code, decide.err).toBe(0);
  await ok(p, "accept", "sqlite", "--actor", "you");
  const sqlite = (await ok(p, "show", "sqlite")).out;
  expect(sqlite.split("\n")[0]).toContain("[decided]");
  expect(sqlite.split("\n")[0]).not.toContain("proposed");
  expect(sqlite).toContain("who: me");
  const option = (await ok(p, "show", "sqlite:opt0")).out;
  expect(option.split("\n")[0]).not.toContain("proposed");
  expect(option).toContain("why not: needs a server");
  expect(await head(p, "bench")).not.toContain("proposed");
  expect(sqlite).toMatch(/-> supported_by +bench {2}Benchmark notes\n/);
});

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = withRoot();
  card(p, "platform", "Platform");
  await ok(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await ok(p, "add", "magic", "--title", "Magic links", "--parent", "auth");
  await ok(p, "add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "people forget them");
  await ok(p, "link", "magic:opt0", "magic", "--type", "alternative_to");
  await ok(p, "discard", "auth");
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await w(p, "show", id)).code).not.toBe(0);
  const platform = (await ok(p, "show", "platform")).out;
  expect(platform.split("\n")[0]).not.toContain("proposed");
  expect(platform).not.toContain("ghost");
  expect(platform).not.toContain("<- refines");
  expect((await ok(p, "find")).out).not.toMatch(/\b(auth|magic)\b/);
});

test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = withRoot();
  card(p, "storage", "Storage", "root", "decided");
  card(p, "child", "Real child", "storage", "decided");
  const subtree = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:"));
  const first = (await ok(p, "show", "storage")).out;
  const before = subtree(first);
  expect(first.split("\n")[0]).not.toMatch(/stale|paused/);
  await ok(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await ok(p, "edit", "sqlite", "--who", "me");
  await ok(p, "add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  await ok(p, "link", "sqlite:opt0", "sqlite", "--type", "alternative_to");
  await ok(p, "kill", "sqlite", "--revisit");
  await ok(p, "status", "sqlite", "decided");
  const ghosted = (await ok(p, "show", "storage")).out;
  expect(subtree(ghosted)).toBe(before);
  expect(ghosted.split("\n")[0]).not.toMatch(/stale|paused/);
  expect((await ok(p, "stale")).out).not.toContain("storage");
  await ok(p, "accept", "sqlite", "--actor", "you");
  const after = (await ok(p, "show", "storage")).out;
  expect(subtree(after)).toBe("subtree: 3 cards, 3 decided");
});
