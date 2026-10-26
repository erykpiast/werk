import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { decidedCard, mkProj, openCard, type Proj, writeFile } from "./helpers.ts";

let p: Proj;
beforeEach(() => {
  p = mkProj();
});
afterEach(() => p.dispose());

/** A ticket in the fixed format, with any part replaced. */
function ticket(o: Partial<Record<"cites" | "blocked" | "stories" | "touches" | "what", string | null>> = {}) {
  const v = {
    cites: "c1",
    blocked: "",
    stories: "1",
    touches: "map view",
    what: "A person presses reopen and the card goes back to open.",
    ...o,
  };
  const out = ["title: A ticket", `cites: ${v.cites}`, `blocked_by: ${v.blocked}`, `stories: ${v.stories}`];
  if (v.touches !== null) out.push(`touches: ${v.touches}`);
  out.push("", "## What to build", "", v.what ?? "", "", "## Acceptance criteria", "", "- [ ] It works.", "", "## Checks", "", "- `make test`", "");
  return out.join("\n");
}

const SPEC = "# Spec\n\n## User stories\n\n1. As a person I do one\n2. As a person I do two\n\n## Other\n";

function setup(opts: { decided: string[]; ghost?: string }) {
  p.seed(...openCard("root", { title: "Root" }));
  for (const id of opts.decided) {
    // A decided card needs a decided parent, so it is decided first and linked under the open root after.
    p.seed(...decidedCard(id, { title: id }));
    p.seed({ type: "edge.added", from: id, to: "root", link: "refines" });
  }
  if (opts.ghost) {
    p.seed({ type: "node.proposed", id: opts.ghost, kind: "card", title: opts.ghost, status: "decided", parent: "root" });
  }
  writeFile(join(p.dir, "spec.md"), SPEC);
}
const files = (o: Record<string, string>) => {
  for (const [name, text] of Object.entries(o)) writeFile(join(p.dir, "tickets", name), text);
};
const check = (spec = "spec.md") => p.run("ticket-check", "tickets", "--root", "root", "--spec", spec);
const lines = (s: string) => s.split("\n").filter((l) => l !== "");

