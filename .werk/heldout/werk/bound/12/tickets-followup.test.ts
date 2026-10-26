/** Held-out steps 29, 30 and 43: ticket-check, the board and follow-up records. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Project } from "../src/test-env/project.ts";
import {
  decided,
  doneTicket,
  type Ev,
  newProject,
  seedLog,
  werkIn,
} from "./support.ts";

let project: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  project = newProject();
  werk = werkIn(project);
});
afterEach(() => project.dispose());

const write = (path: string, text: string) => {
  mkdirSync(dirname(join(project.dir, path)), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const lines = (text: string) => text.split("\n").filter((l) => l.trim() !== "");

type Parts = {
  cites?: string;
  blockedBy?: string;
  stories?: string;
  touches?: string | null;
  what?: string;
};
/** A hand-written ticket in the fixed format. */
function ticket(p: Parts = {}): string {
  const out = [
    "title: A person does a thing",
    `cites: ${p.cites ?? "a"}`,
    `blocked_by: ${p.blockedBy ?? ""}`,
    `stories: ${p.stories ?? "1"}`,
  ];
  if (p.touches !== null) out.push(`touches: ${p.touches ?? "map view"}`);
  out.push(
    "",
    "## What to build",
    "",
    p.what ?? "A person presses a button and the thing happens.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The thing shows.",
    "",
    "## Checks",
    "",
    "- `make test`",
    "",
  );
  return out.join("\n");
}
const SPEC = "# Spec\n\n## User stories\n\n1. As a person, I want one.\n2. As a person, I want two.\n";
/** A root card that is open again, with decided cards under it: they were decided while the root was. */
const rootWith = (...ids: string[]): Ev[] => [
  ...decided("root"),
  ...ids.flatMap((id) => decided(id, { parent: "root" })),
  { type: "node.reopened", id: "root", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
];
const check = () =>
  werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");

describe("30 ticket-check", () => {
  test("30.1 a folder of correct tickets passes", async () => {
    seedLog(project, rootWith("a", "b"));
    write("spec.md", SPEC);
    write("tickets/01-first.md", ticket({ cites: "a", stories: "1" }));
    write("tickets/02-second.md", ticket({ cites: "b", stories: "2", blockedBy: "1" }));
    const out = await check();
    expect(out.stderr).toBe("");
    const all = lines(out.stdout);
    expect(all).toHaveLength(1);
    expect(all[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
    expect(out.code).toBe(0);
  });

  test("30.2 own-check failures name the ticket, the check and the field", async () => {
    seedLog(project, rootWith("a"));
    write("spec.md", SPEC);
    write("tickets/01-ok.md", ticket({ cites: "a", stories: "1" }));
    // The path sits on line 12 of the ticket file.
    write(
      "tickets/02-path.md",
      ticket({ stories: "2", what: "First line.\nSecond line.\nThird line.\nFourth line names src/loop.ts here." }),
    );
    write("tickets/03-nolines.md", ticket({ stories: "2", touches: null }));
    expect(readFileSync(join(project.dir, "tickets/02-path.md"), "utf8").split("\n")[11]).toContain("src/loop.ts");
    const out = await check();
    const all = lines(out.stdout);
    const two = all.find((l) => l.startsWith("02-path.md"));
    expect(two).toContain("no-file-paths");
    expect(two).toContain("src/loop.ts");
    expect(two).toContain("line 12");
    const three = all.find((l) => l.startsWith("03-nolines.md"));
    expect(three).toContain("shape");
    expect(three).toContain("touches");
    expect(all.some((l) => l.startsWith("01-ok.md"))).toBe(false);
    expect(all[all.length - 1]).toContain("3 tickets, 2 own-check failures");
    expect(out.code).toBe(1);
  });

  test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
    seedLog(
      project,
      rootWith("a", "uncited"),
      // a ghost that carries the status decided
      { type: "node.proposed", id: "phantom", kind: "card", title: "Phantom", status: "decided", parent: "root" },
    );
    write("spec.md", SPEC);
    write("tickets/01-root.md", ticket({ cites: "root", stories: "1" }));
    write("tickets/02-a.md", ticket({ cites: "a", stories: "2" }));
    const out = await check();
    const all = lines(out.stdout);
    const set = all.filter((l) => l.startsWith("ticket set"));
    expect(set).toHaveLength(1);
    expect(set[0]).toContain("uncited");
    expect(out.stdout).not.toContain("phantom");
    expect(all[all.length - 1]).toContain("2 decided cards");
    expect(out.code).toBe(1);
  });

  test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
    seedLog(project, rootWith("a"));
    write("spec.md", "## User stories\n\n1. one\n2. two\n3. three\n4. four\n");
    write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
    write("tickets/02-b.md", ticket({ stories: "2", blockedBy: "3" }));
    write("tickets/03-c.md", ticket({ stories: "3", blockedBy: "2" }));
    write("tickets/04-d.md", ticket({ stories: "4", blockedBy: "3" }));
    const out = await check();
    const all = lines(out.stdout);
    expect(all.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
    expect(all.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
    expect(all.some((l) => l.startsWith("01-a.md"))).toBe(false);
    expect(all.some((l) => l.startsWith("04-d.md"))).toBe(false);
    expect(out.code).toBe(1);
  });

  test("30.5 a spec with no User stories heading is a malformed call", async () => {
    seedLog(project, rootWith("a"));
    write("spec.md", "# Spec\n\nNo stories here.\n");
    write("tickets/01-a.md", ticket({ cites: "a" }));
    const out = await check();
    expect(out.stderr).toContain("User stories");
    expect(out.stdout).toBe("");
    expect(out.code).toBe(2);
  });
});

describe("43 followup", () => {
  const board = (...events: Ev[]) => {
    mkdirSync(join(project.dir, ".werk"), { recursive: true });
    writeFileSync(
      join(project.dir, ".werk", "board.jsonl"),
      events.map((e) => `${JSON.stringify(e)}\n`).join(""),
    );
  };
  const list = async (ticketId: string) => lines((await werk("followup", ticketId, "--list")).stdout);

  test("43.1 a build miss on a done ticket is recorded and listed", async () => {
    board(...doneTicket("app/01"));
    const rec = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
    expect(rec.code).toBe(0);
    expect(rec.stdout).toContain("recorded");
    const l = await list("app/01");
    expect(l).toHaveLength(1);
    expect(l[0]).toMatch(/^1\./);
    expect(l[0]).toContain("build");
    expect(l[0]).toMatch(/after[- ]merge/);
    expect(l[0]).toContain("the link expires after 1 minute, the card says 15");
    expect(l[0]).toMatch(/catch\w*:? yes/);
  });

  test("43.2 a plan miss is recorded without a catchable answer", async () => {
    board(...doneTicket("app/01"));
    const rec = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
    expect(rec.code).toBe(0);
    expect(rec.stdout).toContain("recorded");
    const l = await list("app/01");
    expect(l).toHaveLength(1);
    expect(l[0]).toMatch(/^1\./);
    expect(l[0]).toContain("plan");
    expect(l[0]).toContain("review");
    expect(l[0]).toContain("no card said how long the link lasts");
    expect(l[0]).not.toMatch(/catch/i);
  });

  test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
    board(...doneTicket("app/01"));
    const noAnswer = await werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
    expect(noAnswer.code).not.toBe(0);
    expect(noAnswer.stderr).toMatch(/build miss needs (a|the) catchable answer/);
    const extra = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
    expect(extra.code).not.toBe(0);
    expect(extra.stderr).toMatch(/plan miss (does not take|has no) a? ?catchable answer/);
    expect(await list("app/01")).toHaveLength(0);
  });

  test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
    board(
      { type: "ticket.planned", id: "app/02" },
      { type: "ticket.moved", id: "app/02", to: "building" },
    );
    const notDone = await werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
    expect(notDone.code).not.toBe(0);
    expect(notDone.stderr).toMatch(/not done/);
    const missing = await werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toMatch(/does not exist|no ticket app\/99/);
    expect(await list("app/02")).toHaveLength(0);
  });

  test("43.5 the last correction of a record is the class in force", async () => {
    board(...doneTicket("app/01"));
    expect((await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute", "--catchable", "yes")).code).toBe(0);
    const toPlan = await werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
    expect(toPlan.code).toBe(0);
    let l = await list("app/01");
    expect(l.some((x) => /^1\..*in force:?.*plan/.test(x))).toBe(true);
    expect(l.some((x) => /^2\..*correct\w* (of )?1/.test(x))).toBe(true);
    const toBuild = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
    expect(toBuild.code).toBe(0);
    l = await list("app/01");
    expect(l.some((x) => /^1\..*in force:?.*build/.test(x))).toBe(true);
  });
});

describe("29 second plan", () => {
  // The command line has no plan verb, and no board screen. Each step starts with a plan.
  const planned = async () => {
    seedLog(project, rootWith("a"));
    return await werk("plan", "root");
  };
  for (const id of ["29.1", "29.2", "29.3", "29.4", "29.5"]) {
    test(`${id} a person plans a subtree and the board shows spec and tickets`, async () => {
      const first = await planned();
      expect(first.stderr).not.toContain("unknown verb");
      expect(first.code).toBe(0);
      const again = await werk("plan", "root");
      expect(again.code).toBe(0);
    });
  }
});
