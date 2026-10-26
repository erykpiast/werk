// Held-out steps 64.x (the contract check on a decide and an amend) and 65.x (reopen marks).
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
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
    events.map((e, i) => `${JSON.stringify({ seq: at + i + 1, at: `${day}T09:00:00Z`, actor: "you", ...e })}\n`).join(""),
  );
}
const card = (id: string, extra: object = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, ...extra },
});
const kill = (id: string) => ({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });
const dep = (from: string, to: string) => ({
  type: "edge.added",
  payload: { from, to, type: "depends_on", why: `${from} uses ${to}` },
});
const option = (id: string, of: string) => [
  { type: "node.added", payload: { id, kind: "option", title: `Option ${id}`, why_not: "It lost." } },
  { type: "edge.added", payload: { from: id, to: of, type: "alternative_to" } },
];

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

/** Splits a printed command line into words, with double quotes. */
function words(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) out.push(m[1] ?? m[2] ?? "");
  return out;
}
/** The printed fix commands of a refusal: each line that holds `werk `, with its `or:`/`then:` lead removed. */
function printed(err: string): string[][] {
  return err
    .split("\n")
    .map((l) => l.trim().replace(/^(or|then): /, ""))
    .filter((l) => l.startsWith("werk "))
    .map((l) => words(l).slice(1));
}
const header = async (p: Project, id: string) => (await ok(p, ["show", id])).out.split("\n")[0] ?? "";

// ---------- 64 ----------

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = freshProject();
  seed(p, [card("base", { status: "decided", who: "me", no_basis: "top" }), kill("base")]);
  seed(p, [card("x", { status: "open", who: "you", body: "Body." }), dep("x", "base"), ...option("x:opt0", "x")]);
  const before = lines(p);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.err + run.out;
  expect(text).toContain("kill criterion");
  expect(text).not.toContain("  who:");
  expect(text).not.toContain("  basis:");
  expect(text).not.toContain("  option:");
  const fixes = printed(text).filter((f) => f[0] === "kill" && f[1] === "x");
  expect(fixes.length).toBeGreaterThan(0);
  expect(await header(p, "x")).toContain("[open]");
  expect(lines(p)).toEqual(before);
  // The printed form with no placeholder to fill.
  const fix = fixes.find((f) => !f.some((w) => w.includes("<"))) as string[];
  expect(fix).toBeDefined();
  await ok(p, fix);
  await ok(p, ["status", "x", "decided"]);
  expect(await header(p, "x")).toContain("[decided]");
});

test("64.2 a card that lacks several facts reports each with its own command", async () => {
  const p = freshProject();
  seed(p, [card("base", { status: "decided", who: "me", no_basis: "top" }), kill("base")]);
  seed(p, [card("x", { status: "open", body: "Only a body." })]);
  const before = lines(p);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.err + run.out;
  expect(text).toContain("  who:");
  expect(text).toContain("  basis:");
  expect(text).toContain("depends_on");
  expect(text).toContain("  option:");
  expect(text).toContain("  kill criterion:");
  const fixes = printed(text);
  for (const verb of ["edit", "link", "add", "kill"]) expect(fixes.some((f) => f[0] === verb)).toBe(true);
  expect(lines(p)).toEqual(before);
  expect(await header(p, "x")).toContain("[open]");
  // Run each printed command in turn, the first form of each fact, with its placeholders filled.
  const fill = (f: string[]) =>
    f.map((w) =>
      w === "you|me|prototype"
        ? "you"
        : w === "<card>"
          ? "base"
          : w.includes("<")
            ? "filled in by the binder"
            : w,
    );
  const who = fixes.find((f) => f[0] === "edit" && f.includes("--who")) as string[];
  const link = fixes.find((f) => f[0] === "link" && f.includes("depends_on")) as string[];
  const add = fixes.find((f) => f[0] === "add") as string[];
  const linkOpt = fixes.find((f) => f[0] === "link" && f.includes("alternative_to")) as string[];
  const killFix = fixes.find((f) => f[0] === "kill" && f.includes("--metric")) as string[];
  for (const f of [who, link, add, linkOpt, killFix]) await ok(p, fill(f));
  await ok(p, ["status", "x", "decided"]);
  expect(await header(p, "x")).toContain("[decided]");
});

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = freshProject();
  seed(p, [card("base", { status: "decided", who: "me", no_basis: "top" }), kill("base")]);
  await ok(p, ["add", "g1", "--title", "Ghost one", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "g1 reads base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "Ghost two", "--who", "you"]);
  await ok(p, ["add", "g2:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(p, ["link", "g2:opt0", "g2", "--type", "alternative_to"]);
  await ok(p, ["kill", "g2", "--revisit"]);
  expect((await p.werk(["status", "g1", "decided"])).code).toBe(0);
  expect(await header(p, "g1")).toContain("[decided]");
  const before = lines(p);
  const run = await p.werk(["status", "g2", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.err + run.out;
  expect(text).toContain("  basis:");
  expect(printed(text).some((f) => f[0] === "link" && f.includes("depends_on"))).toBe(true);
  expect(await header(p, "g2")).not.toContain("[decided]");
  expect(lines(p)).toEqual(before);
});

function decidedWithFacts(): Project {
  const p = freshProject();
  seed(p, [card("base", { status: "decided", who: "me", no_basis: "top" }), kill("base")]);
  seed(p, [
    card("x", { status: "decided", who: "you", why: "The why.", body: "A long body.\n\nWith two paragraphs." }),
    dep("x", "base"),
    ...option("x:opt0", "x"),
    kill("x"),
  ]);
  return p;
}

test("64.4 an amend that removes a required fact is refused and the decided card stays the same", async () => {
  const p = decidedWithFacts();
  const shownBefore = (await ok(p, ["show", "x"])).out;
  const before = lines(p);
  const run = await p.werk(["unlink", "x", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  const text = run.err + run.out;
  expect(text).toContain("basis");
  expect(printed(text).some((f) => f[0] === "link" && f.includes("depends_on"))).toBe(true);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "x"])).out).toBe(shownBefore);
});

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = decidedWithFacts();
  await ok(p, [
    "propose",
    "x",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "A long body.", new: "Short." },
      { tag: "removed", old: "With two paragraphs." },
    ]),
  ]);
  const at = lines(p).length;
  const run = await p.werk(["accept", "x", "--actor", "you"]);
  expect(run.code).toBe(0);
  const show = (await ok(p, ["show", "x"])).out;
  expect(show.split("\n")[0]).toContain("[decided]");
  expect(show).toContain("Short.");
  expect(show).not.toContain("With two paragraphs.");
  const types = lines(p)
    .slice(at)
    .map((l) => JSON.parse(l).type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});

