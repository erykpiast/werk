import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

setDefaultTimeout(600_000);
const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const logLines = () =>
  existsLog() ? readFileSync(project.logPath, "utf8").split("\n").filter((l) => l !== "") : [];
const existsLog = () => {
  try {
    readFileSync(project.logPath);
    return true;
  } catch {
    return false;
  }
};
/** Runs a command that must succeed. */
async function ok(...args: string[]) {
  const r = await werk(...args);
  if (r.code !== 0) throw new Error(`setup: werk ${args.join(" ")} -> ${r.code}: ${r.stderr}`);
  return r;
}
const header = async (id: string) => (await werk("show", id)).stdout.split("\n")[0] ?? "";
const isGhost = (head: string) => /\bproposed\b/.test(head);
const statusOf = (head: string) => /\[(\w+)\]/.exec(head)?.[1];

/** A real decided card. A card with a basis depends on it; without one it waives the basis. */
async function decided(id: string, basis?: string, parent?: string) {
  await ok("add", id, "--title", `Card ${id}`, "--why", "w", ...(parent ? ["--parent", parent] : []));
  await ok("edit", id, "--who", "me");
  await ok("kill", id, "--revisit");
  if (basis) await ok("link", id, basis, "--type", "depends_on", "--why", "needs it");
  else if (!parent) await ok("edit", id, "--no-basis", "top of the map");
  await ok("accept", id, "--actor", "you");
  await ok("status", id, "decided");
}

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  await ok("add", "seed", "--title", "Seed");
  await ok("accept", "seed", "--actor", "you");
  const before = logLines();
  const added = await werk("add", "log", "--title", "Use a log", "--body", "Keep every event.", "--why", "It is simple.");
  expect(added.code).toBe(0);
  expect(added.stdout).toContain("proposed");
  const afterAdd = logLines();
  expect(afterAdd.length).toBe(before.length + 1);
  expect(afterAdd.slice(0, before.length)).toEqual(before);
  const shown1 = (await werk("show", "log")).stdout;
  for (const w of ["Use a log", "Keep every event.", "It is simple."]) expect(shown1).toContain(w);
  expect(isGhost(shown1.split("\n")[0] ?? "")).toBe(true);
  const acc = await werk("accept", "log", "--actor", "you");
  expect(acc.code).toBe(0);
  const afterAcc = logLines();
  expect(afterAcc.length).toBe(afterAdd.length + 1);
  expect(afterAcc.slice(0, afterAdd.length)).toEqual(afterAdd);
  const shown2 = (await werk("show", "log")).stdout;
  for (const w of ["Use a log", "Keep every event.", "It is simple."]) expect(shown2).toContain(w);
  expect(isGhost(shown2.split("\n")[0] ?? "")).toBe(false);
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  await ok("add", "log", "--title", "Use a log");
  const before = logLines();
  const refused = await werk("accept", "log");
  expect(refused.code).not.toBe(0);
  expect(logLines()).toEqual(before);
  expect(isGhost(await header("log"))).toBe(true);
  const acc = await werk("accept", "log", "--actor", "you");
  expect(acc.code).toBe(0);
  expect(isGhost(await header("log"))).toBe(false);
});

