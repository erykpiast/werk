// Held-out steps 63.1 to 63.5: held links, accepting a branch, discarding a branch, and counts.
import { expect, test } from "bun:test";
import { decided, events, header, ok, project, real, seed } from "./b-helpers.ts";

const lineOf = (out: string, ...parts: string[]) => out.split("\n").find((l) => parts.every((p) => l.includes(p)));

test("63.1 a link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const p = project();
  decided(p, "storage", "Storage");
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  const link = await p.werk([
    "link",
    "sqlite",
    "storage",
    "--type",
    "depends_on",
    "--why",
    "SQLite stores what Storage needs",
  ]);
  expect(link.err).toBe("");
  expect(link.code).toBe(0);
  const held = (await ok(p, ["show", "sqlite"])).out;
  expect(lineOf(held, "-> depends_on", "storage")).toContain("held");
  const storage = (await ok(p, ["show", "storage"])).out;
  const incoming = lineOf(storage, "<- depends_on", "sqlite");
  expect(incoming === undefined || incoming.includes("held")).toBe(true);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const live = (await ok(p, ["show", "sqlite"])).out;
  const liveLine = lineOf(live, "-> depends_on", "storage");
  expect(liveLine).toBeDefined();
  expect(liveLine).not.toContain("held");
  const linkEvents = events(p).filter(
    (e) => e.type === "edge.added" && e.payload.from === "sqlite" && e.payload.to === "storage",
  );
  expect(linkEvents).toHaveLength(1);
}, 30_000);

test("63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = project();
  seed(p, real("platform", "Platform"));
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "magic links send mail"]);
  const accept = await p.werk(["accept", "magic", "--actor", "you"]);
  expect(accept.err).toBe("");
  expect(accept.code).toBe(0);
  expect(await header(p, "magic")).not.toContain("proposed");
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth.split("\n")[0]).not.toContain("proposed");
  expect(auth).toContain("parent: platform  Platform");
  expect(await header(p, "email")).toContain("proposed");
  expect(lineOf((await ok(p, ["show", "magic"])).out, "-> depends_on", "email")).toContain("held");
}, 30_000);

test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const p = project();
  decided(p, "storage", "Storage");
  const refusals: string[] = [];
  const run = async (args: string[]) => {
    const r = await p.werk(args);
    if (r.code !== 0) refusals.push(`${args.join(" ")}: ${r.err}`);
  };
  await run(["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await run(["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Needs a server"]);
  await run(["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await run(["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "SQLite is fast"]);
  await run(["link", "sqlite", "bench", "--type", "supported_by"]);
  await run(["edit", "sqlite", "--who", "you"]);
  await run(["kill", "sqlite", "--revisit"]);
  await run(["status", "sqlite", "decided"]);
  expect(refusals).toEqual([]);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const card = (await ok(p, ["show", "sqlite"])).out;
  expect(card.split("\n")[0]).toContain("[decided]");
  expect(card.split("\n")[0]).not.toContain("proposed");
  expect(card).toContain("who: you");
  const opt = (await ok(p, ["show", "sqlite:opt0"])).out;
  expect(opt.split("\n")[0]).not.toContain("proposed");
  expect(opt).toContain("why not: Needs a server");
  const src = (await ok(p, ["show", "bench"])).out;
  expect(src.split("\n")[0]).not.toContain("proposed");
  const edge = lineOf(src, "supported_by", "sqlite");
  expect(edge).toBeDefined();
  expect(edge).not.toContain("held");
}, 60_000);

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = project();
  seed(p, real("platform", "Platform"));
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "Users forget them"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await p.werk(["show", id])).code).not.toBe(0);
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform.split("\n")[0]).not.toContain("proposed");
  expect(platform).not.toContain("ghost");
  expect(platform).not.toContain("Auth");
}, 30_000);

test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = project();
  decided(p, "storage", "Storage");
  decided(p, "child", "Child", { parent: "storage", who: "you", unchallenged: "no real choice" });
  const subtree = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:"));
  const before = (await ok(p, ["show", "storage"])).out;
  const counts = subtree(before);
  expect(counts).toContain("2 cards");
  expect(counts).toContain("1 unchallenged");
  expect(before.split("\n")[0]).not.toContain("stale");

  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--who", "me"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Needs a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["status", "sqlite", "decided"]);
  const during = (await ok(p, ["show", "storage"])).out;
  expect(subtree(during)).toBe(counts);
  expect(during.split("\n")[0]).not.toContain("stale");

  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  expect(subtree((await ok(p, ["show", "storage"])).out)).toContain("3 cards");
}, 60_000);
