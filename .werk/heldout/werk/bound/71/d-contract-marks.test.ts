import { expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(60_000);
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const day = new Date().toISOString().slice(0, 10);
const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

function seed(p: Project, events: object[]) {
  const at = lines(p).length;
  appendFileSync(
    logOf(p),
    events
      .map((e, i) => `${JSON.stringify({ seq: at + i + 1, at: `${day}T09:00:00Z`, actor: "you", ...e })}\n`)
      .join(""),
  );
}

const card = (id: string, extra: object = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, status: "decided", who: "me", ...extra },
});
const kill = (id: string) => ({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });
const dep = (from: string, to: string) => ({
  type: "edge.added",
  payload: { from, to, type: "depends_on", why: `${from} uses ${to}` },
});
const option = (id: string) => [
  { type: "node.added", payload: { id: `${id}:opt0`, kind: "option", title: "Other way", why_not: "Slower" } },
  { type: "edge.added", payload: { from: `${id}:opt0`, to: id, type: "alternative_to" } },
];

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

/** Split a printed command line into words, with double-quoted words kept whole. */
function words(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (const m of line.matchAll(re)) out.push(m[1] ?? (m[2] as string));
  return out;
}

/** The printed command lines of a refusal (the lines that hold `werk `), without "or:"/"then:". */
function printed(err: string): string[] {
  return err
    .split("\n")
    .filter((l) => /^\s+(or: |then: )?werk /.test(l))
    .map((l) => l.trim().replace(/^(or: |then: )/, ""));
}

/** Run one printed command, with placeholders filled. */
async function runPrinted(p: Project, line: string, fill: Record<string, string>) {
  let text = line;
  for (const [k, v] of Object.entries(fill)) text = text.split(k).join(v);
  const w = words(text);
  expect(w[0]).toBe("werk");
  return ok(p, w.slice(1));
}

// ---------- 64 ----------

/** A decided base card with no parent, and no card with id root, so a parent gives no basis. */
function base(): Project {
  const p = freshProject();
  seed(p, [card("base", { no_basis: "the top" }), kill("base")]);
  return p;
}

test("64.1", async () => {
  const p = base();
  seed(p, [card("x", { status: "open", who: "you" }), dep("x", "base"), ...option("x")]);
  const before = lines(p);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toContain("kill criterion");
  expect(text).toContain("1 fact is missing");
  expect(text).not.toContain("  who:");
  expect(text).not.toContain("  basis:");
  expect(text).not.toContain("  option:");
  const cmds = printed(text);
  const revisit = cmds.find((c) => c === "werk kill x --revisit");
  expect(revisit).toBeDefined();
  expect((await ok(p, ["show", "x"])).out).toStartWith("card x  [open]");
  expect(lines(p)).toEqual(before);
  await runPrinted(p, revisit as string, {});
  const again = await p.werk(["status", "x", "decided"]);
  expect(again.code).toBe(0);
  expect((await ok(p, ["show", "x"])).out).toStartWith("card x  [decided]");
});

test("64.2", async () => {
  const p = base();
  seed(p, [
    {
      type: "node.added",
      payload: { id: "x", kind: "card", title: "Card x", body: "Some body text.", status: "open" },
    },
  ]);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  for (const fact of ["  who:", "  basis:", "  option:", "  kill criterion:"]) expect(text).toContain(fact);
  const cmds = printed(text);
  const who = cmds.find((c) => c.startsWith("werk edit x --who"));
  const link = cmds.find((c) => c.startsWith("werk link x "));
  const addOpt = cmds.find((c) => c.startsWith("werk add x:opt0"));
  const linkOpt = cmds.find((c) => c.startsWith("werk link x:opt0 x"));
  const k = cmds.find((c) => c.startsWith("werk kill x --manual"));
  for (const c of [who, link, addOpt, linkOpt, k]) expect(c).toBeDefined();
  expect((await ok(p, ["show", "x"])).out).toStartWith("card x  [open]");
  const fill = {
    "you|me|prototype": "you",
    "<what x takes from <card>>": "x reads the base",
    "<card>": "base",
    "<the option>": "A flat fee",
    "<why it lost>": "Big teams underpay",
    "<the test you run>": "I use it every week",
  };
  for (const c of [who, link, addOpt, linkOpt, k]) await runPrinted(p, c as string, fill);
  const again = await p.werk(["status", "x", "decided"]);
  expect(again.code).toBe(0);
  expect((await ok(p, ["show", "x"])).out).toStartWith("card x  [decided]");
});

