import { expect, test } from "bun:test";
import { addChat, card, decidedCard, lines, link, ok, type Project, seed, withMap } from "./map-helpers.ts";

const T = 90_000;
const root = () => withMap([card("root", "Root")]);

test(
  "04.1 new card waits as a ghost until accepted",
  async () => {
    const p = withMap([card("root", "Root"), card("checkout", "Checkout flow", "root")]);
    await ok(p, ["add", "other", "--title", "Other ghost", "--parent", "root"]);
    const before = lines(p);
    const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
    expect(add.out).toContain("proposed");
    expect(add.out).not.toContain("added");
    const after = lines(p);
    expect(after).toHaveLength(before.length + 1);
    expect(JSON.parse(after.at(-1) as string)).toMatchObject({
      type: "node.proposed",
      payload: { id: "retry", parent: "checkout" },
    });
    const show = (await ok(p, ["show", "retry"])).out;
    expect(show).toStartWith("card retry  [open]  proposed\n");
    expect(show).toContain("parent: checkout  Checkout flow");
    expect((await ok(p, ["show", "checkout"])).out).toContain("retry  Retry payment  (ghost, held)");
    await ok(p, ["accept", "retry", "--actor", "you"]);
    const n = lines(p);
    expect(n).toHaveLength(after.length + 1);
    expect(JSON.parse(n.at(-1) as string).type).toBe("change.accepted");
    const real = (await ok(p, ["show", "retry"])).out;
    expect(real).not.toContain("proposed");
    expect(real).toContain("parent: checkout  Checkout flow");
    expect((await ok(p, ["show", "checkout"])).out).not.toContain("retry  Retry payment  (ghost");
    expect((await ok(p, ["show", "other"])).out).toStartWith("card other  [open]  proposed\n");
  },
  T,
);

test(
  "04.2 accepting ghost child accepts ghost parent, held link goes live",
  async () => {
    const p = withMap([
      card("root", "Root"),
      card("payments", "Payments", "root"),
      card("fraud", "Fraud rules", "root"),
    ]);
    await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
    await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
    await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "Partial refunds follow fraud rules"]);
    await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full only", "--why_not", "Too blunt"]);
    await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
    await ok(p, ["add", "src", "--kind", "source", "--title", "Refund study"]);
    await ok(p, ["link", "partial", "src", "--type", "supported_by"]);
    expect((await ok(p, ["show", "partial"])).out).toContain("-> depends_on      fraud  Fraud rules  (held)");
    const before = lines(p).length;
    await ok(p, ["accept", "partial", "--actor", "you"]);
    const added = lines(p)
      .slice(before)
      .map((l) => JSON.parse(l));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((e) => e.type === "change.accepted")).toBe(true);
    expect(added.some((e) => e.type === "edge.added")).toBe(false);
    expect((await ok(p, ["show", "refunds"])).out).not.toContain("proposed");
    const partial = (await ok(p, ["show", "partial"])).out;
    expect(partial).not.toContain("proposed");
    expect((await ok(p, ["show", "partial:opt0"])).out).not.toContain("proposed");
    expect((await ok(p, ["show", "src"])).out).not.toContain("proposed");
    expect(partial).toContain("-> depends_on      fraud  Fraud rules\n");
    expect(partial).not.toContain("(held)");
  },
  T,
);

test(
  "04.3 discarding a ghost parent drops its ghost children",
  async () => {
    const p = withMap([card("root", "Root"), card("onb", "Onboarding", "root")]);
    await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onb"]);
    await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
    await ok(p, ["discard", "email"]);
    for (const id of ["email", "resend"]) {
      const r = await p.werk(["show", id]);
      expect(r.code).toBe(1);
      expect(r.err).toContain(`no node #${id} in the map`);
    }
    const onb = (await ok(p, ["show", "onb"])).out;
    expect(onb).not.toContain("ghost");
    expect(onb).not.toContain("Email verification");
  },
  T,
);

