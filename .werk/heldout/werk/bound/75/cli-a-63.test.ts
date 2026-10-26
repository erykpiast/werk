// Held-out steps 63.1-63.5: held links, the accept and the discard of a ghost branch, and the
// rollup, read through show, find, stale and the log file.
import { expect, test } from "bun:test";
import { card, decided, events, isGhost, ok, show, withMap } from "./cli-a-lib.ts";

const linkLine = (out: string, pattern: RegExp) => out.split("\n").find((line) => pattern.test(line));

test("63.1 A link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const project = withMap([card("root", "Root"), card("storage", "Storage", "root"), decided("storage")]);
  await ok(project, ["add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  // "As its basis": a depends_on link from the card to Storage.
  const linked = await project.werk([
    "link",
    "use-sqlite",
    "storage",
    "--type",
    "depends_on",
    "--why",
    "SQLite is the storage engine",
  ]);
  expect(linked.code, linked.err).toBe(0);
  const held = (await ok(project, ["show", "use-sqlite"])).out;
  expect(linkLine(held, /-> depends_on\s+storage/)).toContain("held");
  const storage = (await ok(project, ["show", "storage"])).out;
  const storageEdge = linkLine(storage, /<- depends_on\s+use-sqlite/);
  if (storageEdge !== undefined) expect(storageEdge).toContain("held");
  await ok(project, ["accept", "use-sqlite", "--actor", "you"]);
  const live = (await ok(project, ["show", "use-sqlite"])).out;
  const liveEdge = linkLine(live, /-> depends_on\s+storage/);
  expect(liveEdge).toBeDefined();
  expect(liveEdge).not.toContain("held");
  const linkEvents = events(project).filter(
    (event) =>
      event.type === "edge.added" &&
      event.payload.from === "use-sqlite" &&
      event.payload.to === "storage" &&
      event.payload.type === "depends_on",
  );
  expect(linkEvents).toHaveLength(1);
}, 60_000);

test("63.2 Accepting a ghost child also accepts its ghost parent, but not a ghost it depends on", async () => {
  const project = withMap([card("root", "Root"), card("platform", "Platform", "root")]);
  await ok(project, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(project, ["add", "magic-links", "--title", "Magic links", "--parent", "auth"]);
  await ok(project, ["add", "email-service", "--title", "Email service", "--parent", "platform"]);
  await ok(project, [
    "link",
    "magic-links",
    "email-service",
    "--type",
    "depends_on",
    "--why",
    "Magic links go out by mail",
  ]);
  await ok(project, ["accept", "magic-links", "--actor", "you"]);
  const magic = (await ok(project, ["show", "magic-links"])).out;
  expect(isGhost(magic)).toBe(false);
  const auth = (await ok(project, ["show", "auth"])).out;
  expect(isGhost(auth)).toBe(false);
  expect(auth).toContain("parent: platform");
  expect(isGhost((await ok(project, ["show", "email-service"])).out)).toBe(true);
  expect(linkLine(magic, /-> depends_on\s+email-service/)).toContain("held");
}, 60_000);

test("63.3 An accept takes the card's own ghost options and sources with it", async () => {
  // Storage is decided so that it can be the basis the contract check asks for.
  const project = withMap([card("root", "Root"), card("storage", "Storage", "root"), decided("storage")]);
  const refusals: string[] = [];
  const agent = async (args: string[]) => {
    const run = await project.werk(args);
    if (run.code !== 0) refusals.push(`${args.join(" ")}: ${run.err}`);
    return run;
  };
  await agent(["add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await agent([
    "add",
    "use-sqlite:opt0",
    "--kind",
    "option",
    "--title",
    "Use Postgres",
    "--why_not",
    "A server is too heavy",
  ]);
  await agent(["link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to"]);
  await agent([
    "add",
    "benchmark",
    "--kind",
    "source",
    "--title",
    "Benchmark notes",
    "--finding",
    "SQLite is fast enough",
  ]);
  await agent(["link", "use-sqlite", "benchmark", "--type", "supported_by"]);
  // The contract check of a decide also needs a kill criterion.
  await agent(["kill", "use-sqlite", "--revisit"]);
  await agent(["edit", "use-sqlite", "--who", "me"]);
  await agent(["status", "use-sqlite", "decided"]);
  expect(refusals).toEqual([]);
  await ok(project, ["accept", "use-sqlite", "--actor", "you"]);
  const sqlite = (await ok(project, ["show", "use-sqlite"])).out;
  expect(isGhost(sqlite)).toBe(false);
  expect(sqlite.split("\n")[0]).toContain("[decided]");
  expect(sqlite).toContain("who: me");
  const option = (await ok(project, ["show", "use-sqlite:opt0"])).out;
  expect(isGhost(option)).toBe(false);
  expect(option).toContain("why not: A server is too heavy");
  const source = (await ok(project, ["show", "benchmark"])).out;
  expect(isGhost(source)).toBe(false);
  const edge = linkLine(source, /<- supported_by\s+use-sqlite/);
  expect(edge).toBeDefined();
  expect(edge).not.toContain("held");
}, 60_000);

test("63.4 Discarding a ghost parent discards its whole ghost branch", async () => {
  const project = withMap([card("root", "Root"), card("platform", "Platform", "root")]);
  await ok(project, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(project, ["add", "magic-links", "--title", "Magic links", "--parent", "auth"]);
  await ok(project, [
    "add",
    "magic-links:opt0",
    "--kind",
    "option",
    "--title",
    "Passwords",
    "--why_not",
    "Users forget them",
  ]);
  await ok(project, ["link", "magic-links:opt0", "magic-links", "--type", "alternative_to"]);
  await ok(project, ["discard", "auth"]);
  for (const id of ["auth", "magic-links", "magic-links:opt0"]) expect((await show(project, id)).code).not.toBe(0);
  const find = (await ok(project, ["find"])).out;
  expect(find).not.toMatch(/\bauth\b|magic-links/);
  const platform = (await ok(project, ["show", "platform"])).out;
  expect(isGhost(platform)).toBe(false);
  expect(platform).not.toContain("ghost");
  expect(platform).not.toContain("<- refines");
}, 60_000);

test("63.5 A ghost changes no count of a real card until it is accepted", async () => {
  // Storage is decided so that a decided child's contract check finds its basis.
  const project = withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    decided("storage"),
    card("file-format", "Files are JSON lines", "storage", { who: "you", unchallenged: "Only one format was known" }),
    decided("file-format"),
  ]);
  const subtree = (out: string) => out.split("\n").find((line) => line.startsWith("subtree:"));
  const before = (await ok(project, ["show", "storage"])).out;
  const countBefore = subtree(before);
  expect(countBefore).toBe("subtree: 2 cards, 2 decided, 1 unchallenged");
  expect(before.split("\n")[0]).not.toMatch(/stale/);
  expect((await ok(project, ["stale"])).out).not.toContain("storage");

  await ok(project, ["add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(project, [
    "add",
    "use-sqlite:opt0",
    "--kind",
    "option",
    "--title",
    "Use Postgres",
    "--why_not",
    "Too heavy",
  ]);
  await ok(project, ["link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to"]);
  await ok(project, ["kill", "use-sqlite", "--revisit"]);
  await ok(project, ["edit", "use-sqlite", "--who", "me"]);
  await ok(project, ["status", "use-sqlite", "decided"]);
  const ghostShow = (await ok(project, ["show", "use-sqlite"])).out;
  expect(isGhost(ghostShow)).toBe(true);
  expect(ghostShow.split("\n")[0]).toContain("[decided]");

  const during = (await ok(project, ["show", "storage"])).out;
  expect(subtree(during)).toBe(countBefore);
  expect(during.split("\n")[0]).not.toMatch(/stale/);
  expect((await ok(project, ["stale"])).out).not.toContain("storage");

  await ok(project, ["accept", "use-sqlite", "--actor", "you"]);
  const after = (await ok(project, ["show", "storage"])).out;
  expect(subtree(after)).toBe("subtree: 3 cards, 3 decided, 1 unchallenged");
}, 60_000);

test("63.1-variant (information only) the same flow with Use SQLite under the root, so Storage is not its ancestor", async () => {
  const project = withMap([card("root", "Root"), card("storage", "Storage", "root"), decided("storage")]);
  await ok(project, ["add", "use-sqlite", "--title", "Use SQLite", "--parent", "root"]);
  await ok(project, ["link", "use-sqlite", "storage", "--type", "depends_on", "--why", "SQLite is the storage engine"]);
  expect(linkLine((await ok(project, ["show", "use-sqlite"])).out, /-> depends_on\s+storage/)).toContain("held");
  const storageEdge = linkLine((await ok(project, ["show", "storage"])).out, /<- depends_on\s+use-sqlite/);
  if (storageEdge !== undefined) expect(storageEdge).toContain("held");
  await ok(project, ["accept", "use-sqlite", "--actor", "you"]);
  const liveEdge = linkLine((await ok(project, ["show", "use-sqlite"])).out, /-> depends_on\s+storage/);
  expect(liveEdge).toBeDefined();
  expect(liveEdge).not.toContain("held");
  expect(events(project).filter((event) => event.type === "edge.added")).toHaveLength(1);
}, 60_000);
