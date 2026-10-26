import { expect, test } from "bun:test";
import { card, ok, personSays, withMap } from "./helpers.ts";

test("10.1 an agent's note appears on the card's thread", async () => {
  const p = withMap([card("root", "Root"), card("auth-login", "Login uses magic links", "root", { status: "decided" })]);
  await ok(p, ["say", "auth-login", "Should expired links show a retry button?"]);
  const show = (await ok(p, ["show", "auth-login"])).out;
  expect(show).toMatch(/Thread\n {2}\[\d+\] agent: Should expired links show a retry button\?\n/);
});

test("10.2 the inbox, after a log position and capped by count", async () => {
  const p = withMap([card("auth-login", "Login uses magic links")]);
  const seqs = ["first", "second", "third", "fourth"].map((t) => personSays(p, "auth-login", t));
  const all = (await ok(p, ["inbox"])).out;
  expect(all).toBe(
    ["first", "second", "third", "fourth"]
      .map((t, i) => `[${seqs[i]}] #auth-login  Login uses magic links\n    ${t}\n`)
      .join(""),
  );
  const since = (await ok(p, ["inbox", "--since", String(seqs[0])])).out;
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = (await ok(p, ["inbox", "--since", String(seqs[0]), "-n", "2"])).out;
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker", async () => {
  const p = withMap([card("auth", "Auth")]);
  await ok(p, ["add", "auth-retry", "--title", "Retry sends a new link", "--parent", "auth"]);
  expect((await ok(p, ["show", "auth-retry"])).out.split("\n")[0]).toContain("proposed");
  personSays(p, "auth-retry", "No — retry must reuse the same link");
  await ok(p, ["say", "auth-retry", "Understood, I will correct it"]);
  await ok(p, ["discard", "auth-retry"]);
  await ok(p, ["add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "auth"]);
  let show = (await ok(p, ["show", "auth-retry"])).out;
  const thread = show.slice(show.indexOf("Thread\n"));
  const a = thread.indexOf("No — retry must reuse the same link");
  const b = thread.indexOf("Understood, I will correct it");
  const m = thread.indexOf("proposed again");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(-1);
  expect(m).toBeGreaterThan(Math.max(a, b));
  expect(thread.split("proposed again").length - 1).toBe(1);
  expect(show).toContain("Retry reuses the same link");
  personSays(p, "auth-retry", "Good, accept");
  show = (await ok(p, ["show", "auth-retry"])).out;
  expect(show.indexOf("Good, accept")).toBeGreaterThan(show.indexOf("proposed again"));
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async () => {
  const p = withMap([card("cache", "Cache")]);
  await ok(p, ["add", "cache-ttl", "--title", "Entries live 60 seconds", "--parent", "cache"]);
  personSays(p, "cache-ttl", "Why 60 seconds?");
  await ok(p, ["discard", "cache-ttl"]);
  const inbox = (await ok(p, ["inbox"])).out;
  expect(inbox).toContain("#cache-ttl");
  expect(inbox).toContain("Why 60 seconds?");
  await ok(p, ["add", "cache-ttl", "--title", "Entries live 30 seconds", "--parent", "cache"]);
  const show = (await ok(p, ["show", "cache-ttl"])).out;
  const n = show.indexOf("Why 60 seconds?");
  expect(n).toBeGreaterThan(-1);
  expect(show.indexOf("proposed again")).toBeGreaterThan(n);
  expect(show.split("proposed again").length - 1).toBe(1);
});

test("10.5 an agent writes a note on an excerpt", async () => {
  // The excerpt event is seeded as a quote writes it, with the step's id.
  const p = withMap([
    card("retry", "Retry"),
    ["node.added", { id: "src-rfc", kind: "source", title: "RFC" }],
    ["excerpt.quoted", { id: "src-rfc-quote", title: "retry with backoff", card: "retry", conversation: "c", session: "s", message: 0, start: 0, end: 18, speaker: "person", said_at: "t" }],
  ]);
  const say = await p.werk(["say", "src-rfc-quote", "This quote supports the retry decision"]);
  expect(say.code).toBe(0);
  expect((await ok(p, ["show", "src-rfc-quote"])).out).toContain("agent: This quote supports the retry decision");
});
