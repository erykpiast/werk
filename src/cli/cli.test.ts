import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const current = () => project;
const werk = (...args: string[]) => current().run(["bun", CLI, ...args]);

test("add under a parent appends one event, and show prints the card as proposed under it", async () => {
  expect((await werk("add", "root", "--title", "Root")).stdout.trim()).toBe(
    "proposed",
  );
  const added = await werk(
    "add",
    "child",
    "--title",
    "Child",
    "--why",
    "w",
    "--parent",
    "root",
  );
  expect(added.code).toBe(0);
  expect(added.stdout.trim()).toBe("proposed");
  expect(current().events()).toHaveLength(2);
  const shown = await werk("show", "child");
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain("proposed");
  expect(shown.stdout).toContain("-> refines");
  expect(shown.stdout).toContain("root");
});

test("a second add with the same id exits non-zero, names the rule, and appends nothing", async () => {
  await werk("add", "a", "--title", "A");
  const again = await werk("add", "a", "--title", "Other");
  expect(again.code).toBe(1);
  expect(again.stderr).toContain("duplicate-id");
  expect(current().events()).toHaveLength(1);
});

test("add with a decided status is refused", async () => {
  const result = await werk("add", "a", "--title", "A", "--status", "decided");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("decided");
  expect(current().events()).toHaveLength(0);
});

test("add refuses bad input before it writes", async () => {
  for (const args of [
    ["add"],
    ["add", "a"],
    ["add", "a", "--title", "A", "--nope", "x"],
    ["add", "a", "--title", "A", "--status", "x"],
  ]) {
    expect((await werk(...args)).code).toBe(2);
  }
  expect(
    (await werk("add", "a", "--title", "A", "--parent", "ghost")).stderr,
  ).toContain("unknown-card");
  expect(current().events()).toHaveLength(0);
});

test("show takes #id and id as the same card, and a title that starts with a hash keeps it", async () => {
  await werk(
    "add",
    "#hashed",
    "--title",
    "#hashed title",
    "--why",
    "see #other",
  );
  const plain = await werk("show", "hashed");
  const hashed = await werk("show", "#hashed");
  expect(hashed.stdout).toBe(plain.stdout);
  expect(plain.stdout).toContain("#hashed title");
  expect(plain.stdout).toContain("why: see #other");
  expect((current().events()[0] as { id: string }).id).toBe("hashed");
});

test("show names an unknown card, refuses an empty map and refuses a bad call", async () => {
  expect((await werk("show", "nope")).code).toBe(1);
  expect((await werk("show")).code).toBe(1);
  expect((await werk("show", "a", "b")).code).toBe(2);
  expect((await werk("show", "--x", "1")).code).toBe(2);
});

test("a hand-written bad line is listed as a problem and the cards after it still show", async () => {
  await werk("add", "a", "--title", "A");
  const log = current().logPath;
  writeFileSync(
    log,
    `${readFileSync(log, "utf8")}{not json\n{"type":"node.proposed","id":"a","kind":"card","title":"dup","status":"open"}\n`,
  );
  await werk("add", "b", "--title", "B");
  const shown = await werk("show", "b");
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain("B");
  expect(shown.stderr).toContain("log line 2: bad-json");
  expect(shown.stderr).toContain("log line 3: duplicate-id");
});

test("help lists the registered verbs", async () => {
  const result = await werk("help");
  expect(result.stdout).toContain("add");
  expect(result.stdout).toContain("show");
  expect(result.stdout).toContain("help");
  expect((await werk("nope")).code).toBe(2);
});

test("link needs a reason for depends_on, refuses lineage, and appends nothing then", async () => {
  await werk("add", "a", "--title", "A");
  await werk("add", "a1", "--title", "A1", "--parent", "a");
  await werk("add", "b", "--title", "B");
  const before = current().events().length;
  const noWhy = await werk("link", "a1", "b", "--type", "depends_on");
  expect(noWhy.code).toBe(1);
  const lineage = await werk(
    "link",
    "a1",
    "a",
    "--type",
    "depends_on",
    "--why",
    "x",
  );
  expect(lineage.code).toBe(1);
  expect(lineage.stderr).toContain("ancestor");
  const option = await werk("add", "o", "--title", "O");
  expect(option.code).toBe(0);
  expect(current().events()).toHaveLength(before + 1);
});

