import { expect, test } from "bun:test";
import { ownChecks, SIZE_LIMIT } from "./own-checks.ts";

const VALID = `title: A person can reopen a decided card from the map
cites: map-reopen, #map-stale
blocked_by: 2
stories: 4, 7
touches: map view, decision log

## What to build

A person opens a decided card and presses reopen. See https://example.com/docs/a.html and the Makefile.
Run /implement on it.

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

- \`make test\`
- make e2e
`;

const lines = (file: string, text: string) =>
  ownChecks(file, text).failures.map((f) => `${f.ticket}: ${f.check}: ${f.field}: ${f.message}`);

test("a valid ticket passes all eight checks and gives its fields to the set checks, without the hash sign", () => {
  expect(ownChecks("01.md", VALID)).toEqual({
    failures: [],
    fields: { cites: ["map-reopen", "map-stale"], blockedBy: [2], stories: [4, 7] },
  });
});

test("empty cites, blocked_by, stories and an empty Checks section pass", () => {
  const text = VALID.replace("cites: map-reopen, #map-stale", "cites:")
    .replace("blocked_by: 2", "blocked_by:")
    .replace("stories: 4, 7", "stories: ")
    .replace("- `make test`\n- make e2e\n", "");
  expect(ownChecks("01.md", text)).toEqual({ failures: [], fields: { cites: [], blockedBy: [], stories: [] } });
});

test("a file with no title fails title alone, and no other check runs on it", () => {
  expect(lines("x.md", "cites: a\n## Checks\n- npm test\n")).toEqual([
    'x.md: title: title: the file has no line "title: <text>"',
  ]);
  expect(lines("x.md", "title:   \n")).toHaveLength(1);
});

test("shape names each missing header line and each missing heading", () => {
  const text = "title: T\ncites: a\n\n## Acceptance criteria\n\n- one\n";
  expect(lines("03.md", text).filter((line) => line.includes(": shape: "))).toEqual([
    '03.md: shape: blocked_by: the line "blocked_by:" is missing',
    '03.md: shape: stories: the line "stories:" is missing',
    '03.md: shape: touches: the line "touches:" is missing',
    '03.md: shape: What to build: the heading "## What to build" is missing',
    '03.md: shape: Checks: the heading "## Checks" is missing',
  ]);
});

test("shape fails header lines or sections out of order, and a list entry that is not a number", () => {
  const swapped = VALID.replace("blocked_by: 2\nstories: 4, 7", "stories: 4, x\nblocked_by: 2");
  expect(lines("01.md", swapped)).toEqual([
    "01.md: shape: header: the header lines are not in the order title, cites, blocked_by, stories, touches",
    '01.md: shape: stories: "x" is not a number',
  ]);
  const sections = `title: T\ncites:\nblocked_by:\nstories:\ntouches: m\n\n## Checks\n\n## What to build\n\nText\n\n## Acceptance criteria\n\n- a\n`;
  expect(lines("01.md", sections)).toEqual([
    "01.md: shape: sections: the sections are not in the order What to build, Acceptance criteria, Checks",
  ]);
});

test("a file over the size limit fails size, and a file at the limit passes", () => {
  const pad = (n: number) => `${VALID}${"x".repeat(n - VALID.length)}`;
  expect(lines("01.md", pad(SIZE_LIMIT))).toEqual([]);
  expect(lines("01.md", pad(SIZE_LIMIT + 1))).toEqual(["01.md: size: file: 4001 characters; the limit is 4000"]);
});

test("what-to-build fails an empty section and a missing heading", () => {
  const empty = VALID.replace(/## What to build\n[\s\S]*?## Acceptance/, "## What to build\n\n   \n## Acceptance");
  expect(lines("01.md", empty)).toEqual(["01.md: what-to-build: What to build: the section has no text"]);
  const missing = VALID.replace("## What to build", "## Plan");
  expect(lines("01.md", missing)).toContain("01.md: what-to-build: What to build: the section is missing");
});

test("acceptance needs a plain bullet or a checkbox", () => {
  const plain = VALID.replace("- [ ] A reopened", "- A reopened");
  expect(lines("01.md", plain)).toEqual([]);
  const none = VALID.replace("- [ ] A reopened card shows as open in the map.", "A reopened card shows as open.");
  expect(lines("01.md", none)).toEqual(["01.md: acceptance: Acceptance criteria: the section has no bullet"]);
  const missing = VALID.replace("## Acceptance criteria", "## Criteria");
  expect(lines("01.md", missing)).toContain("01.md: acceptance: Acceptance criteria: the section is missing");
});

test("no-file-paths lists each path with its line and its field; a bare file name, a URL and a slash command pass", () => {
  const text = VALID.replace("touches: map view, decision log", "touches: map view\nfiles: a")
    .replace("A person opens", "Edit src/loop.ts and src/*.ts, then .werk/log.jsonl. A person opens")
    .replace("- [ ] A reopened", "- [ ] web/app.tsx: a reopened");
  expect(lines("01.md", text)).toEqual([
    "01.md: no-file-paths: files: line 6: a files line names file paths",
    "01.md: no-file-paths: What to build: line 10: src/loop.ts",
    "01.md: no-file-paths: What to build: line 10: src/*.ts",
    "01.md: no-file-paths: What to build: line 10: .werk/log.jsonl",
    "01.md: no-file-paths: Acceptance criteria: line 15: web/app.tsx",
  ]);
});

test("a path in a header line or between the header lines names its place", () => {
  const text = VALID.replace("cites: map-reopen, #map-stale", "cites: map-reopen\nsee docs/a.md\n");
  expect(lines("01.md", text.replace("title: A person", "title: docs/b.md A person"))).toEqual([
    "01.md: no-file-paths: title: line 1: docs/b.md",
    "01.md: no-file-paths: header: line 3: docs/a.md",
  ]);
});

test("make-targets fails each Checks bullet that is not make <target>", () => {
  const text = VALID.replace("- make e2e", "- `npm test`\n- make\n* make lint");
  expect(lines("01.md", text)).toEqual([
    '01.md: make-targets: Checks: line 19: "npm test" is not make <target>',
    '01.md: make-targets: Checks: line 20: "make" is not make <target>',
  ]);
});

test("touches needs a module name, and fails a name with a slash, a backslash or an extension", () => {
  const empty = VALID.replace("touches: map view, decision log", "touches: ,");
  expect(lines("01.md", empty)).toEqual(["01.md: touches: touches: names no module"]);
  const paths = VALID.replace("touches: map view, decision log", "touches: map view, web\\app, store.ts, ui/board");
  expect(lines("01.md", paths)).toEqual([
    '01.md: touches: touches: "web\\app" reads as a path, not a module name',
    '01.md: touches: touches: "store.ts" reads as a path, not a module name',
    '01.md: touches: touches: "ui/board" reads as a path, not a module name',
  ]);
  const missing = VALID.replace("touches: map view, decision log\n", "");
  expect(lines("01.md", missing)).toContain("01.md: touches: touches: names no module");
});
