// Held-out steps 64.x and 65.x: the decide contract check and the reopen marks, at the command line.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const T = 60_000;
const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
const seed = (p: Project, type: string, payload: object) =>
  appendFileSync(
    logOf(p),
    `${JSON.stringify({ seq: lines(p).length + 1, at: "2026-10-25T09:00:00Z", actor: "you", type, payload })}\n`,
  );
const realCard = (p: Project, id: string, extra: object = {}) =>
  seed(p, "node.added", { id, kind: "card", title: `Card ${id}`, ...extra });
const decided = (p: Project, id: string, extra: object = {}) =>
  realCard(p, id, { status: "decided", who: "me", ...extra });

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
const head = async (p: Project, id: string) => (await ok(p, ["show", id])).out.split("\n")[0] as string;

/** An open root, a decided basis card, and the card under test. */
function openRootWithBase(): Project {
  const p = freshProject();
  realCard(p, "root", { title: "Root" });
  decided(p, "base", { parent: "root", title: "Base" });
  return p;
}

// ---------- 64.x ----------

test(
  "64.1 a card that lacks a kill criterion stays open, and the printed command fixes it",
  async () => {
    const p = openRootWithBase();
    realCard(p, "q", { parent: "root", title: "Queue", body: "Jobs wait.", who: "you" });
    seed(p, "edge.added", { from: "q", to: "base", type: "depends_on", why: "Queue reads Base" });
    seed(p, "node.added", { id: "q:opt0", kind: "option", title: "A stack", why_not: "Loses order" });
    seed(p, "edge.added", { from: "q:opt0", to: "q", type: "alternative_to" });
    const before = lines(p);
    const run = await p.werk(["status", "q", "decided"]);
    expect(run.code).not.toBe(0);
    const text = run.out + run.err;
    expect(text).toContain("kill criterion");
    expect(text).not.toContain("who:");
    expect(text).not.toContain("basis:");
    expect(text).not.toContain("option:");
    const cmd = text.split("\n").find((l) => l.trim().startsWith("werk kill q --revisit") || l.includes("werk kill q"));
    expect(cmd).toBeDefined();
    expect(await head(p, "q")).toContain("[open]");
    expect(lines(p)).toEqual(before);
    // Run the printed command; take the form that needs no placeholder (--revisit).
    const revisit = text
      .split("\n")
      .map((l) => l.trim().replace(/^or: /, ""))
      .find((l) => l === "werk kill q --revisit");
    expect(revisit).toBe("werk kill q --revisit");
    await ok(p, (revisit as string).split(" ").slice(1));
    await ok(p, ["status", "q", "decided"]);
    expect(await head(p, "q")).toContain("[decided]");
  },
  T,
);

test(
  "64.2 a card that lacks several facts reports each with its own command",
  async () => {
    const p = openRootWithBase();
    realCard(p, "q", { parent: "root", title: "Queue", body: "Jobs wait." });
    const run = await p.werk(["status", "q", "decided"]);
    expect(run.code).not.toBe(0);
    const text = run.out + run.err;
    for (const fact of ["who:", "basis:", "option:", "kill criterion:"]) expect(text).toContain(fact);
    expect(text).toContain("werk edit q --who");
    expect(text).toContain("werk link q <card> --type depends_on");
    expect(text).toContain("werk add q:opt0 --kind option");
    expect(text).toContain("werk kill q");
    expect(await head(p, "q")).toContain("[open]");
    // Each printed command, with its placeholders filled in.
    await ok(p, ["edit", "q", "--who", "you"]);
    await ok(p, ["link", "q", "base", "--type", "depends_on", "--why", "Queue reads Base"]);
    await ok(p, ["add", "q:opt0", "--kind", "option", "--title", "A stack", "--why_not", "Loses order"]);
    await ok(p, ["link", "q:opt0", "q", "--type", "alternative_to"]);
    await ok(p, ["kill", "q", "--revisit"]);
    await ok(p, ["status", "q", "decided"]);
    expect(await head(p, "q")).toContain("[decided]");
  },
  T,
);

