import { expect, test } from "bun:test";
import { project } from "./helpers.ts";

// "the person opens the map": the map is served by `werk serve` (the dev script runs it).
async function mapServes(p: ReturnType<typeof project>) {
  const proc = p.start([process.execPath, `${import.meta.dir}/../src/cli.ts`, "serve"]);
  const timer = setTimeout(() => proc.kill(), 3000);
  const code = await proc.exited;
  clearTimeout(timer);
  const err = await new Response(proc.stderr).text();
  return { code, err };
}

test("10.1", async () => {
  const p = project();
  p.real("auth-login", "Login uses magic links", undefined, { status: "decided" });
  const say = await p.werk(["say", "auth-login", "Should expired links show a retry button?"]);
  expect(say.code).toBe(0);
  const show = await p.ok(["show", "auth-login"]);
  expect(show).toContain("agent: Should expired links show a retry button?");
  const map = await mapServes(p);
  expect(map.err).not.toContain("unknown verb serve");
});

test("10.2", async () => {
  const p = project();
  p.real("auth-login", "Login");
  const seqs = ["first", "second", "third", "fourth"].map((t) => p.personNote("auth-login", t));
  const all = await p.ok(["inbox"]);
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  for (const s of seqs) expect(all).toContain(`[${s}] #auth-login`);
  const since = await p.ok(["inbox", "--since", String(seqs[0])]);
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = await p.ok(["inbox", "--since", String(seqs[0]), "-n", "2"]);
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3", async () => {
  const p = project();
  await p.ok(["add", "auth-retry", "--title", "Retry sends a new link"]);
  p.personNote("auth-retry", "No — retry must reuse the same link");
  await p.ok(["say", "auth-retry", "Understood, I will correct it"]);
  await p.ok(["discard", "auth-retry"]);
  await p.ok(["add", "auth-retry", "--title", "Retry reuses the same link"]);
  const show = await p.ok(["show", "auth-retry"]);
  const a = show.indexOf("No — retry must reuse the same link");
  const b = show.indexOf("Understood, I will correct it");
  const m = show.indexOf("proposed again");
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  expect(m).toBeGreaterThan(b);
  expect(show.split("proposed again").length - 1).toBe(1);
  expect(show).toContain("Retry reuses the same link");
  p.personNote("auth-retry", "Good, accept");
  const show2 = await p.ok(["show", "auth-retry"]);
  expect(show2.indexOf("Good, accept")).toBeGreaterThan(show2.indexOf("proposed again"));
  const map = await mapServes(p);
  expect(map.err).not.toContain("unknown verb serve");
});

test("10.4", async () => {
  const p = project();
  await p.ok(["add", "cache-ttl", "--title", "Cache entries live 60 seconds"]);
  p.personNote("cache-ttl", "Why 60 seconds?");
  await p.ok(["discard", "cache-ttl"]);
  const inbox = await p.ok(["inbox"]);
  expect(inbox).toContain("#cache-ttl");
  expect(inbox).toContain("Why 60 seconds?");
  await p.ok(["add", "cache-ttl", "--title", "Cache entries live 30 seconds"]);
  const show = await p.ok(["show", "cache-ttl"]);
  expect(show.indexOf("Why 60 seconds?")).toBeGreaterThan(0);
  expect(show.indexOf("proposed again")).toBeGreaterThan(show.indexOf("Why 60 seconds?"));
  expect(show.split("proposed again").length - 1).toBe(1);
  const map = await mapServes(p);
  expect(map.err).not.toContain("unknown verb serve");
});

test("10.5", async () => {
  const p = project();
  p.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 9110", url: "https://www.rfc-editor.org/rfc/rfc9110" });
  p.seed("node.added", { id: "src-rfc-quote", kind: "excerpt", title: "A client may retry an idempotent request", parent: undefined });
  const say = await p.werk(["say", "src-rfc-quote", "This quote supports the retry decision"]);
  expect(say.code).toBe(0);
  expect(await p.ok(["show", "src-rfc-quote"])).toContain("This quote supports the retry decision");
  const map = await mapServes(p);
  expect(map.err).not.toContain("unknown verb serve");
});
