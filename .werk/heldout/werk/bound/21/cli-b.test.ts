import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import {
  createProject,
  decided,
  ghost,
  link,
  open,
  type Project,
  refines,
  werkIn,
  writeLog,
} from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const put = (path: string, text: string) => {
  mkdirSync(join(p.dir, path, ".."), { recursive: true });
  writeFileSync(join(p.dir, path), text);
};
const chat = (name: string, ...lines: unknown[]) =>
  put(
    `.werk/chats/${name}.jsonl`,
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
  );

describe("11 show rollup", () => {
  test("11.1 rollup counts the subtree", async () => {
    writeLog(p, [
      ...decided("root"),
      ...open("c1"),
      refines("c1", "root"),
      ...open("c2", { status: "proto" }),
      refines("c2", "root"),
      ...decided("g"),
      refines("g", "c1"),
    ]);
    const out = (await werkIn(p)("show", "root")).stdout;
    expect(out).toMatch(/4 cards/);
    expect(out).toMatch(/1 open/);
    expect(out).toMatch(/1 proto/);
    expect(out).toMatch(/2 decided/);
  });
  test("11.2 each incoming refines link shows the child's rollup", async () => {
    writeLog(p, [
      ...open("parent"),
      ...open("child"),
      refines("child", "parent"),
      ...open("g1"),
      refines("g1", "child"),
      ...decided("g2"),
      refines("g2", "child"),
    ]);
    const out = (await werkIn(p)("show", "parent")).stdout;
    expect(out).toMatch(/4 cards/);
    const row = out.split("\n").find((l) => l.includes("<- refines"));
    expect(row).toBeDefined();
    expect(`${row}\n${out.split(row ?? "")[1]?.split("\n")[1]}`).toMatch(
      /3 cards/,
    );
  });
  test("11.3 options, excerpts and a proposed source print", async () => {
    writeLog(p, [
      ...open("a"),
      ...open("b"),
      link("a", "b", "depends_on"),
      ...open("a:opt", { kind: "option", title: "Use SQLite", why: "native build" }),
      link("a:opt", "a", "alternative_to"),
      ghost("src", { kind: "source", title: "RFC 6749", body: "finding text" }),
      link("a", "src", "supported_by"),
    ]);
    chat("c", {
      speaker: "person",
      at: "10:02",
      session: "s1",
      kind: "spoken",
      text: "exact words here",
    });
    const w = werkIn(p);
    await w("quote", "a", "c", "exact words here");
    await w("accept", "a:ex0", "--actor", "you");
    const out = (await w("show", "a")).stdout;
    expect(out).toContain("Options");
    expect(out).toContain("Use SQLite");
    expect(out).toContain("native build");
    expect(out).toMatch(/Say/);
    expect(out).toContain("exact words here");
    expect(out).toMatch(/Ev/);
    expect(out).toContain("RFC 6749");
    expect(out).toContain("finding text");
    expect(out).toContain("proposed");
  });
  test("11.4 no options, no Options section", async () => {
    writeLog(p, [...open("a"), ghost("src", { kind: "source", title: "S" }), link("a", "src", "supported_by")]);
    chat("c", { speaker: "person", at: "1", session: "s", kind: "spoken", text: "words" });
    const w = werkIn(p);
    await w("quote", "a", "c", "words");
    const out = (await w("show", "a")).stdout;
    expect(out).toMatch(/Say/);
    expect(out).toMatch(/Ev/);
    expect(out).not.toContain("Options");
  });
  test("11.5 show with no id prints the root", async () => {
    writeLog(p, [...open("root", { title: "Root card" }), ...open("kid", { title: "Kid" }), refines("kid", "root")]);
    const r = await werkIn(p)("show");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Root card");
    expect(r.stdout).toMatch(/2 cards/);
    expect(r.stdout).toMatch(/<- refines\s+kid/);
  });
});

