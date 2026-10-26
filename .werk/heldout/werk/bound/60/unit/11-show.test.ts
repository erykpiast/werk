import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, link, open, reopen } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { werk, writeLog } from "./09-11-lib.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const quoted = (id: string, card: string, title: string, speaker: string) => ({
  type: "excerpt.quoted",
  id,
  card,
  title,
  conversation: "chat-1",
  session: "s1",
  message: 1,
  start: 0,
  end: title.length,
  speaker,
  said_at: "2026-10-10T09:00:00.000Z",
});

const rollupLines = (text: string) =>
  text.split("\n").filter((l) => l.trimStart().startsWith("rollup:"));

test("11.1 the rollup counts the card and its refines subtree", async () => {
  writeLog(project, [
    ...decided("root", { title: "Root card" }),
    ...decided("a", { title: "Child A", parent: "root" }),
    ...decided("g", { title: "Grandchild", parent: "a" }),
    ...open("b", { title: "Child B", parent: "root", status: "proto" }),
    reopen("a", { reason: "invalidated" }),
  ]);
  const r = await werk(project, "show", "root");
  expect(r.code).toBe(0);
  const own = r.stdout
    .split("\n")
    .slice(0, 4)
    .filter((l) => l.startsWith("rollup:"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("4 cards");
  expect(own[0]).toContain("1 open");
  expect(own[0]).toContain("1 proto");
  expect(own[0]).toContain("2 decided");
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  writeLog(project, [
    ...decided("parent", { title: "Parent card" }),
    ...decided("child", { title: "Child card", parent: "parent" }),
    ...open("g1", { title: "Grand open", parent: "child" }),
    ...decided("g2", { title: "Grand decided", parent: "child" }),
  ]);
  const r = await werk(project, "show", "parent");
  expect(r.code).toBe(0);
  const row = r.stdout
    .split("\n")
    .find((l) => l.includes("<-") && l.includes("refines"));
  expect(row).toBeDefined();
  expect(row).toContain("child");
  expect(row).toContain("3 cards");
  expect(row).not.toContain("4 cards");
  const own = r.stdout.split("\n").find((l) => l.startsWith("rollup:"));
  expect(own).toContain("4 cards");
});

test("11.3 a card prints its depends-on reason, options, excerpt and proposed source", async () => {
  writeLog(project, [
    ...decided("dep", { title: "Dependency card" }),
    ...open("x", { title: "The card" }),
    {
      type: "edge.added",
      from: "x",
      to: "dep",
      link: "depends_on",
      why: "needs the token API",
    },
    ...open("opt", {
      kind: "option",
      title: "Use cookies",
      why: "cookies leak across tabs",
    }),
    link("opt", "x", "alternative_to"),
    quoted("ex", "x", "we should keep it simple", "Eryk"),
    { type: "node.accepted", id: "ex", actor: "you" },
    {
      type: "node.proposed",
      id: "src",
      kind: "source",
      title: "RFC six seven four nine",
      why: "the finding of the source",
      status: "open",
    },
    { type: "edge.added", from: "x", to: "src", link: "supported_by" },
  ]);
  const r = await werk(project, "show", "x");
  expect(r.code).toBe(0);
  const out = r.stdout;
  expect(out).toContain("depends_on");
  expect(out).toContain("needs the token API");
  const optAt = out.indexOf("Options:");
  expect(optAt).toBeGreaterThan(out.indexOf("needs the token API"));
  expect(out).toContain("Use cookies");
  expect(out).toContain("why not: cookies leak across tabs");
  const say = out.indexOf("Say:");
  expect(say).toBeGreaterThan(-1);
  expect(out.slice(say)).toContain("Eryk: we should keep it simple");
  const ev = out.indexOf("Ev:");
  expect(ev).toBeGreaterThan(-1);
  const evText = out.slice(ev);
  expect(evText).toContain("RFC six seven four nine");
  expect(evText).toContain("finding: the finding of the source");
  expect(evText).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  writeLog(project, [
    ...open("x", { title: "The card" }),
    quoted("ex", "x", "plain words", "Eryk"),
    { type: "node.accepted", id: "ex", actor: "you" },
    ...open("src", { kind: "source", title: "A source", why: "found it" }),
    { type: "edge.added", from: "x", to: "src", link: "supported_by" },
  ]);
  const r = await werk(project, "show", "x");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Say:");
  expect(r.stdout).toContain("Ev:");
  expect(r.stdout).not.toContain("Options");
});

test("11.5 show with no id prints the root card and the incoming refines link with its rollup", async () => {
  writeLog(project, [
    ...open("root", { title: "The root card" }),
    ...open("second", { title: "Second card", parent: "root" }),
  ]);
  const r = await werk(project, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The root card");
  expect(r.stdout).toContain("card root");
  expect(rollupLines(r.stdout)).toHaveLength(1);
  const row = r.stdout
    .split("\n")
    .find((l) => l.includes("<-") && l.includes("refines"));
  expect(row).toContain("second");
  expect(row).toContain("rollup: 1 cards");
});