test("linking the same pair again replaces the reason shown, and a link on a ghost shows as held", async () => {
  await werk("add", "a", "--title", "A");
  await werk("add", "b", "--title", "B");
  for (const why of ["first", "second"]) {
    const r = await werk(
      "link",
      "a",
      "b",
      "--type",
      "depends_on",
      "--why",
      why,
    );
    expect(r.stdout.trim()).toBe("linked");
  }
  const shown = (await werk("show", "a")).stdout;
  expect(shown).toContain("second");
  expect(shown).not.toContain("first");
  expect(shown).toContain("[held]");
});

test("link rejects a missing type or a wrong count of ids", async () => {
  expect((await werk("link", "a", "b")).code).toBe(2);
  expect((await werk("link", "a", "--type", "refines")).code).toBe(2);
});

const accept = (id: string, ...rest: string[]) => werk("accept", id, ...rest);

test("accept without the person's statement exits non-zero and appends nothing", async () => {
  await werk("add", "a", "--title", "A");
  const result = await accept("a");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("accept-actor");
  expect((await accept("a", "--actor", "me")).code).toBe(1);
  expect(current().events()).toHaveLength(1);
  expect((await werk("show", "a")).stdout).toContain("proposed");
});

test("accepting a ghost child under a ghost parent makes both real and their edges live", async () => {
  await werk("add", "p", "--title", "P");
  await werk("add", "c", "--title", "C", "--parent", "p");
  const result = await accept("#c", "--actor", "you");
  expect(result.stdout.trim()).toBe("accepted");
  for (const id of ["p", "c"]) {
    const shown = (await werk("show", id)).stdout;
    expect(shown).not.toContain("proposed");
    expect(shown).not.toContain("[held]");
  }
});

test("an accept takes the ghost source, and a discard keeps a source another ghost cites", async () => {
  for (const id of ["c", "d"]) await werk("add", id, "--title", id);
  await werk("add", "s", "--title", "S", "--kind", "source");
  await werk("add", "t", "--title", "T", "--kind", "source");
  for (const [from, to] of [
    ["c", "s"],
    ["d", "s"],
    ["c", "t"],
  ]) {
    await werk("link", from as string, to as string, "--type", "supported_by");
  }
  expect((await werk("discard", "c")).stdout.trim()).toBe("discarded");
  expect((await werk("show", "t")).code).toBe(1);
  expect((await werk("show", "s")).stdout).toContain("proposed");
  await accept("d", "--actor", "you");
  const shown = (await werk("show", "s")).stdout;
  expect(shown).not.toContain("proposed");
  expect((await werk("discard", "d")).code).toBe(1);
});

test("edit refuses the body of a ghost, and who and link work on it", async () => {
  await werk("add", "a", "--title", "A");
  await werk("add", "b", "--title", "B");
  const body = await werk("edit", "a", "--body", "x");
  expect(body.code).toBe(1);
  expect(body.stderr).toContain("frozen");
  expect((await werk("edit", "a", "--who", "you")).stdout.trim()).toBe(
    "a: edited",
  );
  expect((await werk("link", "a", "b", "--type", "supported_by")).code).toBe(0);
  expect((await werk("edit", "a")).code).toBe(2);
  expect((await werk("edit", "a", "--who", "x")).code).toBe(1);
});

