// Scenarios 10.1 - 10.5: notes on threads and the inbox. No map UI exists, so the person's view of
// a thread is the thread that `werk show` prints, and a note the person types is a note.added event
// with actor "you" written to the log, as the map would write it.
import { expect, test } from "bun:test";
import { freshProject, lines, personNote, type Project, real, seed } from "./helpers.ts";

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

const threadOf = (out: string) => {
  const at = out.split("\n").indexOf("Thread");
  return at === -1 ? [] : out.split("\n").slice(at + 1).filter((line) => line !== "");
};
const seqOf = (p: Project, text: string) => lines(p).find((line) => line.payload.text === text)?.seq as number;

test("10.1 an agent's note appears on the card's thread", async () => {
  const p = freshProject();
  seed(p, [real("auth-login", "Login uses magic links", { status: "decided", who: "me" })]);
  await ok(p, ["say", "auth-login", "Should expired links show a retry button?"]);
  const thread = threadOf((await ok(p, ["show", "auth-login"])).out);
  const note = thread.find((line) => line.includes("Should expired links show a retry button?"));
  expect(note).toBeDefined();
  expect(note).toContain("agent:");
});

test("10.2 the inbox starts after a log position and is capped by count", async () => {
  const p = freshProject();
  seed(p, [real("auth-login", "Login uses magic links")]);
  for (const text of ["first", "second", "third", "fourth"]) personNote(p, "auth-login", text);
  const all = (await ok(p, ["inbox"])).out;
  const order = ["first", "second", "third", "fourth"].map((text) => all.indexOf(`    ${text}\n`));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  for (const text of ["first", "second", "third", "fourth"]) {
    expect(all).toContain(`[${seqOf(p, text)}] #auth-login`);
  }
  const since = seqOf(p, "first");
  const after = (await ok(p, ["inbox", "--since", String(since)])).out;
  expect(after).not.toContain("    first\n");
  for (const text of ["second", "third", "fourth"]) expect(after).toContain(`    ${text}\n`);
  const capped = (await ok(p, ["inbox", "--since", String(since), "-n", "2"])).out;
  expect(capped).toContain("    second\n");
  expect(capped).toContain("    third\n");
  expect(capped).not.toContain("    fourth\n");
  expect(capped).not.toContain("    first\n");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async () => {
  const p = freshProject();
  seed(p, [real("auth", "Auth")]);
  await ok(p, ["add", "auth-retry", "--title", "Retry sends a new link", "--parent", "auth"]);
  expect((await ok(p, ["show", "auth-retry"])).out.split("\n")[0]).toContain("proposed");
  personNote(p, "auth-retry", "No — retry must reuse the same link");
  await ok(p, ["say", "auth-retry", "Understood, I will correct it"]);
  await ok(p, ["discard", "auth-retry"]);
  await ok(p, ["add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "auth"]);
  const shown = (await ok(p, ["show", "auth-retry"])).out;
  const thread = threadOf(shown);
  const a = thread.findIndex((line) => line.includes("No — retry must reuse the same link"));
  const b = thread.findIndex((line) => line.includes("Understood, I will correct it"));
  const markers = thread.flatMap((line, i) => (line.includes("proposed again") ? [i] : []));
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThanOrEqual(0);
  expect(markers.length).toBe(1);
  expect(markers[0] as number).toBeGreaterThan(Math.max(a, b));
  expect(shown).toContain("Retry reuses the same link");
  expect(shown).not.toContain("Retry sends a new link");
  personNote(p, "auth-retry", "Good, accept");
  const thread2 = threadOf((await ok(p, ["show", "auth-retry"])).out);
  const good = thread2.findIndex((line) => line.includes("Good, accept"));
  const marker = thread2.findIndex((line) => line.includes("proposed again"));
  expect(good).toBeGreaterThan(marker);
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async () => {
  const p = freshProject();
  await ok(p, ["add", "cache-ttl", "--title", "Cache entries live 60 seconds"]);
  personNote(p, "cache-ttl", "Why 60 seconds?");
  await ok(p, ["discard", "cache-ttl"]);
  const inbox = (await ok(p, ["inbox"])).out;
  expect(inbox).toContain("#cache-ttl");
  expect(inbox).toContain("Why 60 seconds?");
  await ok(p, ["add", "cache-ttl", "--title", "Cache entries live 30 seconds"]);
  const thread = threadOf((await ok(p, ["show", "cache-ttl"])).out);
  const note = thread.findIndex((line) => line.includes("Why 60 seconds?"));
  const markers = thread.flatMap((line, i) => (line.includes("proposed again") ? [i] : []));
  expect(note).toBeGreaterThanOrEqual(0);
  expect(markers.length).toBe(1);
  expect(markers[0] as number).toBeGreaterThan(note);
});

test("10.5 an agent writes a note on an excerpt", async () => {
  const p = freshProject();
  // Given: no verb adds an excerpt, so the source and the excerpt are seeded in the log.
  seed(p, [
    { type: "node.added", payload: { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://example.com/rfc" } },
    { type: "node.added", payload: { id: "src-rfc-quote", kind: "excerpt", title: "Tokens expire" } },
  ]);
  expect((await p.werk(["show", "src-rfc-quote"])).code).toBe(0);
  const say = await p.werk(["say", "src-rfc-quote", "This quote supports the retry decision"]);
  expect(say.code).toBe(0);
  const thread = threadOf((await ok(p, ["show", "src-rfc-quote"])).out);
  expect(thread.some((line) => line.includes("This quote supports the retry decision"))).toBe(true);
});
