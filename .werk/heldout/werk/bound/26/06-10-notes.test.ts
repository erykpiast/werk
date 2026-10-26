import { expect, test } from "bun:test";
import { events, freshProject, seed } from "./helpers.ts";

const card = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});
const personNote = (id: string, text: string) => ({ type: "note.added", actor: "you", payload: { id, text } });

test("06.1 an agent adds an excerpt that supports a decided card", async () => {
  const p = freshProject();
  seed(p, [card("retry", "Retry once"), { type: "node.decided", payload: { id: "retry" } }]);
  const help = await p.werk(["help"]);
  console.log("06.1 help mentions excerpt/quote verb:", /^\s+(quote|excerpt)\b/m.test(help.out));
  const add = await p.werk(["add", "retry-quote", "--kind", "excerpt", "--title", "RFC says retry once"]);
  console.log("06.1 add --kind excerpt:", JSON.stringify(add));
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live (accept via CLI as the ✓)", async () => {
  const p = freshProject();
  seed(p, [
    card("retry", "Retry once"),
    { type: "node.added", payload: { id: "src-rfc", kind: "source", title: "RFC", url: "https://example.com/rfc" } },
    { type: "node.proposed", actor: "agent", payload: { id: "retry-quote", kind: "excerpt", title: "Retry once" } },
    { type: "edge.added", actor: "agent", payload: { from: "retry", to: "retry-quote", type: "supported_by" } },
  ]);
  const before = await p.werk(["show", "retry"]);
  console.log("06.2 show card before:", JSON.stringify(before));
  const acc = await p.werk(["accept", "retry-quote", "--actor", "you"]);
  console.log("06.2 accept:", JSON.stringify(acc));
  const q = await p.werk(["show", "retry-quote"]);
  console.log("06.2 show excerpt:", JSON.stringify(q));
  const after = await p.werk(["show", "retry"]);
  console.log("06.2 show card after:", JSON.stringify(after));
  // The step needs the person to open the card view in the map. No map UI exists.
  const serve = await p.werk(["serve"]);
  console.log("06.2 serve:", serve.code, serve.err.split("\n")[0]);
  expect(serve.code).toBe(0);
});

test("10.1 an agent's note appears on the card's thread in the map", async () => {
  const p = freshProject();
  seed(p, [card("auth-login", "Login uses magic links"), { type: "node.decided", payload: { id: "auth-login" } }]);
  const say = await p.werk(["say", "auth-login", "Should expired links show a retry button?"]);
  console.log("10.1 say:", JSON.stringify(say));
  expect(say.code).toBe(0);
  const s = await p.werk(["show", "auth-login"]);
  console.log("10.1 show (CLI thread):", s.out);
  expect(s.out).toContain("agent: Should expired links show a retry button?");
  const serve = await p.werk(["serve"]);
  console.log("10.1 serve:", serve.code, serve.err.split("\n")[0]);
  expect(serve.code).toBe(0);
});