test(
  "04.4 ghost words are frozen",
  async () => {
    const p = withMap([card("root", "Root"), card("search", "Search", "root")]);
    await ok(p, ["add", "idx", "--title", "First title", "--why", "First why", "--parent", "search"]);
    const before = lines(p);
    const r = await p.werk(["add", "idx", "--title", "Second title", "--why", "Second why", "--parent", "search"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("frozen");
    expect(lines(p)).toEqual(before);
    const show = (await ok(p, ["show", "idx"])).out;
    expect(show).toContain("First title");
    expect(show).toContain("First why");
    expect(show).not.toContain("Second");
  },
  T,
);

test(
  "04.5 accept needs --actor you",
  async () => {
    const p = withMap([card("root", "Root")]);
    await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "root"]);
    const before = lines(p);
    const r = await p.werk(["accept", "audit"]);
    expect(r.code).not.toBe(0);
    expect(lines(p)).toEqual(before);
    expect((await ok(p, ["show", "audit"])).out).toContain("proposed");
    await ok(p, ["accept", "audit", "--actor", "you"]);
    expect((await ok(p, ["show", "audit"])).out).not.toContain("proposed");
  },
  T,
);

test(
  "62.1 propose then accept appends exactly one event each",
  async () => {
    const p = withMap([card("root", "Root"), card("x", "X", "root")]);
    await ok(p, ["add", "pre", "--title", "Pre", "--parent", "root"]);
    const b0 = lines(p);
    const add = await ok(p, [
      "add",
      "n",
      "--title",
      "Use a log",
      "--body",
      "The body text.",
      "--why",
      "Because history.",
      "--parent",
      "root",
    ]);
    expect(add.out).toContain("proposed");
    const b1 = lines(p);
    expect(b1).toHaveLength(b0.length + 1);
    expect(b1.slice(0, -1)).toEqual(b0);
    const show = (await ok(p, ["show", "n"])).out;
    for (const s of ["Use a log", "The body text.", "Because history.", "proposed"]) expect(show).toContain(s);
    await ok(p, ["accept", "n", "--actor", "you"]);
    const b2 = lines(p);
    expect(b2).toHaveLength(b1.length + 1);
    expect(b2.slice(0, -1)).toEqual(b1);
    const real = (await ok(p, ["show", "n"])).out;
    for (const s of ["Use a log", "The body text.", "Because history."]) expect(real).toContain(s);
    expect(real).not.toContain("proposed");
  },
  T,
);

test(
  "62.2 accept without the claim refuses",
  async () => {
    const p = root();
    await ok(p, ["add", "a", "--title", "A"]);
    const before = lines(p);
    expect((await p.werk(["accept", "a"])).code).not.toBe(0);
    expect(lines(p)).toEqual(before);
    expect((await ok(p, ["show", "a"])).out).toContain("proposed");
    await ok(p, ["accept", "a", "--actor", "you"]);
    expect((await ok(p, ["show", "a"])).out).not.toContain("proposed");
  },
  T,
);

test(
  "62.3 ghost words are frozen",
  async () => {
    const p = root();
    await ok(p, ["add", "a", "--title", "Use a log"]);
    const before = lines(p);
    expect((await p.werk(["edit", "a", "--body", "new body"])).code).not.toBe(0);
    expect(lines(p)).toEqual(before);
    expect((await p.werk(["retitle", "a", "Use an append-only log"])).code).not.toBe(0);
    expect(lines(p)).toEqual(before);
    expect((await p.werk(["add", "a", "--title", "Different"])).code).not.toBe(0);
    expect(lines(p)).toEqual(before);
    const show = (await ok(p, ["show", "a"])).out;
    expect(show).toContain("Use a log");
    expect(show).toContain("proposed");
  },
  T,
);