test("a corrected ghost keeps its notes, with a marker where the new words begin", async () => {
  await werk("add", "x", "--title", "First");
  expect((await werk("say", "x", "Say what it writes.")).stdout.trim()).toBe(
    "noted",
  );
  await werk("discard", "x");
  expect((await werk("inbox")).stdout).toContain("Say what it writes.");
  await werk("add", "x", "--title", "Second");
  await werk("say", "x", "Better.");
  const lines = (await werk("inbox")).stdout.trim().split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain("Say what it writes.");
  expect(lines[1]).toContain("proposed again");
  expect(lines[2]).toContain("Better.");
  const shown = (await werk("show", "x")).stdout;
  expect(shown.indexOf("Say what")).toBeLessThan(
    shown.indexOf("proposed again"),
  );
  expect(shown.indexOf("proposed again")).toBeLessThan(
    shown.indexOf("Better."),
  );
  const since = (await werk("inbox", "--since", "2", "-n", "1")).stdout.trim();
  expect(since).toContain("proposed again");
});

test("say, inbox, accept, discard and add refuse bad input", async () => {
  for (const args of [
    ["say", "a"],
    ["say", "a", "x", "y"],
    ["accept"],
    ["accept", "a", "--x", "1"],
    ["discard"],
    ["inbox", "a"],
    ["inbox", "--since", "x"],
    ["add", "a", "--title", "A", "--kind", "x"],
  ]) {
    expect((await werk(...args)).code).toBe(2);
  }
  expect((await werk("say", "nope", "x")).code).toBe(1);
  expect((await werk("discard", "nope")).code).toBe(1);
  expect(current().events()).toHaveLength(0);
});

test("a bare card is refused once, with every missing fact and its fix", async () => {
  await werk("add", "x", "--title", "X");
  const refused = await werk("status", "x", "decided");
  expect(refused.code).toBe(1);
  for (const fact of ["who:", "basis:", "option:", "kill:"]) {
    expect(refused.stderr).toContain(fact);
  }
  expect(refused.stderr).toContain("werk edit x --who");
  expect(current().events()).toHaveLength(1);
});

test("a card is decided after its facts are recorded, and the waiver reasons print", async () => {
  await werk("add", "t", "--title", "T");
  expect((await werk("edit", "t", "--who", "me")).code).toBe(0);
  expect((await werk("edit", "t", "--no-basis", "")).code).toBe(1);
  expect((await werk("status", "t", "decided")).code).toBe(1);
  expect((await werk("edit", "t", "--no-basis", "root of a tree")).code).toBe(
    0,
  );
  expect((await werk("kill", "t", "--revisit")).code).toBe(0);
  const decided = await werk("status", "t", "decided");
  expect(decided.stdout.trim()).toBe("t: decided");
  const shown = (await werk("show", "t")).stdout;
  expect(shown).toContain("basis waived: root of a tree");
  expect(shown).toContain("kill: revisit at any time");
  expect(shown).toContain("proposed");
});

test("an open basis is named, and the unchallenged reason prints", async () => {
  await werk("add", "p", "--title", "P");
  await werk("add", "u", "--title", "U", "--parent", "p");
  await werk("edit", "u", "--who", "you", "--unchallenged", "no real choice");
  await werk("kill", "u", "--no-metric", "cheap to reverse");
  const refused = await werk("status", "u", "decided");
  expect(refused.stderr).toContain("p (open)");
  expect(refused.stderr).not.toContain("option:");
  expect((await werk("show", "u")).stdout).toContain(
    "option waived: no real choice",
  );
});

test("kill takes exactly one form, and a metric needs all five parts", async () => {
  await werk("add", "k", "--title", "K");
  expect((await werk("kill", "k")).code).toBe(2);
  expect((await werk("kill", "k", "--revisit", "--manual", "x")).code).toBe(2);
  expect((await werk("kill", "k", "--metric", "m")).code).toBe(2);
  const metric = await werk(
    "kill",
    "k",
    "--metric",
    "install time",
    "--source",
    "posthog",
    "--threshold",
    "> 4 min",
    "--window",
    "7 days",
    "--sample",
    "100",
  );
  expect(metric.code).toBe(0);
  expect((await werk("kill", "k", "--manual", "I use it")).code).toBe(0);
  expect((await werk("kill", "zz", "--revisit")).code).toBe(1);
  expect((await werk("status", "k", "open")).code).toBe(2);
});