describe("30 ticket-check", () => {
  test("30.1 a folder of correct tickets passes", () => {
    setup({ decided: ["c1", "c2"] });
    files({
      "01-first.md": ticket({ cites: "c1", stories: "1" }),
      "02-second.md": ticket({ cites: "c2", stories: "2", blocked: "1" }),
    });
    const r = check();
    const ls = lines(r.stdout);
    expect(ls.length, r.stdout + r.stderr).toBe(1);
    expect(ls[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
    expect(r.code).toBe(0);
  });

  test("30.2 own-check failures name the ticket, the check and the field", () => {
    setup({ decided: ["c1", "c2"] });
    const second = [
      "title: A ticket",
      "cites: c2",
      "blocked_by: ",
      "stories: 2",
      "touches: map view",
      "",
      "## What to build",
      "",
      "Text one.",
      "Text two.",
      "Text three.",
      "Edit src/serve/routes.ts please.",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] It works.",
      "",
      "## Checks",
      "",
      "- `make test`",
      "",
    ].join("\n");
    expect(second.split("\n")[11]).toContain("src/serve/routes.ts");
    files({
      "01-first.md": ticket({ cites: "c1", stories: "1" }),
      "02-second.md": second,
      "03-third.md": ticket({ cites: "c2", stories: "2", touches: null }),
    });
    const r = check();
    const ls = lines(r.stdout);
    expect(ls.find((l) => l.startsWith("02-second.md"))).toMatch(/no-file-paths.*src\/serve\/routes\.ts.*line 12/);
    expect(ls.find((l) => l.startsWith("03-third.md"))).toMatch(/shape.*touches/);
    expect(ls.some((l) => l.startsWith("01-first.md"))).toBe(false);
    expect(ls.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
    expect(r.code).toBe(1);
  });

  test("30.3 an uncited decided card fails the set, and a ghost does not count", () => {
    setup({ decided: ["c1", "c2"], ghost: "ghost1" });
    files({
      "01-first.md": ticket({ cites: "root", stories: "1" }),
      "02-second.md": ticket({ cites: "c1", stories: "2" }),
    });
    const r = check();
    const ls = lines(r.stdout);
    const set = ls.filter((l) => l.startsWith("ticket set"));
    expect(set.length, r.stdout).toBe(1);
    expect(set[0]).toContain("c2");
    expect(ls.some((l) => l.includes("ghost1"))).toBe(false);
    expect(ls.at(-1)).toContain("2 decided cards");
    expect(r.code).toBe(1);
  });

  test("30.4 a cycle in blocked_by names only the tickets on the cycle", () => {
    setup({ decided: ["c1", "c2"] });
    files({
      "01-a.md": ticket({ cites: "c1", stories: "1" }),
      "02-b.md": ticket({ cites: "c2", stories: "2", blocked: "3" }),
      "03-c.md": ticket({ cites: "c2", stories: "2", blocked: "2" }),
      "04-d.md": ticket({ cites: "c2", stories: "2", blocked: "3" }),
    });
    const r = check();
    const fails = lines(r.stdout).filter((l) => /blocked_by/.test(l));
    expect(fails.some((l) => l.startsWith("02-b.md"))).toBe(true);
    expect(fails.some((l) => l.startsWith("03-c.md"))).toBe(true);
    expect(lines(r.stdout).some((l) => l.startsWith("01-a.md") || l.startsWith("04-d.md"))).toBe(false);
    expect(r.code).toBe(1);
  });

  test("30.5 a spec with no User stories heading is a malformed call", () => {
    setup({ decided: ["c1"] });
    files({ "01-a.md": ticket({ cites: "c1", stories: "1" }) });
    writeFile(join(p.dir, "nospec.md"), "# Spec\n\n## Goals\n\n1. one\n");
    const r = check("nospec.md");
    expect(r.stderr + r.stdout).toMatch(/User stories/);
    expect(r.stdout).not.toMatch(/tickets, \d+ own-check/);
    expect(lines(r.stdout).length).toBe(0);
    expect(r.code).toBe(2);
  });
});

/** A board where the ticket reached the column through the moves of the merge loop. */
function doneTicket(id: string) {
  p.seedBoard(
    { type: "ticket.planned", id, title: "T" },
    { type: "ticket.moved", id, to: "building" },
    { type: "ticket.moved", id, to: "merging" },
    { type: "ticket.merge", id },
  );
}
const list = (id: string) => p.run("followup", id, "--list");

describe("43 followup", () => {
  test("43.1 a build miss on a done ticket is recorded and listed", () => {
    doneTicket("app/01");
    expect(list("app/01").stdout.trim()).toBe("");
    const r = p.run("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/recorded/);
    const l = list("app/01");
    const first = lines(l.stdout)[0] as string;
    expect(first).toMatch(/^1\./);
    expect(first).toMatch(/build/);
    expect(first).toMatch(/after[- ]merge/);
    expect(first).toContain("the link expires after 1 minute, the card says 15");
    expect(first).toMatch(/catch.*yes/i);
  });

  test("43.2 a plan miss is recorded without a catchable answer", () => {
    doneTicket("app/01");
    const r = p.run("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/recorded/);
    const first = lines(list("app/01").stdout)[0] as string;
    expect(first).toMatch(/^1\./);
    expect(first).toMatch(/plan/);
    expect(first).toMatch(/review/);
    expect(first).toContain("no card said how long the link lasts");
    expect(first).not.toMatch(/catch/i);
  });

  test("43.3 a wrong catchable answer is refused and nothing is recorded", () => {
    doneTicket("app/01");
    const a = p.run("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toMatch(/build miss needs .*catchable/);
    const b = p.run("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toMatch(/plan miss .*catchable/);
    expect(list("app/01").stdout.trim()).toBe("");
  });

  test("43.4 a ticket that is not done, or does not exist, is refused", () => {
    p.seedBoard(
      { type: "ticket.planned", id: "app/02", title: "T" },
      { type: "ticket.moved", id: "app/02", to: "building" },
    );
    const a = p.run("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toMatch(/not done/);
    const b = p.run("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toMatch(/no ticket app\/99/);
    expect(list("app/02").stdout.trim()).toBe("");
  });

  test("43.5 the last correction of a record is the class in force", () => {
    doneTicket("app/01");
    expect(p.run("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires", "--catchable", "yes").code).toBe(0);
    const c1 = p.run("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
    expect(c1.code, c1.stderr).toBe(0);
    let ls = lines(list("app/01").stdout);
    expect(ls[0]).toMatch(/^1\..*in force.*plan/);
    expect(ls[1]).toMatch(/^2\..*correction of 1.*plan/);
    const c2 = p.run("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
    expect(c2.code, c2.stderr).toBe(0);
    ls = lines(list("app/01").stdout);
    expect(ls[0]).toMatch(/^1\..*in force.*build/);
  });
});

describe("29 re-plan", () => {
  test("29.1 a second plan of the same subtree extends the spec and continues the ticket numbers", () => {
    p.seed(...decidedCard("root", { title: "Root" }));
    const r = p.run("plan", "root");
    expect(r.code, `plan: ${r.stdout}${r.stderr}`).toBe(0);
  });
  test("29.2 an open ticket the new spec no longer needs is archived and can be restored", () => {
    p.seed(...decidedCard("root", { title: "Root" }));
    const r = p.run("plan", "root");
    expect(r.code, `plan: ${r.stdout}${r.stderr}`).toBe(0);
  });
  test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", () => {
    p.seed(...decidedCard("root", { title: "Root" }));
    const r = p.run("plan", "root");
    expect(r.code, `plan: ${r.stdout}${r.stderr}`).toBe(0);
  });
  test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", () => {
    p.seed(...decidedCard("root", { title: "Root" }));
    const r = p.run("plan", "root");
    expect(r.code, `plan: ${r.stdout}${r.stderr}`).toBe(0);
  });
  test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", () => {
    p.seed(...decidedCard("root", { title: "Root" }));
    const r = p.run("plan", "root");
    expect(r.code, `plan: ${r.stdout}${r.stderr}`).toBe(0);
  });
});