test("10.2 inbox lists the person's notes after a log position, capped by count", async () => {
  const p = freshProject();
  seed(p, [card("auth-login", "Login uses magic links")]);
  seed(p, ["first", "second", "third", "fourth"].map((t) => personNote("auth-login", t)));
  const all = await p.werk(["inbox"]);
  console.log("10.2 inbox:", JSON.stringify(all));
  const order = ["first", "second", "third", "fourth"].map((t) => all.out.indexOf(`    ${t}\n`));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const heads = all.out.split("\n").filter((l) => l.startsWith("["));
  expect(heads.length).toBe(4);
  for (const h of heads) expect(h).toMatch(/^\[\d+\] #auth-login/);
  const firstSeq = Number(/^\[(\d+)\]/.exec(heads[0] as string)?.[1]);
  const since = await p.werk(["inbox", "--since", String(firstSeq)]);
  console.log("10.2 inbox --since:", JSON.stringify(since));
  expect(since.out).not.toContain("    first\n");
  for (const t of ["second", "third", "fourth"]) expect(since.out).toContain(`    ${t}\n`);
  const capped = await p.werk(["inbox", "--since", String(firstSeq), "-n", "2"]);
  console.log("10.2 inbox --since -n 2:", JSON.stringify(capped));
  expect(capped.code).toBe(0);
  expect(capped.out).toContain("    second\n");
  expect(capped.out).toContain("    third\n");
  expect(capped.out).not.toContain("fourth");
  expect(capped.out).not.toContain("    first\n");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker", async () => {
  const p = freshProject();
  const add1 = await p.werk(["add", "auth-retry", "--title", "Retry sends a new link"]);
  expect(add1.code).toBe(0);
  seed(p, [personNote("auth-retry", "No — retry must reuse the same link")]);
  expect((await p.werk(["say", "auth-retry", "Understood, I will correct it"])).code).toBe(0);
  expect((await p.werk(["discard", "auth-retry"])).code).toBe(0);
  const add2 = await p.werk(["add", "auth-retry", "--title", "Retry reuses the same link"]);
  console.log("10.3 add again:", JSON.stringify(add2));
  expect(add2.code).toBe(0);
  const s = await p.werk(["show", "auth-retry"]);
  console.log("10.3 show (CLI thread):", s.out);
  const iNo = s.out.indexOf("No — retry must reuse the same link");
  const iOk = s.out.indexOf("Understood, I will correct it");
  const markers = s.out.split("\n").filter((l) => l.includes("proposed again"));
  expect(iNo).toBeGreaterThan(-1);
  expect(iOk).toBeGreaterThan(-1);
  expect(markers.length).toBe(1);
  expect(s.out.indexOf("proposed again")).toBeGreaterThan(Math.max(iNo, iOk));
  expect(s.out).toContain("Retry reuses the same link");
  seed(p, [personNote("auth-retry", "Good, accept")]);
  const s2 = await p.werk(["show", "auth-retry"]);
  expect(s2.out.indexOf("Good, accept")).toBeGreaterThan(s2.out.indexOf("proposed again"));
  // The person opens the thread and types in the map. No map UI exists.
  const serve = await p.werk(["serve"]);
  console.log("10.3 serve:", serve.code, serve.err.split("\n")[0]);
  expect(serve.code).toBe(0);
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async () => {
  const p = freshProject();
  expect((await p.werk(["add", "cache-ttl", "--title", "Cache entries live 60 seconds"])).code).toBe(0);
  seed(p, [personNote("cache-ttl", "Why 60 seconds?")]);
  expect((await p.werk(["discard", "cache-ttl"])).code).toBe(0);
  const inbox = await p.werk(["inbox"]);
  console.log("10.4 inbox:", JSON.stringify(inbox));
  expect(inbox.out).toContain("#cache-ttl");
  expect(inbox.out).toContain("Why 60 seconds?");
  expect((await p.werk(["add", "cache-ttl", "--title", "Cache entries live 30 seconds"])).code).toBe(0);
  const s = await p.werk(["show", "cache-ttl"]);
  console.log("10.4 show (CLI thread):", s.out);
  const markers = s.out.split("\n").filter((l) => l.includes("proposed again"));
  expect(markers.length).toBe(1);
  expect(s.out.indexOf("Why 60 seconds?")).toBeLessThan(s.out.indexOf("proposed again"));
  const serve = await p.werk(["serve"]);
  console.log("10.4 serve:", serve.code, serve.err.split("\n")[0]);
  expect(serve.code).toBe(0);
});

test("10.5 an agent writes a note on an excerpt", async () => {
  const p = freshProject();
  seed(p, [
    { type: "node.added", payload: { id: "src-rfc", kind: "source", title: "RFC", url: "https://example.com/rfc" } },
    { type: "node.added", payload: { id: "src-rfc-quote", kind: "excerpt", title: "Retry once" } },
  ]);
  const pre = await p.werk(["show", "src-rfc-quote"]);
  console.log("10.5 show excerpt before:", JSON.stringify(pre));
  const say = await p.werk(["say", "src-rfc-quote", "This quote supports the retry decision"]);
  console.log("10.5 say:", JSON.stringify(say));
  expect(say.code).toBe(0);
  const s = await p.werk(["show", "src-rfc-quote"]);
  console.log("10.5 show (CLI thread):", s.out);
  expect(s.out).toContain("This quote supports the retry decision");
  const serve = await p.werk(["serve"]);
  console.log("10.5 serve:", serve.code, serve.err.split("\n")[0]);
  expect(serve.code).toBe(0);
});
