// Held-out steps 63.x: held links, accept carries ghost parents, options and sources, discard
// drops a ghost branch, and a ghost changes no count.
import { expect, setDefaultTimeout, test } from "bun:test";
import { head, project } from "./b-helpers.ts";

setDefaultTimeout(120_000);

const lineWith = (out: string, ...parts: string[]) =>
  out.split("\n").find((l) => parts.every((part) => l.includes(part))) ?? "";

test("63.1 a link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("storage", "Storage", "root", { status: "decided" });
  await p.ok("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.ok("link", "use-sqlite", "storage", "--type", "depends_on", "--why", "Storage sets the need for a file store");
  const show = await p.ok("show", "use-sqlite");
  expect(lineWith(show, "depends_on", "storage")).toContain("held");
  const storage = await p.ok("show", "storage");
  const edge = lineWith(storage, "depends_on", "use-sqlite");
  expect(edge === "" || edge.includes("held")).toBe(true);
  await p.ok("accept", "use-sqlite", "--actor", "you");
  const after = await p.ok("show", "use-sqlite");
  const live = lineWith(after, "depends_on", "storage");
  expect(live).not.toBe("");
  expect(live).not.toContain("held");
  const links = p.events().filter((e) => e.type.startsWith("link") && e.payload.from === "use-sqlite" && e.payload.to === "storage");
  expect(links).toHaveLength(1);
});

test("63.2 accepting a ghost child accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("platform", "Platform", "root");
  await p.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  await p.ok("add", "magic-links", "--title", "Magic links", "--parent", "auth");
  await p.ok("add", "email-service", "--title", "Email service", "--parent", "platform");
  await p.ok("link", "magic-links", "email-service", "--type", "depends_on", "--why", "a magic link is sent by email");
  await p.ok("accept", "magic-links", "--actor", "you");
  const ml = await p.ok("show", "magic-links");
  expect(head(ml)).not.toContain("proposed");
  const auth = await p.ok("show", "auth");
  expect(head(auth)).not.toContain("proposed");
  expect(auth).toContain("parent: platform  Platform");
  expect(head(await p.ok("show", "email-service"))).toContain("proposed");
  expect(lineWith(ml, "depends_on", "email-service")).toContain("held");
});

test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("storage", "Storage", "root", { status: "decided", who: "you" });
  await p.ok("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.ok("add", "use-sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  await p.ok("link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to");
  await p.ok("add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "SQLite is fast enough");
  await p.ok("link", "use-sqlite", "bench", "--type", "supported_by");
  // The contract check also needs a basis and a kill criterion; the step names neither, so the
  // binder records them with the verbs that exist for them.
  await p.ok("edit", "use-sqlite", "--no-basis", "no decided card sets the storage engine");
  await p.ok("kill", "use-sqlite", "--revisit");
  const who = await p.w("edit", "use-sqlite", "--who", "you");
  const status = await p.w("status", "use-sqlite", "decided");
  expect(who.code).toBe(0);
  expect(status.code).toBe(0);
  await p.ok("accept", "use-sqlite", "--actor", "you");
  const card = await p.ok("show", "use-sqlite");
  expect(head(card)).toContain("[decided]");
  expect(head(card)).not.toContain("proposed");
  expect(card).toMatch(/who: you/);
  const opt = await p.ok("show", "use-sqlite:opt0");
  expect(head(opt)).not.toContain("proposed");
  expect(opt).toContain("needs a server");
  const src = await p.ok("show", "bench");
  expect(head(src)).not.toContain("proposed");
  const edge = lineWith(card, "supported_by", "bench");
  expect(edge).not.toBe("");
  expect(edge).not.toContain("held");
});

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("platform", "Platform", "root");
  await p.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  await p.ok("add", "magic-links", "--title", "Magic links", "--parent", "auth");
  await p.ok("add", "magic-links:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "people forget them");
  await p.ok("link", "magic-links:opt0", "magic-links", "--type", "alternative_to");
  await p.ok("discard", "auth");
  for (const id of ["auth", "magic-links", "magic-links:opt0"]) expect((await p.w("show", id)).code).not.toBe(0);
  const platform = await p.ok("show", "platform");
  expect(head(platform)).not.toContain("proposed");
  expect(platform).not.toContain("ghost");
  for (const t of ["Auth", "Magic links", "Passwords"]) expect(platform).not.toContain(t);
  const root = await p.ok("show", "root");
  for (const t of ["Auth", "Magic links", "Passwords"]) expect(root).not.toContain(t);
});

test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("storage", "Storage", "root", { status: "decided", who: "you" });
  p.real("engine", "Engine", "storage", { status: "decided", who: "you" });
  const subtree = (out: string) => lineWith(out, "subtree:");
  const s0 = await p.ok("show", "storage");
  const before = subtree(s0);
  expect(before).not.toBe("");
  expect(head(s0)).not.toContain("stale");
  await p.ok("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.ok("add", "use-sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  await p.ok("link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to");
  await p.ok("edit", "use-sqlite", "--who", "you");
  await p.ok("link", "use-sqlite", "engine", "--type", "depends_on", "--why", "the engine sets the file format");
  await p.ok("kill", "use-sqlite", "--revisit");
  await p.ok("status", "use-sqlite", "decided");
  const s1 = await p.ok("show", "storage");
  expect(subtree(s1)).toBe(before);
  expect(head(s1)).not.toContain("stale");
  await p.ok("accept", "use-sqlite", "--actor", "you");
  const s2 = await p.ok("show", "storage");
  expect(subtree(s2)).not.toBe(before);
  expect(s2).toContain("use-sqlite");
});