test(
  "64.3 a ghost card obeys the same check through its held edges",
  async () => {
    const p = openRootWithBase();
    await ok(p, ["add", "g1", "--title", "G1", "--parent", "root", "--who", "you"]);
    await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "G1 reads Base"]);
    await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
    await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
    await ok(p, ["kill", "g1", "--revisit"]);
    await ok(p, ["add", "g2", "--title", "G2", "--parent", "root", "--who", "you"]);
    await ok(p, ["add", "g2:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
    await ok(p, ["link", "g2:opt0", "g2", "--type", "alternative_to"]);
    await ok(p, ["kill", "g2", "--revisit"]);
    await ok(p, ["status", "g1", "decided"]);
    expect(await head(p, "g1")).toContain("[decided]");
    const run = await p.werk(["status", "g2", "decided"]);
    expect(run.code).not.toBe(0);
    const text = run.out + run.err;
    expect(text).toContain("basis:");
    expect(text).toContain("werk link g2 <card> --type depends_on");
    expect(await head(p, "g2")).not.toContain("[decided]");
  },
  T,
);

function decidedWithFacts(): Project {
  const p = openRootWithBase();
  realCard(p, "q", { parent: "root", title: "Queue", body: "Jobs wait in a queue.", who: "you" });
  seed(p, "edge.added", { from: "q", to: "base", type: "depends_on", why: "Queue reads Base" });
  seed(p, "node.added", { id: "q:opt0", kind: "option", title: "A stack", why_not: "Loses order" });
  seed(p, "edge.added", { from: "q:opt0", to: "q", type: "alternative_to" });
  seed(p, "kill.added", { id: "q", criterion: { form: "revisit" } });
  seed(p, "node.decided", { id: "q" });
  return p;
}

test(
  "64.4 an amend that removes a required fact is refused and the card stays the same",
  async () => {
    const p = decidedWithFacts();
    const shownBefore = (await ok(p, ["show", "q"])).out;
    expect(shownBefore).toContain("[decided]");
    const run = await p.werk(["unlink", "q", "base", "--type", "depends_on"]);
    expect(run.code).not.toBe(0);
    const text = run.out + run.err;
    expect(text).toContain("basis:");
    expect(text).toContain("werk link q <card> --type depends_on");
    expect((await ok(p, ["show", "q"])).out).toBe(shownBefore);
  },
  T,
);

test(
  "64.5 an amend that keeps every fact succeeds, and card text is not checked",
  async () => {
    const p = decidedWithFacts();
    const before = lines(p).length;
    await ok(p, [
      "propose",
      "q",
      "--ops",
      JSON.stringify([{ tag: "elaborated", old: "Jobs wait in a queue.", new: "Jobs queue." }]),
    ]);
    await ok(p, ["accept", "q", "--actor", "you"]);
    const shown = (await ok(p, ["show", "q"])).out;
    expect(shown).toContain("[decided]");
    expect(shown).toContain("\nJobs queue.\n");
    const types = lines(p)
      .slice(before)
      .map((l) => JSON.parse(l) as { type: string; payload: { id?: string } })
      .filter((e) => e.payload.id === "q")
      .map((e) => e.type);
    expect(types).toContain("node.reopened");
    expect(types).toContain("node.decided");
    expect(types.indexOf("node.reopened")).toBeLessThan(types.lastIndexOf("node.decided"));
  },
  T,
);

// ---------- 65.x ----------

/** A decided root, and decided cards with kill criteria so a decide again passes. */
function marksMap(cards: string[], deps: [string, string][], refines: [string, string][] = []): Project {
  const p = freshProject();
  decided(p, "root", { title: "Root" });
  const parentOf = new Map(refines);
  for (const id of cards) decided(p, id, { parent: parentOf.get(id) ?? "root", title: `Card ${id}` });
  for (const [from, to] of deps) seed(p, "edge.added", { from, to, type: "depends_on", why: `${from} uses ${to}` });
  for (const id of cards) seed(p, "kill.added", { id, criterion: { form: "revisit" } });
  return p;
}
const entries = (out: string) => {
  // stale output: "<kind>   <id>  <title>" then indented reason lines.
  const blocks: { kind: string; id: string; text: string }[] = [];
  for (const line of out.split("\n")) {
    const m = /^(stale|paused|waiting)\s+(\S+)\s/.exec(line);
    if (m) blocks.push({ kind: m[1] as string, id: m[2] as string, text: line });
    else if (blocks.length > 0) (blocks.at(-1) as { text: string }).text += `\n${line}`;
  }
  return blocks;
};

