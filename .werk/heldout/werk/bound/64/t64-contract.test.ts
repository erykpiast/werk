import { afterEach, beforeEach, expect, test } from "bun:test";
import { ghost, link, open, decided } from "../src/map/mark-fixtures.ts";
import { accepted, createProject, logText, type Project, seed, werk } from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  seed(p, decided("base", { title: "Base" }));
});
afterEach(() => p.dispose());
const status = async (id: string) => {
  const s = (await werk(p, "show", id)).stdout;
  return /\[(open|proto|decided)\]/.exec(s)?.[1];
};
/** Runs a printed command: the text after "werk " on the line that holds it. */
const runPrinted = async (cmd: string) => {
  const args = cmd.trim().split(/\s+/);
  return werk(p, ...args);
};

test("64.1 a card without a kill criterion stays open; the printed command fixes it", async () => {
  seed(
    p,
    open("c", { title: "C" }),
    { type: "node.edited", id: "c", who: "you" },
    link("c", "base"),
    open("c:opt0", { kind: "option", title: "Alt", why: "no" }),
    link("c:opt0", "c", "alternative_to"),
  );
  const n = p.events().length;
  const r = await werk(p, "status", "c", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/kill/);
  const printed = /werk (kill c --revisit)/.exec(r.stderr);
  expect(printed).not.toBeNull();
  expect(await status("c")).toBe("open");
  expect(p.events().length).toBe(n);
  expect((await runPrinted((printed as RegExpExecArray)[1] as string)).code).toBe(0);
  expect((await werk(p, "status", "c", "decided")).code).toBe(0);
  expect(await status("c")).toBe("decided");
});

test("64.2 each missing fact is reported with its own command", async () => {
  seed(p, open("c", { title: "C", body: "text" }));
  const r = await werk(p, "status", "c", "decided");
  expect(r.code).not.toBe(0);
  for (const word of ["who", "basis", "option", "kill"]) expect(r.stderr).toMatch(new RegExp(`${word}:`));
  expect(r.stderr).toMatch(/werk edit c --who/);
  expect(r.stderr).toMatch(/werk link c .*--type depends_on/);
  expect(r.stderr).toMatch(/werk add c:opt0 --kind option/);
  expect(r.stderr).toMatch(/werk kill c /);
  expect(await status("c")).toBe("open");
  // run each printed command, with the placeholders filled in
  expect((await werk(p, "edit", "c", "--who", "you")).code).toBe(0);
  expect((await werk(p, "link", "c", "base", "--type", "depends_on", "--why", "needs base")).code).toBe(0);
  expect((await werk(p, "add", "c:opt0", "--kind", "option", "--title", "Alt", "--why", "no")).code).toBe(0);
  expect((await werk(p, "link", "c:opt0", "c", "--type", "alternative_to")).code).toBe(0);
  expect((await werk(p, "accept", "c:opt0", "--actor", "you")).code).toBe(0);
  expect((await werk(p, "kill", "c", "--revisit")).code).toBe(0);
  expect((await werk(p, "status", "c", "decided")).code).toBe(0);
  expect(await status("c")).toBe("decided");
});

test("64.3 a ghost obeys the check through its held edges", async () => {
  seed(
    p,
    ghost("g1", { title: "G1" }),
    { type: "node.edited", id: "g1", who: "you" },
    link("g1", "base"),
    ghost("g1:opt0", { kind: "option", title: "Alt", why: "no" }),
    link("g1:opt0", "g1", "alternative_to"),
    { type: "criterion.added", id: "g1", form: "revisit" },
    ghost("g2", { title: "G2" }),
    { type: "node.edited", id: "g2", who: "you" },
    ghost("g2:opt0", { kind: "option", title: "Alt", why: "no" }),
    link("g2:opt0", "g2", "alternative_to"),
    { type: "criterion.added", id: "g2", form: "revisit" },
  );
  const a = await werk(p, "status", "g1", "decided");
  expect(a.code).toBe(0);
  expect(await status("g1")).toBe("decided");
  const b = await werk(p, "status", "g2", "decided");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/basis/);
  expect(b.stderr).toMatch(/werk link g2 .*--type depends_on/);
  expect(await status("g2")).not.toBe("decided");
});

const fullDecided = () =>
  seed(
    p,
    open("c", { title: "C", body: "Original body." }),
    { type: "node.edited", id: "c", who: "you" },
    link("c", "base"),
    open("c:opt0", { kind: "option", title: "Alt", why: "no" }),
    link("c:opt0", "c", "alternative_to"),
    { type: "criterion.added", id: "c", form: "revisit" },
    { type: "node.decided", id: "c" },
  );

test("64.4 an amend that removes a required fact is refused", async () => {
  fullDecided();
  expect(await status("c")).toBe("decided");
  const before = (await werk(p, "show", "c")).stdout;
  // No verb removes an edge. The only way the card loses its depends_on basis is to remove its target.
  const r = await werk(p, "remove", "base", "--actor", "you");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/basis/);
  expect(await status("c")).toBe("decided");
  expect((await werk(p, "show", "c")).stdout).toBe(before);
});

test("64.5 an amend that keeps every fact succeeds", async () => {
  fullDecided();
  const r1 = await werk(p, "propose", "c", "--ops", JSON.stringify([{ tag: "elaborated", old: "Original body.", new: "One short sentence." }]));
  expect(r1.code).toBe(0);
  const r2 = await werk(p, "accept", "c", "--actor", "you");
  expect(r2.code).toBe(0);
  const s = (await werk(p, "show", "c")).stdout;
  expect(s).toContain("[decided]");
  expect(s).toContain("One short sentence.");
  const types = p.events().map((e) => (e as { type: string }).type);
  expect(types.slice(-2)).toEqual(["node.reopened", "node.decided"]);
});