test("remove takes the subtree and restore undoes it", async () => {
  await werk("add", "r", "--title", "R");
  await werk("add", "c", "--title", "C", "--parent", "r");
  await werk("accept", "c", "--actor", "you");
  expect((await werk("remove", "r", "--actor", "you")).stdout.trim()).toBe(
    "removed",
  );
  expect((await werk("show", "c")).code).toBe(1);
  const again = await werk("add", "r", "--title", "New");
  expect(again.code).toBe(1);
  expect(again.stderr).toContain("restore");
  expect((await werk("restore", "c", "--actor", "you")).code).toBe(1);
  expect((await werk("restore", "r", "--actor", "you")).stdout.trim()).toBe(
    "restored",
  );
  expect((await werk("show", "c")).code).toBe(0);
  expect((await werk("remove", "r", "--actor", "you", "--reparent")).code).toBe(
    1,
  );
  expect((await werk("remove")).code).toBe(2);
  expect((await werk("restore")).code).toBe(2);
});

/** A real card with a two-block body, decided with who me. */
async function decidedCard(id: string) {
  await werk("add", id, "--title", "Seats", "--body", "One.\n\nTwo.");
  await accept(id, "--actor", "you");
  await werk("edit", id, "--who", "me", "--no-basis", "root");
  await werk("kill", id, "--revisit");
  expect((await werk("status", id, "decided")).code).toBe(0);
}

test("propose refuses a body block that no op names, and prints the block", async () => {
  await decidedCard("q");
  const ops = JSON.stringify([{ tag: "elaborated", old: "One.", new: "One." }]);
  const refused = await werk("propose", "q", "--ops", ops);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain("cover");
  expect(refused.stderr).toContain('"Two."');
  expect((await werk("propose", "q", "--ops", "nope")).code).toBe(2);
  expect((await werk("propose", "q")).code).toBe(1);
});

test("propose shows one diff on the card, and an accept amends the decided card", async () => {
  await decidedCard("q");
  const ops = JSON.stringify([
    { tag: "elaborated", old: "One.", new: "One." },
    { tag: "elaborated", old: "Two.", new: "Two, more." },
  ]);
  expect(
    (await werk("propose", "q", "--title", "Seats now", "--ops", ops)).code,
  ).toBe(0);
  const pending = (await werk("show", "q")).stdout;
  expect(pending).toContain("pending change");
  expect(pending).toContain("title: Seats {+now+}");
  expect(pending).toContain("[-Two.-] {+Two, more.+}");
  expect((await accept("q")).code).toBe(1);
  expect((await accept("q", "--actor", "you")).code).toBe(0);
  const shown = (await werk("show", "q")).stdout;
  expect(shown).toContain("[decided]");
  expect(shown).toContain("Two, more.");
  expect(shown).not.toContain("pending change");
});

test("discard drops the pending change of a card in the map", async () => {
  await decidedCard("q");
  await werk("propose", "q", "--why", "because");
  expect((await werk("discard", "q")).stdout.trim()).toBe("discarded");
  expect((await werk("show", "q")).stdout).not.toContain("pending change");
});

test("remove takes an option only when the decided card keeps an option", async () => {
  await werk("add", "r", "--title", "R");
  await accept("r", "--actor", "you");
  await werk("edit", "r", "--who", "you", "--no-basis", "root");
  await werk("add", "r:o1", "--kind", "option", "--title", "O1");
  await werk("link", "r:o1", "r", "--type", "alternative_to");
  await accept("r:o1", "--actor", "you");
  await werk("kill", "r", "--revisit");
  expect((await werk("status", "r", "decided")).code).toBe(0);
  const refused = await werk("remove", "r:o1", "--actor", "you");
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain("option");
  await werk("add", "r:o2", "--kind", "option", "--title", "O2");
  await werk("link", "r:o2", "r", "--type", "alternative_to");
  await accept("r:o2", "--actor", "you");
  expect((await werk("remove", "r:o1", "--actor", "you")).code).toBe(0);
});