test(
  "65.1 a rejected reopen marks only the next hop as stale",
  async () => {
    const p = marksMap(
      ["A", "B", "C"],
      [
        ["B", "A"],
        ["C", "B"],
      ],
    );
    await ok(p, ["reopen", "A", "--reason", "rejected", "--why", "the storage choice is wrong"]);
    const list = entries((await ok(p, ["stale"])).out);
    const b = list.find((e) => e.id === "B");
    expect(b?.kind).toBe("stale");
    expect(b?.text).toContain("#A");
    expect(b?.text).toContain("rejected");
    const showB = (await ok(p, ["show", "B"])).out;
    expect(showB).toContain("depends_on");
    expect(showB).toContain("the storage choice is wrong");
    expect(list.find((e) => e.id === "C")).toBeUndefined();
    const hc = await head(p, "C");
    expect(hc).not.toContain("stale");
    expect(hc).not.toContain("paused");
  },
  T,
);

test(
  "65.2 a postponed reopen pauses every downstream card and keeps their status",
  async () => {
    const p = marksMap(
      ["A", "B", "C", "D"],
      [
        ["B", "A"],
        ["C", "B"],
        ["D", "C"],
      ],
    );
    await ok(p, ["reopen", "A", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
    for (const id of ["B", "C", "D"]) expect(await head(p, id)).toContain("paused");
    expect(await head(p, "D")).toContain("[decided]");
    const list = entries((await ok(p, ["stale"])).out);
    const d = list.find((e) => e.id === "D");
    expect(d?.kind).toBe("paused");
    expect(d?.text).toContain("#A");
    expect(d?.text).toContain("postponed");
    for (const id of ["A", "B", "C", "D"]) expect(await head(p, id)).not.toContain("stale");
    expect(list.some((e) => e.kind === "stale")).toBe(false);
  },
  T,
);

test(
  "65.3 stale wins when a postponement and a rejection reach the same card",
  async () => {
    const p = marksMap(["A", "B", "C"], [["C", "A"]], [["C", "B"]]);
    await ok(p, ["reopen", "A", "--reason", "postponed"]);
    await ok(p, ["reopen", "B", "--reason", "rejected"]);
    const hc = await head(p, "C");
    expect(hc).toContain("stale");
    expect(hc).not.toContain("paused");
    const c = entries((await ok(p, ["stale"])).out).filter((e) => e.id === "C");
    expect(c.length).toBeGreaterThan(0);
    expect(c[0]?.kind).toBe("stale");
    expect(c[0]?.text).toContain("#B");
    expect(c[0]?.text).toContain("rejected");
  },
  T,
);

test(
  "65.4 rederive clears the mark on one card and leaves the others",
  async () => {
    const p = marksMap(
      ["A", "B", "C"],
      [
        ["B", "A"],
        ["C", "A"],
      ],
    );
    await ok(p, ["reopen", "A", "--reason", "rejected"]);
    const before = entries((await ok(p, ["stale"])).out);
    expect(before.find((e) => e.id === "B")?.kind).toBe("stale");
    expect(before.find((e) => e.id === "C")?.kind).toBe("stale");
    await ok(p, ["rederive", "B", "--confirm", "A"]);
    const after = entries((await ok(p, ["stale"])).out);
    expect(after.find((e) => e.id === "B")).toBeUndefined();
    const c = after.find((e) => e.id === "C");
    expect(c?.kind).toBe("stale");
    expect(c?.text).toContain("#A");
    expect(c?.text).toContain("rejected");
    expect(await head(p, "B")).not.toContain("stale");
  },
  T,
);

test(
  "65.5 deciding a postponed card again clears the paused marks downstream",
  async () => {
    const p = marksMap(
      ["A", "B", "C"],
      [
        ["B", "A"],
        ["C", "B"],
      ],
    );
    const statusC = (await head(p, "C")).match(/\[(\w+)\]/)?.[1];
    await ok(p, ["reopen", "A", "--reason", "postponed"]);
    expect(await head(p, "B")).toContain("paused");
    expect(await head(p, "C")).toContain("paused");
    await ok(p, ["status", "A", "decided"]);
    expect(await head(p, "B")).not.toContain("paused");
    expect(await head(p, "C")).not.toContain("paused");
    const list = entries((await ok(p, ["stale"])).out);
    expect(list.find((e) => e.id === "B" || e.id === "C")).toBeUndefined();
    expect((await head(p, "C")).match(/\[(\w+)\]/)?.[1]).toBe(statusC);
  },
  T,
);
