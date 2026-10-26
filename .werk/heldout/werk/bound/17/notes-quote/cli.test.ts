// Held-out steps 12.x and 26.x at the command-line seam.
import { expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  existsSync(logOf(p))
    ? readFileSync(logOf(p), "utf8")
        .split("\n")
        .filter((l) => l !== "")
    : [];
function seed(p: Project, events: { type: string; payload: object }[]) {
  const n = lines(p).length;
  appendFileSync(
    logOf(p),
    events.map((e, i) => `${JSON.stringify({ seq: n + i + 1, at: "t", actor: "you", ...e })}\n`).join(""),
  );
}
const msg = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-42", kind, text });
function chat(p: Project, name: string, rows: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.join("\n")}\n`);
}
async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}${r.out}`);
  return r;
}
/** A real root card and a ghost card that cites the conversation. */
async function withGhost(p: Project, id = "logs") {
  seed(p, [{ type: "node.added", payload: { id: "root", kind: "card", title: "Root" } }]);
  await ok(p, ["add", id, "--title", "Logs per conversation", "--parent", "root"]);
}

// ---------- 12.x ----------

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = freshProject();
  chat(p, "talk", [
    msg("tool_result", "ls output", "agent", "t0"),
    msg("spoken", "how should we store chats?", "person", "t1"),
    msg("spoken", "we keep one log per conversation and never rewrite it", "agent", "t2"),
  ]);
  await withGhost(p);
  const before = lines(p).length;
  const run = await p.werk(["quote", "logs", "talk", "one log per conversation"]);
  expect(run.code).toBe(0);
  expect(lines(p).length).toBe(before + 1);
  const ev = JSON.parse(lines(p).at(-1) as string);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("logs");
  const card = (await ok(p, ["show", "logs"])).out;
  expect(card).toMatch(/supported_by\s+logs:ex0/);
  const ex = (await ok(p, ["show", "logs:ex0"])).out;
  expect(ex).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: t2");
  expect(ex).toContain("session: sess-42");
  const s = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(ex).toContain(`span: ${s}..${s + "one log per conversation".length}`);
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = freshProject();
  chat(p, "talk", [
    msg("spoken", "ship the reader first", "person", "t0"),
    msg("spoken", "agreed, ship the reader first", "agent", "t1"),
    msg("spoken", "retry, then retry again", "person", "t2"),
  ]);
  await withGhost(p);
  const before = readFileSync(logOf(p), "utf8");
  const a = await p.werk(["quote", "logs", "talk", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/2 messages/);
  const b = await p.werk(["quote", "logs", "talk", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message|2 matches/);
  const c = await p.werk(["quote", "logs", "talk", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no (exact )?match/);
  expect(readFileSync(logOf(p), "utf8")).toBe(before);
  const card = (await ok(p, ["show", "logs"])).out;
  expect(card).not.toContain("supported_by");
  expect((await p.werk(["show", "logs:ex0"])).code).not.toBe(0);
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = freshProject();
  chat(p, "talk", [
    msg("spoken", "run the job", "person", "t0"),
    msg("tool_call", "check for exit code 137", "agent", "t1"),
    msg("tool_result", "exit code 137 from the runner", "agent", "t2"),
    msg("tooling", "note: exit code 137 seen", "agent", "t3"),
    msg("spoken", "the job was killed", "agent", "t4"),
  ]);
  await withGhost(p);
  const before = lines(p).length;
  const r = await p.werk(["quote", "logs", "talk", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no (exact )?match/);
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "logs:ex0"])).code).not.toBe(0);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = freshProject();
  chat(p, "talk", [msg("spoken", "keep the words verbatim", "person", "t0")]);
  await withGhost(p);
  await ok(p, ["quote", "logs", "talk", "the words verbatim"]);
  let before = readFileSync(logOf(p), "utf8");
  const add = await p.werk(["add", "logs:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(readFileSync(logOf(p), "utf8")).toBe(before);
  const retitle = await p.werk(["propose", "logs:ex0", "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", "logs:ex0", "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(edit.code).not.toBe(0);
  expect(readFileSync(logOf(p), "utf8")).toBe(before);
  expect((await ok(p, ["show", "logs:ex0"])).out).toContain("the words verbatim");
  const note = await p.werk(["say", "logs:ex0", "a note on the quote"]);
  expect(note.code).toBe(0);
  expect(readFileSync(logOf(p), "utf8")).toContain("a note on the quote");
  await ok(p, ["accept", "logs", "--actor", "you"]);
  before = readFileSync(logOf(p), "utf8");
  const again = await p.werk(["propose", "logs:ex0", "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(again.code).not.toBe(0);
  expect(readFileSync(logOf(p), "utf8")).toBe(before);
  const ex = (await ok(p, ["show", "logs:ex0"])).out;
  expect(ex).toContain("the words verbatim");
  expect(ex).not.toContain("other text");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = freshProject();
  chat(p, "talk", [msg("spoken", "alpha words here", "person", "t0"), msg("spoken", "beta words here", "agent", "t1")]);
  await withGhost(p, "first");
  await ok(p, ["add", "second", "--title", "Second", "--parent", "root"]);
  await ok(p, ["quote", "first", "talk", "alpha words"]);
  await ok(p, ["quote", "second", "talk", "beta words"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const card = (await ok(p, ["show", "second"])).out;
  expect(card.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const part of ["beta words", "speaker: agent", "said at: t1", "session: sess-42", "message: 1", "span: 0..10"])
    expect(ex).toContain(part);
});

// ---------- 26.x ----------

const SPEC = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nCLI.\n`;

const ticket = (
  title: string | null,
  cites: string,
  blockedBy: string,
  stories: string,
  build = "Build the thing.",
  checks = "- `make test`\n",
) =>
  `${title === null ? "" : `title: ${title}\n`}cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: map view

## What to build

${build}

## Acceptance criteria

- [ ] It works.

## Checks

${checks}`;

function mapWith(p: Project, decided: string[], ghosts: string[] = []) {
  seed(p, [
    { type: "node.added", payload: { id: "top", kind: "card", title: "Top" } },
    ...decided.map((id) => ({ type: "node.added", payload: { id, kind: "card", title: id, parent: "top" } })),
    ...ghosts.map((id) => ({ type: "node.proposed", payload: { id, kind: "card", title: id, parent: "top" } })),
    { type: "node.decided", payload: { id: "top" } },
    ...decided.map((id) => ({ type: "node.decided", payload: { id } })),
  ]);
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const tc = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);

test("26.1 a folder of valid tickets gets a clean pass", async () => {
  const p = freshProject();
  mapWith(p, ["dec-a", "dec-b"]);
  writeFileSync(join(p.dir, "spec.md"), SPEC(2));
  put(p, {
    "01-a.md": ticket("First slice", "top, dec-a", "", "1"),
    "02-b.md": ticket("Second slice", "#dec-b", "1", "2", "Build the second thing.", ""),
  });
  const r = await tc(p, "--root", "top", "--spec", "spec.md");
  const out = r.out.split("\n").filter(Boolean);
  expect(out.length).toBe(1);
  expect(out[0]).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are named with ticket and place", async () => {
  const p = freshProject();
  mapWith(p, ["dec-a", "dec-b"]);
  writeFileSync(join(p.dir, "spec.md"), SPEC(2));
  const valid = {
    "01-a.md": ticket("First slice", "top, dec-a", "", "1"),
    "02-b.md": ticket("Second slice", "dec-b", "1", "2"),
  };
  put(p, valid);
  expect((await tc(p, "--root", "top", "--spec", "spec.md")).code).toBe(0);
  const first = valid["01-a.md"].split("\n");
  // Line 9 of the file is the first line of the What to build section text.
  expect(first[8]).toBe("Build the thing.");
  first[8] = "Change src/loop.ts so the loop runs, and the Makefile target too.";
  put(p, {
    "01-a.md": first.join("\n"),
    "02-b.md": valid["02-b.md"].replace("Build the thing.", `Build the thing. ${"pad ".repeat(1100)}`),
  });
  const r = await tc(p, "--root", "top", "--spec", "spec.md");
  const out = r.out.split("\n").filter(Boolean);
  const pathLine = out.find((l) => l.startsWith("01-a.md") && l.includes("no-file-paths"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toMatch(/line 9\b/);
  expect(out.slice(0, -1).filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(out.find((l) => l.startsWith("02-b.md") && l.includes("size"))).toBeDefined();
  expect(out.at(-1)).toMatch(/[1-9]\d* failures/);
  expect(r.code).toBe(1);
});

test("26.3 set checks report an uncited card, a missing story and a cycle, not a ghost", async () => {
  const p = freshProject();
  mapWith(p, ["dec-a", "dec-b"], ["ghosty"]);
  writeFileSync(join(p.dir, "spec.md"), SPEC(3));
  put(p, {
    "01-a.md": ticket("One", "top", "", "1"),
    "02-b.md": ticket("Two", "dec-a", "3", "2"),
    "03-c.md": ticket("Three", "dec-a", "2", "1"),
  });
  const r = await tc(p, "--root", "top", "--spec", "spec.md");
  const out = r.out.split("\n").filter(Boolean);
  const cited = out.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("dec-b");
  const stories = out.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("story 3");
  const cyc = out.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cyc).toContain("02-b.md");
  expect(cyc).toContain("03-c.md");
  expect(out.filter((l) => l.includes("ghosty"))).toEqual([]);
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone and its cites do not count", async () => {
  const p = freshProject();
  mapWith(p, ["dec-a"]);
  writeFileSync(join(p.dir, "spec.md"), SPEC(1));
  put(p, { "01-a.md": ticket(null, "top, dec-a", "", "1") });
  const r = await tc(p, "--root", "top", "--spec", "spec.md");
  const out = r.out.split("\n").filter(Boolean);
  const own = out.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(out.find((l) => l.startsWith("ticket set") && l.includes("dec-a"))).toBeDefined();
  expect(out.find((l) => l.startsWith("ticket set") && l.includes("story 1"))).toBeDefined();
  expect(r.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = freshProject();
  mapWith(p, ["dec-a"]);
  put(p, { "01-a.md": ticket("One", "top, dec-a", "", "1") });
  const a = await tc(p, "--root", "top", "--spec", "missing.md");
  expect(`${a.out}${a.err}`).toMatch(/spec/i);
  expect(`${a.out}${a.err}`).toContain("missing.md");
  expect(a.code).toBe(2);
  writeFileSync(join(p.dir, "spec.md"), "# Spec\n\n1. A line.\n");
  expect((await tc(p, "--root", "top", "--spec", "spec.md")).code).toBe(2);
  writeFileSync(join(p.dir, "spec.md"), SPEC(1));
  expect((await tc(p, "--root", "nope", "--spec", "spec.md")).code).toBe(2);
  expect((await tc(p, "--spec", "spec.md")).code).toBe(2);
});
