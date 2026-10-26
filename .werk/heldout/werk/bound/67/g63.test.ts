import { expect, test } from "bun:test";
import { make } from "./lib.ts";

const head = (s: string) => s.split("\n")[0];

test("63.1 a link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("storage", { title: "Storage", parent: "root" });
  expect((await p.w("add", "sqlite", "--title", "Use SQLite", "--parent", "storage")).code).toBe(0);
  const link = await p.w("link", "sqlite", "storage", "--type", "depends_on", "--why", "it stores the map");
  expect(link.code).toBe(0);
  const s = await p.w("show", "sqlite");
  expect(s.out).toMatch(/-> depends_on +storage +Storage +\(held\)/);
  const st = await p.w("show", "storage");
  expect(st.out).not.toMatch(/<- depends_on +sqlite +Use SQLite\n/);
  expect((await p.w("accept", "sqlite", "--actor", "you")).code).toBe(0);
  const s2 = await p.w("show", "sqlite");
  expect(s2.out).toMatch(/-> depends_on +storage +Storage\n/);
  const links = p
    .events()
    .filter(
      (e: { type: string; payload: { from?: string; to?: string; type?: string } }) =>
        e.type === "edge.added" && e.payload.from === "sqlite" && e.payload.to === "storage",
    );
  expect(links.length).toBe(1);
});

test("63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = make();
  p.card("platform", { title: "Platform" });
  expect((await p.w("add", "auth", "--title", "Auth", "--parent", "platform")).code).toBe(0);
  expect((await p.w("add", "magic", "--title", "Magic links", "--parent", "auth")).code).toBe(0);
  expect((await p.w("add", "email", "--title", "Email service", "--parent", "platform")).code).toBe(0);
  expect((await p.w("link", "magic", "email", "--type", "depends_on", "--why", "it sends the links")).code).toBe(0);
  expect((await p.w("accept", "magic", "--actor", "you")).code).toBe(0);
  expect(head((await p.w("show", "magic")).out)).not.toContain("proposed");
  const a = await p.w("show", "auth");
  expect(head(a.out)).not.toContain("proposed");
  expect(a.out).toContain("parent: platform  Platform");
  expect(head((await p.w("show", "email")).out)).toContain("proposed");
  const m = await p.w("show", "magic");
  expect(m.out).toMatch(/-> depends_on +email +Email service +\((ghost, )?held\)/);
});

test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("storage", { title: "Storage", parent: "root", status: "decided", who: "me" });
  expect((await p.w("add", "sqlite", "--title", "Use SQLite", "--parent", "storage")).code).toBe(0);
  expect(
    (await p.w("add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"))
      .code,
  ).toBe(0);
  expect((await p.w("link", "sqlite:opt0", "sqlite", "--type", "alternative_to")).code).toBe(0);
  expect(
    (await p.w("add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast enough")).code,
  ).toBe(0);
  expect((await p.w("link", "sqlite", "bench", "--type", "supported_by")).code).toBe(0);
  // The contract check also needs a basis and a kill criterion; the binder supplies them as setup.
  expect((await p.w("edit", "sqlite", "--no-basis", "nothing decided precedes it")).code).toBe(0);
  expect((await p.w("kill", "sqlite", "--revisit")).code).toBe(0);
  const who = await p.w("edit", "sqlite", "--who", "you");
  const status = await p.w("status", "sqlite", "decided");
  expect(who.code).toBe(0);
  expect(status.code).toBe(0);
  expect((await p.w("accept", "sqlite", "--actor", "you")).code).toBe(0);
  const s = await p.w("show", "sqlite");
  expect(head(s.out)).toMatch(/\[decided\]/);
  expect(head(s.out)).not.toContain("proposed");
  expect(s.out).toContain("who: you");
  const o = await p.w("show", "sqlite:opt0");
  expect(head(o.out)).not.toContain("proposed");
  expect(o.out).toContain("why not: needs a server");
  const b = await p.w("show", "bench");
  expect(head(b.out)).not.toContain("proposed");
  expect(b.out).toMatch(/<- supported_by +sqlite +Use SQLite\n/);
});

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = make();
  p.card("platform", { title: "Platform" });
  expect((await p.w("add", "auth", "--title", "Auth", "--parent", "platform")).code).toBe(0);
  expect((await p.w("add", "magic", "--title", "Magic links", "--parent", "auth")).code).toBe(0);
  expect(
    (await p.w("add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "people forget them"))
      .code,
  ).toBe(0);
  expect((await p.w("link", "magic:opt0", "magic", "--type", "alternative_to")).code).toBe(0);
  expect((await p.w("discard", "auth")).code).toBe(0);
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await p.w("show", id)).code).not.toBe(0);
  const pl = await p.w("show", "platform");
  expect(pl.code).toBe(0);
  expect(head(pl.out)).not.toContain("proposed");
  expect(pl.out).not.toContain("<- refines");
  expect(pl.out).not.toContain("Passwords");
});

test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("storage", { title: "Storage", parent: "root", status: "decided", who: "you", unchallenged: "no rival" });
  p.card("files", { title: "Files", parent: "storage", status: "decided", who: "you", unchallenged: "no rival" });
  const before = await p.w("show", "storage");
  const rollup = before.out.split("\n").find((l) => l.startsWith("subtree:"));
  expect(rollup).toBeDefined();
  expect(before.out).not.toMatch(/stale|STALE/);
  p.seed("node.proposed", {
    id: "sqlite",
    kind: "card",
    title: "Use SQLite",
    parent: "storage",
    status: "decided",
    who: "you",
    unchallenged: "no rival",
  });
  expect(
    (await p.w("add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"))
      .code,
  ).toBe(0);
  expect((await p.w("link", "sqlite:opt0", "sqlite", "--type", "alternative_to")).code).toBe(0);
  const mid = await p.w("show", "storage");
  expect(mid.out.split("\n").find((l) => l.startsWith("subtree:"))).toBe(rollup);
  expect(mid.out).not.toMatch(/stale|STALE/);
  expect((await p.w("accept", "sqlite", "--actor", "you")).code).toBe(0);
  const after = await p.w("show", "storage");
  expect(after.out).toMatch(/^subtree: 3 cards/m);
});