test("62.3 the words of a ghost are frozen", async () => {
  await ok("add", "log", "--title", "Use a log", "--body", "b");
  const before = logLines();
  const body = await werk("edit", "log", "--body", "A new body");
  expect(body.code).not.toBe(0);
  expect(logLines()).toEqual(before);
  const retitle = await werk("propose", "log", "--title", "Use an append-only log");
  expect(retitle.code).not.toBe(0);
  expect(logLines()).toEqual(before);
  const again = await werk("add", "log", "--title", "A different title");
  expect(again.code).not.toBe(0);
  expect(logLines()).toEqual(before);
  const shown = (await werk("show", "log")).stdout;
  expect(shown.split("\n")[1]).toBe("Use a log");
  expect(isGhost(shown.split("\n")[0] ?? "")).toBe(true);
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  await ok("add", "log", "--title", "Use a log", "--body", "Old body.");
  await ok("accept", "log", "--actor", "you");
  const before = logLines();
  const retitle = await werk("propose", "log", "--title", "Use an append-only log");
  expect(retitle.code).toBe(0);
  const after = logLines();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const shown = (await werk("show", "log")).stdout;
  expect(shown).toContain("Use an append-only log");
  expect(shown).not.toContain("Use a log");
  expect(readFileSync(project.logPath, "utf8")).toContain("Use a log");
  const body = await werk("edit", "log", "--body", "A new body.");
  expect(body.code).toBe(0);
  const shown2 = (await werk("show", "log")).stdout;
  expect(shown2).toContain("A new body.");
  expect(shown2).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  await ok("add", "root", "--title", "Root", "--why", "w");
  await ok("accept", "root", "--actor", "you");
  mkdirSync(join(project.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(project.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "we keep an append-only log" })}\n`,
  );
  const expectOne = async (args: string[]) => {
    const before = logLines();
    const r = await werk(...args);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("proposed");
    const after = logLines();
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  };
  await expectOne(["add", "opt", "--kind", "option", "--title", "Use a table", "--why", "Too slow to append."]);
  await ok("link", "opt", "root", "--type", "alternative_to");
  await expectOne(["add", "src", "--kind", "source", "--title", "Log paper", "--why", "Logs scale."]);
  await expectOne(["quote", "root", "talk", "append-only log"]);
  const optShown = (await werk("show", "opt")).stdout;
  expect(optShown).toContain("Use a table");
  expect(optShown).toContain("Too slow to append.");
  expect(isGhost(optShown.split("\n")[0] ?? "")).toBe(true);
  const srcShown = (await werk("show", "src")).stdout;
  expect(srcShown).toContain("Log paper");
  expect(srcShown).toContain("Logs scale.");
  expect(isGhost(srcShown.split("\n")[0] ?? "")).toBe(true);
  const exShown = (await werk("show", "root:ex0")).stdout;
  expect(exShown).toContain("append-only log");
  expect(exShown).toContain("person");
  expect(isGhost(exShown.split("\n")[0] ?? "")).toBe(true);
  expect((await werk("accept", "opt", "--actor", "you")).code).toBe(0);
  const optAfter = (await werk("show", "opt")).stdout;
  expect(isGhost(optAfter.split("\n")[0] ?? "")).toBe(false);
  expect(optAfter).toContain("Too slow to append.");
  expect(isGhost(await header("src"))).toBe(true);
  expect(isGhost(await header("root:ex0"))).toBe(true);
});

/** A real open card with the facts that the flags name. */
async function contractCard(
  id: string,
  facts: { who?: boolean; basis?: boolean; option?: boolean; kill?: boolean; ghost?: boolean },
) {
  await ok("add", id, "--title", `Card ${id}`, "--body", "Some text.", "--why", "w");
  if (!facts.ghost) await ok("accept", id, "--actor", "you");
  if (facts.who) await ok("edit", id, "--who", "you");
  if (facts.basis) await ok("link", id, "base", "--type", "depends_on", "--why", "needs the base");
  if (facts.option) {
    await ok("add", `${id}:opt0`, "--kind", "option", "--title", "Alternative", "--why", "Too slow");
    await ok("link", `${id}:opt0`, id, "--type", "alternative_to");
    if (!facts.ghost) await ok("accept", `${id}:opt0`, "--actor", "you");
  }
  if (facts.kill) await ok("kill", id, "--revisit");
}

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  await decided("base");
  await contractCard("c", { who: true, basis: true, option: true });
  const before = logLines();
  const r = await werk("status", "c", "decided");
  expect(r.code).not.toBe(0);
  const out = r.stdout + r.stderr;
  expect(out).toMatch(/kill/i);
  const printed = /werk (kill c --revisit)/.exec(out);
  expect(printed).not.toBeNull();
  expect(statusOf(await header("c"))).toBe("open");
  expect(logLines()).toEqual(before);
  const fix = await werk(...((printed as RegExpExecArray)[1] as string).split(" "));
  expect(fix.code).toBe(0);
  const again = await werk("status", "c", "decided");
  expect(again.code).toBe(0);
  expect(statusOf(await header("c"))).toBe("decided");
});

test("64.2 a card that lacks several facts reports each missing fact with its own command", async () => {
  await decided("base");
  await contractCard("c", {});
  const before = logLines();
  const r = await werk("status", "c", "decided");
  expect(r.code).not.toBe(0);
  const out = r.stdout + r.stderr;
  for (const fact of ["who", "basis", "option", "kill"]) expect(out).toContain(`${fact}:`);
  for (const cmd of ["werk edit c --who", "werk link c", "werk add c:opt0 --kind option", "werk kill c"]) {
    expect(out).toContain(cmd);
  }
  expect(statusOf(await header("c"))).toBe("open");
  expect(logLines()).toEqual(before);
  // The printed commands hold placeholders; fill each one in and run it.
  await ok("edit", "c", "--who", "you");
  await ok("link", "c", "base", "--type", "depends_on", "--why", "needs the base");
  await ok("add", "c:opt0", "--kind", "option", "--title", "Alternative", "--why", "Too slow");
  await ok("link", "c:opt0", "c", "--type", "alternative_to");
  await ok("accept", "c:opt0", "--actor", "you");
  await ok("kill", "c", "--revisit");
  const again = await werk("status", "c", "decided");
  expect(again.code).toBe(0);
  expect(statusOf(await header("c"))).toBe("decided");
});

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  await decided("base");
  await contractCard("g1", { who: true, basis: true, option: true, kill: true, ghost: true });
  await contractCard("g2", { who: true, option: true, kill: true, ghost: true });
  expect(isGhost(await header("g1"))).toBe(true);
  expect(isGhost(await header("g2"))).toBe(true);
  const first = await werk("status", "g1", "decided");
  expect(first.code).toBe(0);
  expect(statusOf(await header("g1"))).toBe("decided");
  const before = logLines();
  const second = await werk("status", "g2", "decided");
  expect(second.code).not.toBe(0);
  const out = second.stdout + second.stderr;
  expect(out).toContain("basis");
  expect(out).toContain("werk link g2");
  expect(out).toContain("depends_on");
  expect(statusOf(await header("g2"))).not.toBe("decided");
  expect(logLines()).toEqual(before);
});

async function fullDecided() {
  await decided("base");
  await contractCard("c", { who: true, basis: true, option: true, kill: true });
  await ok("status", "c", "decided");
}

test("64.4 an amend that removes a required fact is refused and the decided card stays the same", async () => {
  await fullDecided();
  const beforeShow = (await werk("show", "c")).stdout;
  const before = logLines();
  // No verb removes an edge from a card. The one amend verb is rederive --amend.
  const r = await werk("rederive", "c", "--amend", "the card no longer depends on base");
  expect(r.code).not.toBe(0);
  const out = r.stdout + r.stderr;
  expect(out).toContain("basis");
  expect(out).toContain("werk link c");
  expect(statusOf(await header("c"))).toBe("decided");
  expect((await werk("show", "c")).stdout).toBe(beforeShow);
  expect(logLines()).toEqual(before);
});

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  await fullDecided();
  const before = logLines();
  const p = await werk("propose", "c", "--ops", JSON.stringify([{ tag: "elaborated", old: "Some text.", new: "One short sentence." }]));
  expect(p.code).toBe(0);
  const a = await werk("accept", "c", "--actor", "you");
  expect(a.code).toBe(0);
  const shown = (await werk("show", "c")).stdout;
  expect(statusOf(shown.split("\n")[0] ?? "")).toBe("decided");
  expect(shown).toContain("One short sentence.");
  const added = logLines().slice(before.length).map((l) => JSON.parse(l).type);
  expect(added).toContain("node.reopened");
  expect(added).toContain("node.decided");
});

// Section 65.
const staleOut = async (...extra: string[]) => (await ok("stale", ...extra)).stdout;

test("65.1 a rejected reopen marks only the next hop as stale", async () => {
  await decided("a");
  await decided("b", "a");
  await decided("c", "b");
  await ok("reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong");
  const list = await staleOut();
  expect(list).toContain("stale");
  expect(list).toMatch(/\bb\b/);
  expect(list).not.toMatch(/\bc\b {2}/);
  const entry = list.slice(list.indexOf("b "));
  expect(entry).toContain("#a");
  expect(entry).toContain("depends_on");
  expect(entry).toContain("rejected");
  const c = (await werk("show", "c")).stdout;
  expect(c).not.toMatch(/STALE|PAUSED|paused|stale/);
});

test("65.2 a postponed reopen pauses every downstream card and keeps their status", async () => {
  await decided("a");
  await decided("b", "a");
  await decided("c", "b");
  await decided("d", "c");
  await ok("reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter");
  for (const id of ["b", "c", "d"]) {
    expect((await werk("show", id)).stdout).toMatch(/paused|PAUSED/);
  }
  expect(statusOf(await header("d"))).toBe("decided");
  const list = await staleOut();
  const dEntry = list.slice(list.search(/^paused +d\b/m));
  expect(list).toMatch(/^paused +d\b/m);
  expect(dEntry).toContain("#a");
  expect(dEntry).toContain("postponed");
  expect(await staleOut("--kind", "stale")).not.toMatch(/\S/);
  for (const id of ["b", "c", "d"]) {
    expect((await werk("show", id)).stdout).not.toMatch(/STALE/);
  }
});

test("65.3 stale wins when a postponement and a rejection reach the same card", async () => {
  await decided("a");
  await decided("b");
  await ok("add", "c", "--title", "Card c", "--why", "w", "--parent", "b");
  await ok("edit", "c", "--who", "me");
  await ok("kill", "c", "--revisit");
  await ok("link", "c", "a", "--type", "depends_on", "--why", "needs a");
  await ok("accept", "c", "--actor", "you");
  await ok("status", "c", "decided");
  await ok("reopen", "a", "--reason", "postponed");
  await ok("reopen", "b", "--reason", "rejected");
  const list = await staleOut();
  expect(list).toMatch(/^stale +c\b/m);
  expect(list).not.toMatch(/^paused +c\b/m);
  const entry = list.slice(list.search(/^stale +c\b/m));
  expect(entry).toContain("#b");
  expect(entry).toContain("rejected");
});

test("65.4 rederive clears the mark on one card and leaves the others", async () => {
  await decided("a");
  await decided("b", "a");
  await decided("c", "a");
  await ok("reopen", "a", "--reason", "rejected");
  const list = await staleOut();
  expect(list).toMatch(/^stale +b\b/m);
  expect(list).toMatch(/^stale +c\b/m);
  const r = await werk("rederive", "b", "--confirm", "all");
  expect(r.code).toBe(0);
  const after = await staleOut();
  expect(after).not.toMatch(/^stale +b\b/m);
  const cEntry = after.slice(after.search(/^stale +c\b/m));
  expect(after).toMatch(/^stale +c\b/m);
  expect(cEntry).toContain("#a");
  expect(cEntry).toContain("rejected");
  expect((await werk("show", "b")).stdout).not.toMatch(/STALE/);
});

test("65.5 deciding a postponed card again clears the paused marks downstream", async () => {
  await decided("a");
  await decided("b", "a");
  await decided("c", "b");
  await ok("reopen", "a", "--reason", "postponed");
  expect((await werk("show", "b")).stdout).toMatch(/paused|PAUSED/);
  expect((await werk("show", "c")).stdout).toMatch(/paused|PAUSED/);
  expect((await werk("status", "a", "decided")).code).toBe(0);
  expect((await werk("show", "b")).stdout).not.toMatch(/paused|PAUSED/);
  expect((await werk("show", "c")).stdout).not.toMatch(/paused|PAUSED/);
  const list = await staleOut();
  expect(list).not.toMatch(/^\S+ +[bc]\b/m);
  expect(statusOf(await header("c"))).toBe("decided");
});