test(
  "62.4 retitle on a real card",
  async () => {
    const p = root();
    await ok(p, ["add", "a", "--title", "Use a log", "--who", "me"]);
    await ok(p, ["accept", "a", "--actor", "you"]);
    const before = lines(p);
    const r = await p.werk(["retitle", "a", "Use an append-only log"]);
    expect(r.code).toBe(0);
    expect(lines(p)).toHaveLength(before.length + 1);
    const show = (await ok(p, ["show", "a"])).out;
    expect(show).toContain("Use an append-only log");
    expect(show).not.toContain("Use a log");
    expect(before.join("\n")).toContain("Use a log");
    await ok(p, ["edit", "a", "--body", "New body here."]);
    const s2 = (await ok(p, ["show", "a"])).out;
    expect(s2).toContain("New body here.");
    expect(s2).toContain("Use an append-only log");
  },
  T,
);

test(
  "62.5 option, source, excerpt enter as ghosts",
  async () => {
    const p = withMap([card("root", "Root"), card("a", "A", "root")]);
    addChat(p, "chat", ["we keep one log per conversation"]);
    const run = async (args: string[]) => {
      const b = lines(p).length;
      const r = await ok(p, args);
      expect(r.out).toContain("proposed");
      expect(lines(p)).toHaveLength(b + 1);
    };
    await run(["add", "a:opt0", "--kind", "option", "--title", "Flat", "--why_not", "Too slow"]);
    await run(["add", "src", "--kind", "source", "--title", "Survey", "--finding", "Found"]);
    await run(["quote", "a", "chat", "one log per conversation"]);
    const ids = ["a:opt0", "src", "a:ex0"];
    const shows = [] as string[];
    for (const id of ids) {
      const s = (await ok(p, ["show", id])).out;
      expect(s).toContain("proposed");
      shows.push(s);
    }
    expect(shows[0]).toContain("Too slow");
    await ok(p, ["accept", "a:opt0", "--actor", "you"]);
    const opt = (await ok(p, ["show", "a:opt0"])).out;
    expect(opt).not.toContain("proposed");
    expect(opt).toContain("Too slow");
    expect((await ok(p, ["show", "src"])).out).toContain("proposed");
    expect((await ok(p, ["show", "a:ex0"])).out).toContain("proposed");
  },
  T,
);

test(
  "63.1 link to ghost is held, goes live on accept, one link event",
  async () => {
    const p = withMap([card("root", "Root"), card("storage", "Storage", "root")]);
    await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
    const r = await p.werk(["link", "sqlite", "storage", "--type", "depends_on", "--why", "SQLite is the store"]);
    expect(r.code).toBe(0); // literal reading: the basis is the card's own parent
    expect((await ok(p, ["show", "sqlite"])).out).toContain("(held)");
    expect((await ok(p, ["show", "storage"])).out).not.toContain("<- depends_on      sqlite  Use SQLite\n");
    await ok(p, ["accept", "sqlite", "--actor", "you"]);
    expect((await ok(p, ["show", "sqlite"])).out).toContain("-> depends_on      storage  Storage\n");
    expect(
      lines(p)
        .map((l) => JSON.parse(l))
        .filter((e) => e.type === "edge.added" && e.payload.from === "sqlite"),
    ).toHaveLength(1);
  },
  T,
);

test(
  "63.2 accept takes ghost parent but not ghost dependency",
  async () => {
    const p = withMap([card("root", "Root"), card("platform", "Platform", "root")]);
    await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
    await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
    await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
    await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "sends the mail"]);
    await ok(p, ["accept", "magic", "--actor", "you"]);
    expect((await ok(p, ["show", "magic"])).out).not.toContain("proposed");
    const auth = (await ok(p, ["show", "auth"])).out;
    expect(auth).not.toContain("proposed");
    expect(auth).toContain("parent: platform  Platform");
    expect((await ok(p, ["show", "email"])).out).toContain("proposed");
    expect((await ok(p, ["show", "magic"])).out).toContain("-> depends_on      email  Email service  (ghost, held)");
  },
  T,
);

