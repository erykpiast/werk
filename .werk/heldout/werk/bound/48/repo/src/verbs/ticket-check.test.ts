// `werk ticket-check` at the command-line seam (#werk-v0-seams): a folder of hand-written tickets,
// a spec and a map in a fresh project, read back through the output and the exit code.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../test/project.ts";

const SPEC = `# Spec: reopen

## User stories

1. As a person, I want to reopen a decided card.
2. As a person, I want its dependents marked stale.

## Seams

The command line.
`;

const ticket = (title: string, cites: string, blockedBy: string, stories: string, extra = "") => `title: ${title}
cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: map view, decision log

## What to build

A person opens a decided card and presses reopen.${extra}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

- \`make test\`
`;

/** A project with a decided subtree: #reopen over #reopen-mark, a ghost under it, and a spec. */
function project(): Project {
  const p = freshProject();
  const events = [
    { type: "node.added", payload: { id: "reopen", kind: "card", title: "Reopen" } },
    { type: "node.added", payload: { id: "reopen-mark", kind: "card", title: "Mark", parent: "reopen" } },
    { type: "node.proposed", payload: { id: "reopen-ghost", kind: "card", title: "Ghost", parent: "reopen" } },
    { type: "node.decided", payload: { id: "reopen" } },
    { type: "node.decided", payload: { id: "reopen-mark" } },
    { type: "node.decided", payload: { id: "reopen-ghost" } },
  ];
  const log = events.map((event, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...event }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${log.join("\n")}\n`);
  writeFileSync(join(p.dir, "spec.md"), SPEC);
  mkdirSync(join(p.dir, "tickets"));
  return p;
}

function tickets(p: Project, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
}

const check = (p: Project, ...extra: string[]) =>
  p.werk(["ticket-check", "tickets", "--root", "#reopen", "--spec", "spec.md", ...extra]);

const valid = {
  "01-reopen.md": ticket("A person can reopen a card", "reopen", "", "1"),
  "02-mark.md": ticket("Dependents show a stale mark", "#reopen-mark", "1", "2"),
};

test("a folder of valid hand-written tickets exits 0 and prints only the count line", async () => {
  const p = project();
  tickets(p, { ...valid, "notes.txt": "src/loop.ts" });
  const run = await check(p);
  expect(run).toEqual({
    code: 0,
    out: "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories\n",
    err: "",
  });
});

test("a ticket naming a source file path fails no-file-paths with the line number; a bare file name passes", async () => {
  const p = project();
  tickets(p, {
    ...valid,
    "02-mark.md": ticket(
      "Dependents show a stale mark",
      "reopen-mark",
      "1",
      "2",
      "\nEdit src/map/stale.ts, not the Makefile.",
    ),
  });
  const run = await check(p);
  expect(run.code).toBe(1);
  expect(run.out).toBe(
    [
      "02-mark.md: no-file-paths: What to build: line 10: src/map/stale.ts",
      "ticket set: cards-cited: cites: no ticket cites #reopen-mark",
      "ticket set: stories: stories: no ticket delivers story 2",
      "2 tickets, 1 own-check failure, 3 failures, 2 decided cards, 2 stories",
      "",
    ].join("\n"),
  );
});

test("a ticket over 4000 characters fails size", async () => {
  const p = project();
  tickets(p, { ...valid, "01-reopen.md": ticket("Long", "reopen", "", "1", ` ${"word ".repeat(800)}`) });
  const run = await check(p);
  expect(run.code).toBe(1);
  expect(run.out).toStartWith("01-reopen.md: size: file: 4");
  expect(run.out).toContain("characters; the limit is 4000\n");
});

test("an uncited decided card, a missing story and a blocker cycle each print one set failure", async () => {
  const p = project();
  tickets(p, {
    "01-reopen.md": ticket("A person can reopen a card", "reopen", "2", "1"),
    "02-other.md": ticket("Another slice", "reopen", "1", "1"),
  });
  const run = await check(p);
  expect(run.code).toBe(1);
  expect(run.out).toBe(
    [
      "ticket set: cards-cited: cites: no ticket cites #reopen-mark",
      "ticket set: stories: stories: no ticket delivers story 2",
      "01-reopen.md: blocked_by: blocked_by: a blocked_by cycle: 01-reopen.md, 02-other.md",
      "2 tickets, 0 own-check failures, 3 failures, 2 decided cards, 2 stories",
      "",
    ].join("\n"),
  );
});

test("a ghost under the root does not need to be cited, also when it is decided", async () => {
  const p = project();
  tickets(p, valid);
  const run = await check(p);
  expect(run.out).not.toContain("reopen-ghost");
  expect(run.code).toBe(0);
});

test("a malformed call exits 2 and prints nothing to standard output", async () => {
  const p = project();
  tickets(p, valid);
  const cases: [string[], string][] = [
    [
      ["ticket-check", "tickets", "--root", "reopen"],
      "werk ticket-check: --spec is required\nUsage: werk ticket-check <folder> --root <card-id> --spec <file>\n",
    ],
    [
      ["ticket-check", "tickets", "--spec", "spec.md"],
      "werk ticket-check: --root is required\nUsage: werk ticket-check <folder> --root <card-id> --spec <file>\n",
    ],
    [
      ["ticket-check", "tickets", "--root", "reopen", "--spec", "none.md"],
      'werk ticket-check: no spec file "none.md"\n',
    ],
    [["ticket-check", "nowhere", "--root", "reopen", "--spec", "spec.md"], 'werk ticket-check: no folder "nowhere"\n'],
    [["ticket-check", "tickets", "--root", "nope", "--spec", "spec.md"], 'werk ticket-check: no node "nope"\n'],
  ];
  for (const [args, err] of cases) expect(await p.werk(args)).toEqual({ code: 2, out: "", err });
  writeFileSync(join(p.dir, "spec.md"), "# Spec\n\n1. A line.\n");
  expect(await check(p)).toEqual({
    code: 2,
    out: "",
    err: 'werk ticket-check: the spec "spec.md" has no User stories heading\n',
  });
  const noFolder = await p.werk(["ticket-check", "--root", "reopen", "--spec", "spec.md"]);
  expect(noFolder.code).toBe(2);
  expect(noFolder.out).toBe("");
});
