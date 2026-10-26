import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import { createProject, decidedCard, ghost, type Project, real, werk, writeLog } from "./support.ts";

const SPEC = "# Spec\n\n## User stories\n\n1. As a person I do one.\n2. As a person I do two.\n\n## Other\n";

/** A root that is open again, with decided cards below it: the decided cards are the ones that count. */
const rootWith = (...below: unknown[][]) => [
  ...decidedCard("root"),
  ...below.flat(),
  { type: "node.reopened", id: "root" },
];

async function check(
  events: unknown[],
  tickets: Record<string, string>,
  spec = SPEC,
) {
  const p: Project = createProject();
  try {
    writeLog(p, events);
    const folder = join(p.dir, "tickets");
    mkdirSync(folder, { recursive: true });
    for (const [name, text] of Object.entries(tickets)) writeFileSync(join(folder, name), text);
    writeFileSync(join(p.dir, "spec.md"), spec);
    const r = await werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
    return { ...r, lines: r.stdout.split("\n").filter(Boolean) };
  } finally {
    await p.dispose();
  }
}

test("30.1 a folder of correct tickets passes", async () => {
  const r = await check(
    rootWith(decidedCard("a", { parent: "root" }), decidedCard("b", { parent: "root" })),
    {
      "01-first.md": ticket({ cites: "a", stories: "1", blockedBy: "" }),
      "02-second.md": ticket({ cites: "b", stories: "2", blockedBy: "1", title: "A second thing" }),
    },
  );
  expect(r.lines.slice(0, -1)).toEqual([]);
  const last = r.lines.at(-1) as string;
  expect(last).toMatch(/2 tickets/);
  expect(last).toMatch(/0 own-check failures/);
  expect(last).toMatch(/0 failures/);
  expect(last).toMatch(/2 decided cards/);
  expect(last).toMatch(/2 stories/);
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  const body = ["First line of text.", "Second line.", "Third line.", "Edit src/lib/thing.ts to do it."].join("\n");
  const r = await check(
    rootWith(decidedCard("a", { parent: "root" })),
    {
      "01-ok.md": ticket({ cites: "a", stories: "1, 2" }),
      "02-path.md": ticket({ cites: "a", stories: "1", what: body, title: "Second" }),
      "03-notouch.md": ticket({ cites: "a", stories: "1", touches: null, title: "Third" }),
    },
  );
  const path = r.lines.find((l) => l.startsWith("02-path.md"));
  expect(path).toContain("no-file-paths");
  expect(path).toContain("src/lib/thing.ts");
  expect(path).toContain("line 12");
  const shape = r.lines.find((l) => l.startsWith("03-notouch.md"));
  expect(shape).toContain("shape");
  expect(shape).toContain("touches");
  expect(r.lines.some((l) => l.startsWith("01-ok.md"))).toBe(false);
  const last = r.lines.at(-1) as string;
  expect(last).toMatch(/3 tickets/);
  expect(last).toMatch(/2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  const r = await check(
    rootWith(
      ghost("ghosty", { parent: "root", status: "decided" }) && [ghost("ghosty", { parent: "root", status: "decided" })],
      decidedCard("b", { parent: "root" }),
      decidedCard("c", { parent: "root" }),
    ),
    {
      "01-one.md": ticket({ cites: "root, b", stories: "1" }),
      "02-two.md": ticket({ cites: "b", stories: "2", title: "Second" }),
    },
  );
  const set = r.lines.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("c");
  expect(r.lines.filter((l) => l.includes("ghosty"))).toHaveLength(0);
  expect(r.lines.at(-1)).toMatch(/2 decided cards/);
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  const r = await check(rootWith(decidedCard("a", { parent: "root" })), {
    "01-a.md": ticket({ cites: "a", stories: "1" }),
    "02-b.md": ticket({ cites: "a", stories: "2", blockedBy: "3", title: "B" }),
    "03-c.md": ticket({ cites: "a", stories: "1", blockedBy: "2", title: "C" }),
    "04-d.md": ticket({ cites: "a", stories: "1", blockedBy: "3", title: "D" }),
  });
  const failed = (name: string) => r.lines.find((l) => l.startsWith(name));
  expect(failed("02-b.md")).toContain("blocked_by");
  expect(failed("03-c.md")).toContain("blocked_by");
  expect(failed("01-a.md")).toBeUndefined();
  expect(failed("04-d.md")).toBeUndefined();
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  const r = await check(
    rootWith(decidedCard("a", { parent: "root" })),
    { "01-a.md": ticket({ cites: "a", stories: "1" }) },
    "# Spec\n\nNo stories here.\n",
  );
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/User stories/);
  expect(r.stdout.trim()).toBe("");
});
