import { expect, test } from "bun:test";
import { join, mk, mkdirSync, writeFileSync } from "./h.ts";

const all = (r: { out: string; err: string }) => r.out + r.err;

function chat(h: ReturnType<typeof mk>, name: string, lines: object[]) {
  mkdirSync(join(h.p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(h.p.dir, ".werk", "chats", `${name}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}
const m = (kind: string, text: string, speaker: string, at = "2026-02-03T04:05:06Z", session = "sess-123") => ({
  speaker,
  at,
  session,
  kind,
  text,
});

test("[11.1] rollup counts the card and its subtree", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("c1", "Child open", "root");
  h.real("c2", "Child proto", "root", { status: "proto" });
  h.real("g", "Grand", "c1");
  h.decide("root");
  h.decide("g");
  const s = await h.out("show", "root");
  console.log(s);
  const lines = s.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(lines.length).toBe(1);
  expect(lines[0]).toContain("4 cards");
  expect(lines[0]).toContain("1 open");
  expect(lines[0]).toContain("1 proto");
  expect(lines[0]).toContain("2 decided");
});

test("[11.2] incoming refines shows the child's own rollup", async () => {
  const h = mk();
  h.real("parent", "Parent");
  h.real("child", "Child", "parent");
  h.real("g1", "G1", "child");
  h.real("g2", "G2", "child");
  h.decide("g2");
  const s = await h.out("show", "parent");
  expect(s).toMatch(/<- refines\s+child\s+Child\s+\(3 cards/);
  expect(s).toContain("subtree: 4 cards");
});

function chatFor(h: ReturnType<typeof mk>) {
  chat(h, "c1", [m("spoken", "we keep one log per conversation", "person")]);
}

test("[11.3] a card prints options, excerpts and a proposed source", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("base", "Base card", "root");
  h.real("card", "The card", "root");
  h.edge("card", "base", "depends_on", "takes the format");
  h.seed("node.added", { id: "opt", kind: "option", title: "Use XML", why_not: "too verbose" });
  h.edge("opt", "card", "alternative_to");
  chatFor(h);
  await h.w("quote", "card", "c1", "one log per conversation");
  await h.w("accept", "card:ex0", "--actor", "you");
  await h.w("add", "src", "--kind", "source", "--title", "Log paper", "--finding", "logs scale");
  await h.w("link", "card", "src", "--type", "supported_by");
  const s = await h.out("show", "card");
  console.log(s);
  expect(s).toMatch(/-> depends_on\s+base\s+Base card/);
  expect(s).toContain("why: takes the format");
  const iL = s.indexOf("-> depends_on");
  const iO = s.indexOf("Options\n");
  expect(iO).toBeGreaterThan(iL);
  expect(s).toMatch(/Options\n\s+opt\s+Use XML\n\s+why not: too verbose/);
  expect(s).toMatch(/Say\n\s+card:ex0\s+person: "one log per conversation"/);
  expect(s).toMatch(/Ev\n\s+src\s+Log paper\s+proposed\n\s+finding: logs scale/);
});

test("[11.4] no options, no Options section", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("card", "The card", "root");
  chatFor(h);
  await h.w("quote", "card", "c1", "one log per conversation");
  await h.w("add", "src", "--kind", "source", "--title", "Log paper", "--finding", "logs scale");
  await h.w("link", "card", "src", "--type", "supported_by");
  const s = await h.out("show", "card");
  expect(s).toContain("Say\n");
  expect(s).toContain("Ev\n");
  expect(s).not.toContain("Options");
});

test("[11.5] show with no id prints the root", async () => {
  const h = mk();
  h.real("root", "The Root Title");
  h.real("second", "Second", "root");
  const s = await h.out("show");
  expect(s).toContain("The Root Title");
  expect(s).toMatch(/subtree: 2 cards/);
  expect(s).toMatch(/<- refines\s+second\s+Second\s+\(1 card/);
});

test("[12.1] a unique quote becomes an excerpt ghost", async () => {
  const h = mk();
  h.real("root", "Root");
  h.seed("node.proposed", { id: "citing", kind: "card", title: "Citing", parent: "root" }, "agent");
  chat(h, "conv", [
    m("tool_result", "tool output", "agent"),
    m("spoken", "ok, start", "person", "2026-02-03T04:00:00Z"),
    m("spoken", "we keep one log per conversation and never rewrite it", "agent", "2026-02-03T04:05:06Z", "sess-abc"),
  ]);
  const n = h.count();
  const r = await h.w("quote", "citing", "conv", "one log per conversation");
  console.log(all(r));
  expect(r.code).toBe(0);
  expect(h.count()).toBe(n + 1);
  const ev = h.events().at(-1)!;
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("citing");
  const s = await h.out("show", "citing");
  expect(s).toMatch(/-> supported_by\s+citing:ex0.*held/);
  const x = await h.out("show", "citing:ex0");
  console.log(x);
  expect(x).toContain("one log per conversation");
  expect(x).toContain("speaker: agent");
  expect(x).toContain("said at: 2026-02-03T04:05:06Z");
  expect(x).toContain("session: sess-abc");
  expect(x).toMatch(/message: 3\b/);
  const start = "we keep ".length;
  expect(x).toContain(`span: ${start}..${start + "one log per conversation".length}`);
});

test("[12.2] a quote that is not unique fails and writes nothing", async () => {
  const h = mk();
  h.real("root", "Root");
  h.seed("node.proposed", { id: "citing", kind: "card", title: "Citing", parent: "root" }, "agent");
  chat(h, "conv", [
    m("spoken", "ship the reader first", "person"),
    m("spoken", "ship the reader first", "agent"),
    m("spoken", "retry, then retry again", "person"),
  ]);
  const n = h.count();
  const a = await h.w("quote", "citing", "conv", "ship the reader first");
  console.log(all(a));
  expect(a.code).not.toBe(0);
  expect(all(a)).toMatch(/\b2 messages/);
  const b = await h.w("quote", "citing", "conv", "retry");
  console.log(all(b));
  expect(b.code).not.toBe(0);
  expect(all(b)).toMatch(/\b2 times in message/);
  const c = await h.w("quote", "citing", "conv", "a sentence nobody said");
  console.log(all(c));
  expect(c.code).not.toBe(0);
  expect(all(c)).toContain("no exact match");
  expect(h.count()).toBe(n);
  expect((await h.w("show", "citing:ex0")).code).not.toBe(0);
});

test("[12.3] tool output is never quotable", async () => {
  const h = mk();
  h.real("root", "Root");
  h.seed("node.proposed", { id: "citing", kind: "card", title: "Citing", parent: "root" }, "agent");
  chat(h, "conv", [
    m("tool_result", "exit code 137 from the runner", "agent"),
    m("tool_call", "run exit code 137", "agent"),
    m("tooling", "note: exit code 137", "agent"),
    m("spoken", "it failed", "person"),
  ]);
  const n = h.count();
  const r = await h.w("quote", "citing", "conv", "exit code 137");
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("no exact match");
  expect(h.count()).toBe(n);
});

test("[12.4] excerpt words cannot be written or changed by hand", async () => {
  const h = mk();
  h.real("root", "Root");
  h.seed("node.proposed", { id: "citing", kind: "card", title: "Citing", parent: "root" }, "agent");
  chat(h, "conv", [m("spoken", "we keep one log per conversation", "person")]);
  await h.w("quote", "citing", "conv", "one log per conversation");
  let n = h.count();
  const a = await h.w("add", "hand", "--kind", "excerpt", "--title", "my words");
  expect(a.code).not.toBe(0);
  expect(h.count()).toBe(n);
  const t = await h.w("retitle", "citing:ex0", "changed");
  console.log("retitle ghost excerpt:", all(t));
  expect(t.code).not.toBe(0);
  const e = await h.w("edit", "citing:ex0", "--body", "changed");
  console.log("edit ghost excerpt:", all(e));
  expect(e.code).not.toBe(0);
  expect(h.count()).toBe(n);
  expect(await h.out("show", "citing:ex0")).toContain("one log per conversation");
  const s = await h.w("say", "citing:ex0", "a note");
  expect(s.code).toBe(0);
  expect(await h.out("show", "citing:ex0")).toContain("a note");
  expect((await h.w("accept", "citing", "--actor", "you")).code).toBe(0);
  n = h.count();
  const e2 = await h.w("edit", "citing:ex0", "--body", "again");
  console.log("edit real excerpt:", all(e2));
  expect(e2.code).not.toBe(0);
  const t2 = await h.w("retitle", "citing:ex0", "again");
  expect(t2.code).not.toBe(0);
  const p = await h.w("propose", "citing:ex0", "--title", "again");
  console.log("propose real excerpt:", all(p));
  expect(p.code).not.toBe(0);
  expect(h.count()).toBe(n);
  expect(await h.out("show", "citing:ex0")).toContain("one log per conversation");
});

test("[12.5] excerpt follows its citing card", async () => {
  const h = mk();
  h.real("root", "Root");
  h.seed("node.proposed", { id: "one", kind: "card", title: "One", parent: "root" }, "agent");
  h.seed("node.proposed", { id: "two", kind: "card", title: "Two", parent: "root" }, "agent");
  chat(h, "conv", [m("spoken", "alpha words here", "person"), m("spoken", "beta words there", "agent")]);
  await h.w("quote", "one", "conv", "alpha words");
  await h.w("quote", "two", "conv", "beta words");
  expect((await h.w("discard", "one")).code).toBe(0);
  expect((await h.w("show", "one")).code).not.toBe(0);
  expect((await h.w("show", "one:ex0")).code).not.toBe(0);
  expect((await h.w("accept", "two", "--actor", "you")).code).toBe(0);
  const x = await h.out("show", "two:ex0");
  console.log(x);
  expect(x.split("\n")[0]).not.toContain("proposed");
  for (const t of ["beta words", "speaker: agent", "said at:", "session: sess", "message: 1", "span: 0..10"]) expect(x).toContain(t);
});

test("[67.1][67.2] quote a user and an assistant message; pointer finds the text", async () => {
  const h = mk();
  h.real("werk-excerpt", "Excerpt");
  const lines = [
    m("spoken", "hello", "user"),
    m("spoken", "Every quote in the imported map was written from memory", "user", "t1", "sess-1"),
    m("tool_call", "x", "assistant"),
    m("spoken", "Indeed, the tool never guesses at all", "assistant", "t2", "sess-1"),
  ];
  chat(h, "sess", lines);
  const r = await h.w("quote", "#werk-excerpt", "sess", "written from memory");
  expect(r.code).toBe(0);
  const x = await h.out("show", "werk-excerpt:ex0");
  expect(x.split("\n")[0]).toContain("proposed");
  expect(x).toContain("speaker: user");
  expect(x).toContain("message: 1");
  const st = "Every quote in the imported map was ".length;
  expect(x).toContain(`span: ${st}..${st + "written from memory".length}`);
  expect(await h.out("show", "werk-excerpt")).toMatch(/-> supported_by\s+werk-excerpt:ex0/);
  const r2 = await h.w("quote", "#werk-excerpt", "sess", "never guesses");
  expect(r2.code).toBe(0);
  const y = await h.out("show", "werk-excerpt:ex1");
  const mm = /message: (\d+)/.exec(y);
  const sp = /span: (\d+)\.\.(\d+)/.exec(y);
  expect(y).toContain("speaker: assistant");
  const line = lines[Number(mm?.[1])]!;
  expect(line.text.slice(Number(sp?.[1]), Number(sp?.[2]))).toBe("never guesses");
});

test("[67.3] one changed character fails", async () => {
  const h = mk();
  h.real("c", "Card");
  chat(h, "sess", [m("spoken", "the tool never guesses", "user")]);
  const n = h.count();
  const r = await h.w("quote", "c", "sess", "the tool never gueses");
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("no exact match");
  expect(h.count()).toBe(n);
  expect((await h.w("show", "c:ex0")).code).not.toBe(0);
});

test("[67.4] quote in two messages names both", async () => {
  const h = mk();
  h.real("c", "Card");
  chat(h, "sess", [
    m("spoken", "a", "user"),
    m("spoken", "b", "user"),
    m("tool_call", "c", "assistant"),
    m("spoken", "it fails instead of guessing", "assistant"),
    m("spoken", "d", "user"),
    m("spoken", "e", "user"),
    m("tool_call", "f", "assistant"),
    m("spoken", "fails instead of guessing again", "user"),
  ]);
  const n = h.count();
  const r = await h.w("quote", "c", "sess", "fails instead of guessing");
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("3");
  expect(all(r)).toContain("7");
  expect(h.count()).toBe(n);
  expect((await h.w("show", "c:ex0")).code).not.toBe(0);
});

test("[67.5] a ghost excerpt is accepted like any ghost", async () => {
  const h = mk();
  h.real("c", "Card");
  chat(h, "sess", [m("spoken", "the tool never guesses", "user")]);
  await h.w("quote", "c", "sess", "never guesses");
  const a = await h.w("accept", "c:ex0", "--actor", "you");
  expect(a.code).toBe(0);
  const x = await h.out("show", "c:ex0");
  expect(x.split("\n")[0]).not.toContain("proposed");
  expect(await h.out("show", "c")).toMatch(/-> supported_by\s+c:ex0\s+never guesses\s*\n/);
});