test(
  "63.3 accept takes own ghost options and sources",
  async () => {
    const p = withMap([card("root", "Root"), ...decidedCard("storage", "Storage", "root")]);
    await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
    await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Needs a server"]);
    await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
    await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes"]);
    await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
    await ok(p, ["edit", "sqlite", "--who", "you"]);
    await ok(p, ["kill", "sqlite", "--revisit"]);
    await ok(p, ["status", "sqlite", "decided"]);
    await ok(p, ["accept", "sqlite", "--actor", "you"]);
    const s = (await ok(p, ["show", "sqlite"])).out;
    expect(s).toStartWith("card sqlite  [decided]\n");
    expect(s).toContain("who: you");
    expect(s).toContain("-> supported_by    bench  Benchmark notes\n");
    const o = (await ok(p, ["show", "sqlite:opt0"])).out;
    expect(o).not.toContain("proposed");
    expect(o).toContain("Needs a server");
    expect((await ok(p, ["show", "bench"])).out).not.toContain("proposed");
  },
  T,
);

test(
  "63.4 discarding ghost parent discards branch",
  async () => {
    const p = withMap([card("root", "Root"), card("platform", "Platform", "root")]);
    await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
    await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
    await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "Forgotten"]);
    await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
    await ok(p, ["discard", "auth"]);
    for (const id of ["auth", "magic", "magic:opt0"]) expect((await p.werk(["show", id])).code).toBe(1);
    const pl = (await ok(p, ["show", "platform"])).out;
    expect(pl).not.toContain("ghost");
    expect(pl).not.toContain("Auth");
    expect(pl).not.toContain("Passwords");
  },
  T,
);

test(
  "63.5 a ghost changes no count of a real card",
  async () => {
    const p = withMap([
      card("root", "Root"),
      ...decidedCard("storage", "Storage", "root"),
      ...decidedCard("child", "Real child", "storage"),
    ]);
    const strip = (s: string) =>
      s
        .split("\n")
        .filter((l) => !l.includes("ghost"))
        .join("\n");
    const before = strip((await ok(p, ["show", "storage"])).out);
    expect(before).not.toContain("stale");
    await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--who", "you"]);
    await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "PG", "--why_not", "server"]);
    await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
    await ok(p, ["kill", "sqlite", "--revisit"]);
    await ok(p, ["status", "sqlite", "decided"]);
    const during = strip((await ok(p, ["show", "storage"])).out);
    expect(during).toBe(before);
    await ok(p, ["accept", "sqlite", "--actor", "you"]);
    const rollup = (s: string) => s.split("\n").find((l) => l.startsWith("subtree")) ?? "";
    expect(rollup(strip((await ok(p, ["show", "storage"])).out))).not.toBe(rollup(before));
  },
  T,
);

test(
  "06.1/06.2 excerpt stages as ghost; accept makes it real and its link live",
  async () => {
    const p = withMap([card("root", "Root"), ...decidedCard("dec", "Decided card", "root")]);
    addChat(p, "chat", ["we keep one log per conversation"]);
    const cardBefore = (await ok(p, ["show", "dec"])).out;
    const r = await ok(p, ["quote", "dec", "chat", "one log per conversation"]);
    expect(r.out).toContain("proposed");
    expect(r.out).not.toContain("added");
    const ex = (await ok(p, ["show", "dec:ex0"])).out;
    expect(ex).toContain("proposed");
    expect(ex).toContain("<- supported_by    dec  Decided card  (held)");
    const after = (await ok(p, ["show", "dec"])).out;
    expect(after).toStartWith("card dec  [decided]");
    expect(after).toContain("dec:ex0");
    expect(after).toContain("(ghost, held)");
    expect(after.split("\n")[1]).toBe(cardBefore.split("\n")[1]);
    const b = lines(p).length;
    await ok(p, ["accept", "dec:ex0", "--actor", "you"]);
    expect(lines(p)).toHaveLength(b + 1);
    const ex2 = (await ok(p, ["show", "dec:ex0"])).out;
    expect(ex2).not.toContain("proposed");
    expect(ex2).toContain("<- supported_by    dec  Decided card\n");
    const view = (await ok(p, ["show", "dec"])).out;
    expect(view).toContain("Say");
    expect(view).toContain("one log per conversation");
    expect(view).not.toContain("(held)");
  },
  T,
);
