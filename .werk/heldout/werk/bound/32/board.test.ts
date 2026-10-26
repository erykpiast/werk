import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  boardText,
  createProject,
  type Project,
  planned,
  seedBoard,
  werkIn,
} from "./cli-support.ts";

let project: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  project = createProject();
  werk = werkIn(project);
});
afterEach(() => project.dispose());

const doneTicket = (id: string) => [
  planned(id),
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging" },
  { type: "ticket.merge", id },
];

describe("27 ticket move, archive, restore, list", () => {
  test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
    seedBoard(project, [planned("auth/01")]);
    const moved = await werk(
      "ticket",
      "move",
      "auth/01",
      "blocked",
      "--reason",
      "waits for the token API",
    );
    expect(moved.code).toBe(0);
    const archived = await werk("ticket", "archive", "auth/01");
    expect(archived.code).toBe(0);
    const list = await werk("ticket", "list");
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("archived");
    expect(list.stdout).toContain("blocked");
    expect(list.stdout).toContain("waits for the token API");
    const before = boardText(project).trim().split("\n").length;
    const restored = await werk("ticket", "restore", "01", "--actor", "you");
    expect(restored.code).toBe(0);
    const lines = boardText(project).trim().split("\n");
    expect(lines).toHaveLength(before + 1);
    expect(JSON.parse(lines.at(-1) as string)).toMatchObject({
      type: "ticket.restored",
      actor: "you",
    });
    const after = await werk("ticket", "list");
    expect(after.stdout).toContain("blocked");
    expect(after.stdout).toContain("waits for the token API");
  });

  test("27.2 a move without a reason is refused", async () => {
    seedBoard(project, [planned("auth/01")]);
    const before = boardText(project);
    const result = await werk("ticket", "move", "auth/01", "blocked");
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("reason");
    const list = await werk("ticket", "list");
    expect(list.stdout).toContain("ready");
    expect(boardText(project)).toBe(before);
  });

  test("27.3 restoring a ticket that is not archived changes nothing", async () => {
    seedBoard(project, [planned("auth/02")]);
    const before = boardText(project);
    const a = await werk("ticket", "restore", "02");
    expect(a.code).toBe(1);
    expect(boardText(project)).toBe(before);
    const b = await werk("ticket", "restore", "99");
    expect(b.code).toBe(1);
    expect(boardText(project)).toBe(before);
  });

  test("27.4 a done ticket cannot be archived", async () => {
    seedBoard(project, doneTicket("auth/03"));
    const before = boardText(project);
    const result = await werk("ticket", "archive", "auth/03");
    expect(result.code).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("done");
    const list = await werk("ticket", "list");
    expect(list.stdout).toContain("done");
    expect(list.stdout).not.toContain("archived");
    expect(boardText(project)).toBe(before);
  });

  test("27.5 the board listing shows every ticket in the column its events lead to", async () => {
    seedBoard(project, [
      planned("auth/01"),
      planned("auth/02"),
      planned("auth/03"),
    ]);
    expect(
      (
        await werk(
          "ticket",
          "move",
          "auth/02",
          "blocked",
          "--reason",
          "why not",
        )
      ).code,
    ).toBe(0);
    expect((await werk("ticket", "archive", "auth/03")).code).toBe(0);
    const list = await werk("ticket", "list");
    expect(list.code).toBe(0);
    expect(list.stdout).toMatch(/auth\/01.*ready/);
    expect(list.stdout).toMatch(/auth\/02.*blocked.*why not/);
    expect(list.stdout).toMatch(/auth\/03.*archived/);
    for (const line of boardText(project).trim().split("\n"))
      expect(JSON.parse(line).actor).toBeTruthy();
  });
});

describe("43 followup", () => {
  const list = async (t: string) =>
    (await werk("followup", t, "--list")).stdout;

  test("43.1 a build miss on a done ticket is recorded and listed", async () => {
    seedBoard(project, doneTicket("app/01"));
    const r = await werk(
      "followup",
      "app/01",
      "--class",
      "build",
      "--found",
      "after-merge",
      "--why",
      "the link expires after 1 minute, the card says 15",
      "--catchable",
      "yes",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("recorded");
    const out = await list("app/01");
    expect(out).toMatch(/^1\. /);
    expect(out).toContain("build");
    expect(out).toMatch(/after.merge/);
    expect(out).toContain("the link expires after 1 minute, the card says 15");
    expect(out).toMatch(/catch\w*: yes/);
  });

  test("43.2 a plan miss is recorded without a catchable answer", async () => {
    seedBoard(project, doneTicket("app/01"));
    const r = await werk(
      "followup",
      "app/01",
      "--class",
      "plan",
      "--found",
      "review",
      "--why",
      "no card said how long the link lasts",
    );
    expect(r.stdout).toContain("recorded");
    const out = await list("app/01");
    expect(out).toMatch(/^1\. plan miss, found review/);
    expect(out).toContain("no card said how long the link lasts");
    expect(out).not.toContain("catch");
  });

  test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
    seedBoard(project, doneTicket("app/01"));
    const a = await werk(
      "followup",
      "app/01",
      "--class",
      "build",
      "--found",
      "review",
      "--why",
      "the button label is wrong",
    );
    expect(a.code).not.toBe(0);
    expect(a.stderr).toContain("a build miss needs");
    expect(a.stderr).toContain("catchable");
    const b = await werk(
      "followup",
      "app/01",
      "--class",
      "plan",
      "--found",
      "review",
      "--why",
      "the card was silent",
      "--catchable",
      "no",
    );
    expect(b.code).not.toBe(0);
    expect(b.stderr).toContain("a plan miss has no catchable answer");
    expect((await list("app/01")).trim()).toBe("");
  });

  test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
    seedBoard(project, [
      planned("app/02"),
      { type: "ticket.moved", id: "app/02", to: "building" },
    ]);
    const a = await werk(
      "followup",
      "app/02",
      "--class",
      "build",
      "--found",
      "review",
      "--why",
      "rename the button",
      "--catchable",
      "no",
    );
    expect(a.code).not.toBe(0);
    expect(a.stderr).toContain("not done");
    const b = await werk(
      "followup",
      "app/99",
      "--class",
      "plan",
      "--found",
      "review",
      "--why",
      "missing rule",
    );
    expect(b.code).not.toBe(0);
    expect(b.stderr).toMatch(/no ticket/);
    expect((await list("app/02")).trim()).toBe("");
  });

  test("43.5 the last correction of a record is the class in force", async () => {
    seedBoard(project, [
      ...doneTicket("app/01"),
      {
        type: "ticket.followup_recorded",
        id: "app/01",
        class: "build",
        found: "after-merge",
        why: "the link expires after 1 minute, the card says 15",
        catchable: true,
      },
    ]);
    await werk(
      "followup",
      "app/01",
      "--class",
      "plan",
      "--found",
      "after-merge",
      "--why",
      "the card never said 15 minutes",
      "--of",
      "1",
    );
    const one = await list("app/01");
    const lines = one.trim().split("\n");
    expect(lines[0]).toMatch(/^1\. corrected by 2, in force: plan miss/);
    expect(lines[1]).toMatch(/^2\. correction of 1: plan miss/);
    await werk(
      "followup",
      "app/01",
      "--class",
      "build",
      "--found",
      "after-merge",
      "--why",
      "the card does say 15 minutes",
      "--catchable",
      "yes",
      "--of",
      "1",
    );
    const two = (await list("app/01")).trim().split("\n");
    expect(two[0]).toMatch(/^1\. corrected by 3, in force: build miss/);
  });
});
