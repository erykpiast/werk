import { expect, test } from "bun:test";
import { ticket } from "./fixtures.ts";
import { MAX_SIZE, ownChecks, pathsIn } from "./own-checks.ts";
import { parseTicket } from "./ticket-parse.ts";

const run = (text: string) => ownChecks(parseTicket("01-a.md", text) as never);
const only = (text: string, check: string) =>
  run(text).filter((f) => f.check === check);

test("a correct ticket passes all eight checks", () => {
  expect(run(ticket())).toEqual([]);
});

test("a ticket with an empty title fails title", () => {
  expect(only(ticket({ title: "" }), "title")).toHaveLength(1);
});

test("a missing touches line fails shape and names the field", () => {
  const failures = run(ticket({ touches: null }));
  expect(failures).toEqual([
    expect.objectContaining({ check: "shape", field: "touches" }),
  ]);
});

test("each missing heading fails shape on its own", () => {
  const failures = only(ticket({ acceptance: null, checks: null }), "shape");
  expect(failures.map((f) => f.field)).toEqual([
    "## Acceptance criteria",
    "## Checks",
  ]);
});

test("headers and sections out of order fail shape", () => {
  const swapped = ticket().replace(
    "cites: map-reopen\nblocked_by: \n",
    "blocked_by: \ncites: map-reopen\n",
  );
  expect(only(swapped, "shape").map((f) => f.field)).toEqual(["blocked_by"]);
  const text = ticket();
  const [head, ...rest] = text.split("\n## ");
  const reversed = [head, ...rest.reverse()].join("\n## ");
  expect(only(reversed, "shape").map((f) => f.message)).toContain(
    'heading "## Acceptance criteria" is out of order',
  );
});

test("a file over the size limit fails size", () => {
  const big = ticket({ what: "x".repeat(MAX_SIZE) });
  expect(only(big, "size")).toHaveLength(1);
  expect(only(ticket({ what: "x".repeat(100) }), "size")).toHaveLength(0);
});

test("an empty What to build, or none, fails", () => {
  expect(only(ticket({ what: "" }), "what-to-build")).toHaveLength(1);
  expect(only(ticket({ what: null }), "what-to-build")).toHaveLength(1);
});

test("acceptance needs a plain or checkbox bullet", () => {
  expect(only(ticket({ acceptance: "prose" }), "acceptance")).toHaveLength(1);
  expect(only(ticket({ acceptance: null }), "acceptance")).toHaveLength(1);
  expect(only(ticket({ acceptance: "- plain" }), "acceptance")).toHaveLength(0);
});

test("a path in the body fails no-file-paths with the path and its line", () => {
  const [failure] = only(
    ticket({ what: "Change src/loop.ts now." }),
    "no-file-paths",
  );
  expect(failure?.message).toContain("src/loop.ts (line 9)");
});

test("a files line fails no-file-paths", () => {
  const text = ticket().replace("touches:", "files: x\ntouches:");
  expect(only(text, "no-file-paths")[0]?.message).toContain('"files:" line');
});

test("pathsIn finds paths and skips URLs, bare names, slash commands, ids", () => {
  expect(pathsIn("see src/*.ts, (a/b.c) and ./x/y.md.")).toEqual([
    "src/*.ts",
    "a/b.c",
    "./x/y.md",
  ]);
  expect(
    pathsIn("https://example.com/a.html Makefile /implement a/b #map-x"),
  ).toEqual([]);
  expect(pathsIn("/etc/app.conf")).toEqual(["/etc/app.conf"]);
});

test("every Checks bullet must be a make target", () => {
  expect(
    only(ticket({ checks: "- `make test`\n- make lint" }), "make-targets"),
  ).toEqual([]);
  const bad = only(ticket({ checks: "- `bun test`" }), "make-targets");
  expect(bad).toHaveLength(1);
  expect(only(ticket({ checks: "" }), "make-targets")).toEqual([]);
  expect(only(ticket({ checks: null }), "make-targets")).toEqual([]);
});

test("touches needs a name, and no name may read as a path", () => {
  expect(only(ticket({ touches: "" }), "touches")).toHaveLength(1);
  expect(only(ticket({ touches: "board, src\\x" }), "touches")).toHaveLength(1);
  expect(only(ticket({ touches: "board, loop.ts" }), "touches")).toHaveLength(
    1,
  );
  expect(only(ticket({ touches: "decision log" }), "touches")).toEqual([]);
});