test("64.3", async () => {
  const p = base();
  await ok(p, ["add", "g1", "--title", "G1", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "G1 reads the base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "G2", "--who", "you"]);
  await ok(p, ["add", "g2:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(p, ["link", "g2:opt0", "g2", "--type", "alternative_to"]);
  await ok(p, ["kill", "g2", "--revisit"]);
  const first = await p.werk(["status", "g1", "decided"]);
  expect(first.code).toBe(0);
  expect((await ok(p, ["show", "g1"])).out).toMatch(/^card g1 {2}\[decided\]/);
  const second = await p.werk(["status", "g2", "decided"]);
  expect(second.code).not.toBe(0);
  const text = second.out + second.err;
  expect(text).toContain("basis: no decided card is a basis of #g2");
  expect(printed(text).some((c) => c.startsWith("werk link g2 <card> --type depends_on"))).toBe(true);
  expect((await ok(p, ["show", "g2"])).out).not.toMatch(/^card g2 {2}\[decided\]/);
});

/** A decided card x with who you, a depends_on edge to base, an option, a kill criterion. */
function decidedX(): Project {
  const p = base();
  seed(p, [
    card("x", { who: "you", body: "We charge per seat.\n\nSeats track value." }),
    dep("x", "base"),
    ...option("x"),
    kill("x"),
  ]);
  return p;
}

test("64.4", async () => {
  const p = decidedX();
  const shownBefore = (await ok(p, ["show", "x"])).out;
  expect(shownBefore).toStartWith("card x  [decided]");
  // The amend that removes the depends_on edge is an unlink: a propose changes only title, why and body.
  const run = await p.werk(["unlink", "x", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toContain("basis: no decided card is a basis of #x");
  expect(printed(text).some((c) => c.startsWith("werk link x <card> --type depends_on"))).toBe(true);
  const shownAfter = (await ok(p, ["show", "x"])).out;
  expect(shownAfter).toStartWith("card x  [decided]");
  expect(shownAfter).toBe(shownBefore);
});

test("64.5", async () => {
  const p = decidedX();
  const opsArg = JSON.stringify([
    { tag: "elaborated", old: "We charge per seat.", new: "Seats." },
    { tag: "removed", old: "Seats track value." },
  ]);
  await ok(p, ["propose", "x", "--ops", opsArg]);
  const before = lines(p).length;
  const acc = await p.werk(["accept", "x", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const show = (await ok(p, ["show", "x"])).out;
  expect(show).toStartWith("card x  [decided]");
  expect(show).toContain("\nSeats.\n");
  expect(show).not.toContain("Seats track value.");
  const types = lines(p)
    .slice(before)
    .map((l) => JSON.parse(l));
  const reopen = types.findIndex((e) => e.type === "node.reopened" && e.payload.id === "x");
  const decide = types.findIndex((e) => e.type === "node.decided" && e.payload.id === "x");
  expect(reopen).toBeGreaterThanOrEqual(0);
  expect(decide).toBeGreaterThan(reopen);
});

// ---------- 65 ----------

function cards(ids: string[], extra: object[] = []): Project {
  const p = freshProject();
  seed(p, [
    card("root", { no_basis: "the top" }),
    kill("root"),
    ...ids.flatMap((id) => [card(id, { parent: "root" }), kill(id)]),
    ...extra,
  ]);
  return p;
}

const showHead = async (p: Project, id: string) => (await ok(p, ["show", id])).out.split("\n")[0] as string;

test("65.1", async () => {
  const p = cards(["a", "b", "c"], [dep("b", "a"), dep("c", "b")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).toContain("stale    b  Card b");
  expect(stale).toContain(`  from #a, rejected, ${day}`);
  expect(stale).not.toMatch(/ c {2}Card c/);
  const showB = (await ok(p, ["show", "b"])).out;
  // The entry for b in the stale list must name the depends_on link (show b has it in its trace).
  expect(showB).toContain("b -> a depends_on");
  const entryB = stale.split("\n").slice(stale.split("\n").findIndex((l) => l.includes("b  Card b")), stale.split("\n").findIndex((l) => l.includes("b  Card b")) + 2).join("\n");
  expect(entryB).toContain("depends_on");
  const headC = await showHead(p, "c");
  expect(headC).not.toContain("stale");
  expect(headC).not.toContain("paused");
});

test("65.2", async () => {
  const p = cards(["a", "b", "c", "d"], [dep("b", "a"), dep("c", "b"), dep("d", "c")]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) expect(await showHead(p, id)).toContain("paused");
  expect(await showHead(p, "d")).toContain("[decided]");
  const stale = (await ok(p, ["stale"])).out;
  const lines2 = stale.split("\n");
  const i = lines2.findIndex((l) => /^paused\s+d {2}Card d/.test(l));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(lines2[i + 1]).toContain("from #a, postponed");
  expect(stale).not.toMatch(/^stale /m);
  for (const id of ["a", "b", "c", "d"]) expect(await showHead(p, id)).not.toMatch(/\bstale\b/);
});

test("65.3", async () => {
  const p = freshProject();
  seed(p, [
    card("root", { no_basis: "the top" }),
    kill("root"),
    card("a", { parent: "root" }),
    kill("a"),
    card("b", { parent: "root" }),
    kill("b"),
    card("c", { parent: "b" }),
    kill("c"),
    dep("c", "a"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  const head = await showHead(p, "c");
  expect(head).toContain("stale");
  expect(head).not.toContain("paused");
  const stale = (await ok(p, ["stale"])).out.split("\n");
  const i = stale.findIndex((l) => /^stale\s+c {2}Card c/.test(l));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(stale[i + 1]).toContain("from #b, rejected");
});

test("65.4", async () => {
  const p = cards(["a", "b", "c"], [dep("b", "a"), dep("c", "a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected"]);
  let stale = (await ok(p, ["stale"])).out;
  expect(stale).toContain("stale    b  Card b");
  expect(stale).toContain("stale    c  Card c");
  await ok(p, ["rederive", "b", "--confirm", "a"]);
  stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toContain("b  Card b");
  const l = stale.split("\n");
  const i = l.findIndex((x) => /^stale\s+c {2}Card c/.test(x));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(l[i + 1]).toContain("from #a, rejected");
  expect(await showHead(p, "b")).not.toContain("stale");
});

test("65.5", async () => {
  const p = cards(["a", "b", "c"], [dep("b", "a"), dep("c", "b")]);
  const cBefore = (await showHead(p, "c")).match(/\[(\w+)\]/)?.[1];
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  for (const id of ["b", "c"]) expect(await showHead(p, id)).toContain("paused");
  await ok(p, ["status", "a", "decided"]);
  for (const id of ["b", "c"]) expect(await showHead(p, id)).not.toContain("paused");
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toContain("Card b");
  expect(stale).not.toContain("Card c");
  expect((await showHead(p, "c")).match(/\[(\w+)\]/)?.[1]).toBe(cBefore);
});

// ---------- 26 ----------

const ticket = (o: {
  title?: string;
  cites: string;
  blockedBy: string;
  stories: string;
  extra?: string;
  checks?: string;
}) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blockedBy}
stories: ${o.stories}
touches: map view, decision log

## What to build

A person opens a decided card and presses reopen.${o.extra ?? ""}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks
${o.checks ?? "\n- `make test`\n"}`;

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

function ticketProject(decided: string[], ghosts: string[] = [], stories = 2): Project {
  const p = freshProject();
  seed(p, [
    card("top", { no_basis: "the top" }),
    ...decided.map((id) => card(id, { parent: "top" })),
    ...ghosts.flatMap((id) => [
      { type: "node.proposed", payload: { id, kind: "card", title: `Ghost ${id}`, parent: "top" } },
    ]),
  ]);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: Project, root = "top", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const validTwo = {
  "01-one.md": ticket({ title: "One", cites: "top, alpha", blockedBy: "", stories: "1" }),
  "02-two.md": ticket({ title: "Two", cites: "#beta", blockedBy: "1", stories: "2", checks: "\n" }),
};

test("26.1", async () => {
  const p = ticketProject(["alpha", "beta"]);
  put(p, validTwo);
  const run = await check(p);
  const out = run.out.split("\n").filter((l) => l !== "");
  expect(out.length).toBe(1);
  expect(out.at(-1)).toMatch(/ 0 failures/);
  expect(run.code).toBe(0);
});

test("26.2", async () => {
  const p = ticketProject(["alpha", "beta"]);
  put(p, validTwo);
  expect((await check(p)).code).toBe(0);
  const first = validTwo["01-one.md"].split("\n");
  expect(first[6]).toBe("## What to build");
  // line 9 of the file is the first text line of What to build
  first[8] = "Edit src/loop.ts so the reopen runs, then the Makefile target.";
  const second = validTwo["02-two.md"].replace("presses reopen.", `presses reopen. ${"pad ".repeat(1000)}`);
  expect(second.length).toBeGreaterThan(4000);
  put(p, { "01-one.md": first.join("\n"), "02-two.md": second });
  const run = await check(p);
  const out = run.out.split("\n").filter((l) => l !== "");
  const failures = out.slice(0, -1);
  expect(
    failures.some(
      (l) =>
        l.startsWith("01-one.md:") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 9"),
    ),
  ).toBe(true);
  expect(failures.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(failures.some((l) => l.startsWith("02-two.md:") && l.includes("size"))).toBe(true);
  expect(out.at(-1)).toContain(`${failures.length} failures`);
  expect(failures.length).toBeGreaterThan(0);
  expect(run.code).toBe(1);
});

test("26.3", async () => {
  const p = ticketProject(["alpha", "beta"], ["ghosty"], 3);
  put(p, {
    "01-one.md": ticket({ title: "One", cites: "top, alpha", blockedBy: "", stories: "1" }),
    "02-two.md": ticket({ title: "Two", cites: "alpha", blockedBy: "3", stories: "2" }),
    "03-three.md": ticket({ title: "Three", cites: "top", blockedBy: "2", stories: "1, 2" }),
  });
  const run = await check(p);
  const out = run.out.split("\n");
  const cited = out.filter((l) => l.startsWith("ticket set:") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("beta");
  const stories = out.filter((l) => l.startsWith("ticket set:") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = out.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toBeDefined();
  expect(cycle).toContain("02-two.md");
  expect(cycle).toContain("03-three.md");
  expect(run.out).not.toContain("ghosty");
  expect(run.code).toBe(1);
});

test("26.4", async () => {
  const p = ticketProject(["alpha"], [], 1);
  put(p, { "01-one.md": ticket({ cites: "top, alpha", blockedBy: "", stories: "1" }) });
  const run = await check(p);
  const out = run.out.split("\n").filter((l) => l !== "");
  const own = out.filter((l) => l.startsWith("01-one.md:"));
  expect(own.some((l) => l.includes(": title:"))).toBe(true);
  expect(own.filter((l) => !l.includes(": title:"))).toEqual([]);
  expect(out.some((l) => l.startsWith("ticket set:") && l.includes("cards-cited") && l.includes("alpha"))).toBe(true);
  expect(out.some((l) => l.startsWith("ticket set:") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5", async () => {
  const p = ticketProject(["alpha", "beta"]);
  put(p, validTwo);
  const missing = await check(p, "top", "none.md");
  expect(missing.err + missing.out).toMatch(/spec file/);
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n1. A line.\n");
  expect((await check(p, "top", "bad.md")).code).toBe(2);
  expect((await check(p, "nope")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});