// ---------- 65 ----------

function chain(ids: string[], decided = true): Project {
  const p = freshProject();
  seed(p, [card("root", { status: "decided", who: "me", no_basis: "top" }), kill("root")]);
  for (const id of ids) seed(p, [card(id, { status: decided ? "decided" : "open", who: "me", parent: "root" }), kill(id)]);
  return p;
}

test("65.1 a rejected reopen marks only the next hop as stale", async () => {
  const p = chain(["a", "b", "c"]);
  seed(p, [dep("b", "a"), dep("c", "b")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).toContain("stale    b  Card b");
  expect(stale).toContain(`from #a, rejected, ${day}`);
  expect(stale).not.toMatch(/\bc  Card c/);
  const showB = (await ok(p, ["show", "b"])).out;
  expect(showB).toContain("depends_on: b uses a");
  const hc = await header(p, "c");
  expect(hc).not.toContain("stale");
  expect(hc).not.toContain("paused");
});

test("65.2 a postponed reopen pauses every downstream card and keeps their status", async () => {
  const p = chain(["a", "b", "c", "d"]);
  seed(p, [dep("b", "a"), dep("c", "b"), dep("d", "c")]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) expect(await header(p, id)).toContain("paused");
  expect(await header(p, "d")).toContain("[decided]");
  const stale = (await ok(p, ["stale"])).out;
  const at = stale.indexOf("paused   d  Card d");
  expect(at).toBeGreaterThanOrEqual(0);
  expect(stale.slice(at).split("\n")[1]).toContain("from #a, postponed");
  expect(stale).not.toMatch(/^stale /m);
  for (const id of ["a", "b", "c", "d"]) expect(await header(p, id)).not.toMatch(/\bstale\b/);
});

test("65.3 stale wins when a postponement and a rejection reach the same card", async () => {
  const p = chain(["a", "b"]);
  seed(p, [card("c", { status: "decided", who: "me", parent: "b" }), kill("c"), dep("c", "a")]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  const hc = await header(p, "c");
  expect(hc).toContain("stale");
  expect(hc).not.toContain("paused");
  const stale = (await ok(p, ["stale"])).out;
  const at = stale.indexOf("stale    c  Card c");
  expect(at).toBeGreaterThanOrEqual(0);
  expect(stale.slice(at).split("\n")[1]).toContain("from #b, rejected");
});

test("65.4 rederive clears the mark on one card and leaves the others", async () => {
  const p = chain(["a", "b", "c"]);
  seed(p, [dep("b", "a"), dep("c", "a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected"]);
  let stale = (await ok(p, ["stale"])).out;
  expect(stale).toContain("stale    b  Card b");
  expect(stale).toContain("stale    c  Card c");
  const run = await p.werk(["rederive", "b", "--confirm", "a"]);
  expect(run.err).toBe("");
  expect(run.code).toBe(0);
  stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toContain("b  Card b");
  const at = stale.indexOf("stale    c  Card c");
  expect(at).toBeGreaterThanOrEqual(0);
  expect(stale.slice(at).split("\n")[1]).toContain("from #a, rejected");
  expect(await header(p, "b")).not.toContain("stale");
});

test("65.5 deciding a postponed card again clears the paused marks downstream", async () => {
  const p = chain(["a", "b", "c"]);
  seed(p, [dep("b", "a"), dep("c", "b")]);
  const statusBefore = (await header(p, "c")).match(/\[(\w+)\]/)?.[1];
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  expect(await header(p, "b")).toContain("paused");
  expect(await header(p, "c")).toContain("paused");
  await ok(p, ["status", "a", "decided"]);
  expect(await header(p, "b")).not.toContain("paused");
  expect(await header(p, "c")).not.toContain("paused");
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toContain("Card b");
  expect(stale).not.toContain("Card c");
  expect((await header(p, "c")).match(/\[(\w+)\]/)?.[1]).toBe(statusBefore);
});