describe("30 ticket-check", () => {
  const spec = "## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
  const check = (...extra: string[]) =>
    werkIn(p)("ticket-check", "tickets", "--root", "root", "--spec", "spec.md", ...extra);
  const cardsMap = (...ids: string[]) => [
    ...open("root"),
    ...ids.flatMap((id) => [...decided(id), refines(id, "root")]),
  ];
  test("30.1 a folder of correct tickets passes", async () => {
    writeLog(p, cardsMap("c1", "c2"));
    put("spec.md", spec);
    put("tickets/01-a.md", ticket({ cites: "c1", stories: "1", blockedBy: "" }));
    put("tickets/02-b.md", ticket({ cites: "c2", stories: "2", blockedBy: "1", title: "Another" }));
    const r = await check();
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/2 tickets/);
    expect(lines[0]).toMatch(/0 own-check failures/);
    expect(lines[0]).toMatch(/0 failures/);
    expect(lines[0]).toMatch(/2 decided cards/);
    expect(lines[0]).toMatch(/2 stories/);
    expect(r.code).toBe(0);
  });
  test("30.2 own-check failures name ticket, check and field", async () => {
    writeLog(p, cardsMap("c1", "c2"));
    put("spec.md", spec);
    const filler = "Line.\n".repeat(0);
    put("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    // 12th line of the body: put the path on line 12 of the file
    const t2 = ticket({ cites: "c2", stories: "2", title: "Two" }).split("\n");
    t2.splice(11, 0, "Edit src/loop.ts here.");
    put("tickets/02-b.md", t2.join("\n") + filler);
    put("tickets/03-c.md", ticket({ cites: "", stories: "1", touches: null, title: "Three" }));
    const r = await check();
    expect(r.stdout).toMatch(/02-b\.md: .*no-file-paths.*src\/loop\.ts.*line 12/);
    expect(r.stdout).toMatch(/03-c\.md: shape: touches/);
    expect(r.stdout).not.toMatch(/01-a\.md:/);
    const last = r.stdout.trim().split("\n").pop() ?? "";
    expect(last).toMatch(/3 tickets/);
    expect(last).toMatch(/2 own-check failures/);
    expect(r.code).toBe(1);
  });
  test("30.3 an uncited decided card fails the set; a ghost does not count", async () => {
    writeLog(p, [
      ...open("root"),
      ...decided("c1"),
      refines("c1", "root"),
      ...decided("c2"),
      refines("c2", "root"),
      ghost("gh", { parent: "root" }),
      { type: "node.edited", id: "gh", who: "me", noBasis: "t" },
      { type: "criterion.added", id: "gh", form: "revisit" },
      { type: "node.decided", id: "gh" },
    ]);
    put("spec.md", spec);
    put("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
    put("tickets/02-b.md", ticket({ cites: "c1", stories: "2", title: "Two" }));
    const r = await check();
    const set = r.stdout.split("\n").filter((l) => l.startsWith("ticket set"));
    expect(set).toHaveLength(1);
    expect(set[0]).toContain("c2");
    expect(r.stdout).not.toContain("gh");
    expect(r.stdout.trim().split("\n").pop()).toMatch(/2 decided cards/);
    expect(r.code).toBe(1);
  });
  test("30.4 a cycle names only the tickets on it", async () => {
    writeLog(p, cardsMap("c1", "c2", "c3", "c4"));
    put("spec.md", "## User stories\n\n1. a\n");
    put("tickets/01-a.md", ticket({ cites: "root", stories: "1", title: "A1" }));
    put("tickets/02-b.md", ticket({ cites: "c1,c2", blockedBy: "3", stories: "1", title: "A2" }));
    put("tickets/03-c.md", ticket({ cites: "c3", blockedBy: "2", stories: "1", title: "A3" }));
    put("tickets/04-d.md", ticket({ cites: "c4", blockedBy: "3", stories: "1", title: "A4" }));
    const r = await check();
    const lines = r.stdout.split("\n");
    expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
    expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
    expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
    expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
    expect(r.code).toBe(1);
  });
  test("30.5 a spec with no User stories heading is a malformed call", async () => {
    writeLog(p, cardsMap("c1"));
    put("spec.md", "# Spec\n\nnothing\n");
    put("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    const r = await check();
    expect(r.stderr).toContain("User stories");
    expect(r.stdout.trim()).toBe("");
    expect(r.code).toBe(2);
  });
});

describe("43 followup", () => {
  const done = (id: string) => [
    { type: "ticket.planned", id },
    { type: "ticket.moved", id, to: "building" },
    { type: "ticket.moved", id, to: "merging", actor: "loop" },
    { type: "ticket.merge", id },
  ];
  const seed = (...events: unknown[]) =>
    put(".werk/board.jsonl", events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  const f = (...a: string[]) => werkIn(p)("followup", ...a);
  test("43.1 build miss recorded and listed", async () => {
    seed(...done("app/01"));
    const r = await f("app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("recorded");
    const l = (await f("app/01", "--list")).stdout;
    expect(l).toContain("1");
    expect(l).toContain("build");
    expect(l).toContain("after-merge");
    expect(l).toContain("the link expires after 1 minute, the card says 15");
    expect(l).toMatch(/could catch: yes/);
    expect(l).toMatch(/yes/);
  });
  test("43.2 plan miss without catchable", async () => {
    seed(...done("app/01"));
    const r = await f("app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("recorded");
    const l = (await f("app/01", "--list")).stdout;
    expect(l).toContain("plan");
    expect(l).toContain("review");
    expect(l).toContain("no card said how long the link lasts");
    expect(l).not.toContain("catchable");
  });
  test("43.3 wrong catchable answers are refused", async () => {
    seed(...done("app/01"));
    const a = await f("app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toMatch(/build miss needs.*catchable/);
    const b = await f("app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toMatch(/plan miss has no catchable/);
    expect((await f("app/01", "--list")).stdout.trim()).toBe("");
  });
  test("43.4 a ticket not done, or missing, is refused", async () => {
    seed(...done("app/01"), { type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
    const a = await f("app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toMatch(/not done/);
    const b = await f("app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toMatch(/does not exist|no ticket/);
    expect((await f("app/02", "--list")).stdout.trim()).toBe("");
  });
  test("43.5 the last correction is the class in force", async () => {
    seed(...done("app/01"));
    await f("app/01", "--class", "build", "--found", "after-merge", "--why", "x", "--catchable", "yes");
    await f("app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
    const l1 = (await f("app/01", "--list")).stdout;
    expect(l1).toMatch(/1.*plan/);
    expect(l1).toMatch(/correction of 1/);
    await f("app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
    const l2 = (await f("app/01", "--list")).stdout;
    expect(l2).toMatch(/1.*build/);
  });
});
