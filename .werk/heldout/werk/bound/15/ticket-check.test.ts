// Steps 30.1 to 30.5: the ticket-check verb on a folder of hand-written tickets.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addCard, decidedCard, decidedGhost, ok, useWerk } from "./support.ts";

const { project, werk } = useWerk();

const SPEC = "# Spec\n\n## User stories\n\n1. As a person, I do one.\n2. As a person, I do two.\n\n## Other\n";

/** A ticket in the fixed format. `what` may span lines. */
function ticketText(
  o: {
    cites?: string;
    blockedBy?: string;
    stories?: string;
    touches?: string | null;
    what?: string;
  } = {},
): string {
  const lines = [
    "title: A person does a thing",
    `cites: ${o.cites ?? "root"}`,
    `blocked_by: ${o.blockedBy ?? ""}`,
    `stories: ${o.stories ?? "1"}`,
  ];
  if (o.touches !== null) lines.push(`touches: ${o.touches ?? "map view"}`);
  lines.push(
    "",
    "## What to build",
    "",
    o.what ?? "A person does the thing and sees the result.",
    "",
    "## Acceptance criteria",
    "",
    "- The result shows.",
    "",
    "## Checks",
    "",
    "- `make test`",
    "",
  );
  return lines.join("\n");
}

function files(spec: string, tickets: Record<string, string>): void {
  const dir = project().dir;
  mkdirSync(join(dir, "tickets"));
  writeFileSync(join(dir, "spec.md"), spec);
  for (const [name, text] of Object.entries(tickets)) {
    writeFileSync(join(dir, "tickets", name), text);
  }
}

const check = () =>
  werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");

/** A root card that is not decided, with decided cards under it. */
async function tree(ids: string[]): Promise<void> {
  await addCard(werk, "root");
  for (const id of ids) await decidedCard(werk, id, "root");
}

describe("ticket-check", () => {
  test("30.1 a folder of correct tickets passes", async () => {
    await tree(["card-a", "card-b"]);
    files(SPEC, {
      "01-first.md": ticketText({ cites: "card-a", stories: "1" }),
      "02-second.md": ticketText({
        cites: "card-b",
        stories: "2",
        blockedBy: "1",
      }),
    });
    const result = await check();
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const last = lines.at(-1) as string;
    expect(last).toMatch(/\b2 tickets\b/);
    expect(last).toMatch(/\b0 own-check failures\b/);
    expect(last).toMatch(/\b0 failures\b/);
    expect(last).toMatch(/\b2 decided cards\b/);
    expect(last).toMatch(/\b2 stories\b/);
    expect(result.code).toBe(0);
  });

  test("30.2 own-check failures name the ticket, the check and the field", async () => {
    await tree(["card-a"]);
    const what = ["one", "two", "three", "see src/app/main.ts for it"].join("\n");
    files("# Spec\n\n## User stories\n\n1. One.\n", {
      "01-ok.md": ticketText({ cites: "card-a", stories: "1" }),
      "02-path.md": ticketText({ cites: "card-a", what }),
      "03-notouch.md": ticketText({ cites: "card-a", touches: null }),
    });
    const result = await check();
    const lines = result.stdout.trim().split("\n");
    const second = lines.filter((l) => l.startsWith("02-path.md"));
    expect(second.some((l) => /no-file-paths/.test(l) && /src\/app\/main\.ts/.test(l) && /line 12/.test(l))).toBe(true);
    const third = lines.filter((l) => l.startsWith("03-notouch.md"));
    expect(third.some((l) => /shape/.test(l) && /touches/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith("01-ok.md"))).toBe(false);
    const last = lines.at(-1) as string;
    expect(last).toMatch(/\b3 tickets\b/);
    expect(last).toMatch(/\b2 own-check failures\b/);
    expect(result.code).toBe(1);
  });

  test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
    await addCard(werk, "root");
    await decidedCard(werk, "cited", "root");
    await decidedCard(werk, "uncited", "root");
    await decidedGhost(werk, "ghosty", "root");
    files("# Spec\n\n## User stories\n\n1. One.\n", {
      "01-a.md": ticketText({ cites: "root, cited", stories: "1" }),
    });
    const result = await check();
    const lines = result.stdout.trim().split("\n");
    const set = lines.filter((l) => l.startsWith("ticket set"));
    expect(set).toHaveLength(1);
    expect(set[0]).toContain("uncited");
    expect(lines.some((l) => l.includes("ghosty"))).toBe(false);
    expect(lines.at(-1)).toMatch(/\b2 decided cards\b/);
    expect(result.code).toBe(1);
  });

  test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
    await tree(["c1", "c2", "c3", "c4"]);
    const spec =
      "# Spec\n\n## User stories\n\n1. a\n2. b\n3. c\n4. d\n";
    files(spec, {
      "01-one.md": ticketText({ cites: "c1", stories: "1" }),
      "02-two.md": ticketText({ cites: "c2", stories: "2", blockedBy: "3" }),
      "03-three.md": ticketText({ cites: "c3", stories: "3", blockedBy: "2" }),
      "04-four.md": ticketText({ cites: "c4", stories: "4", blockedBy: "3" }),
    });
    const result = await check();
    const lines = result.stdout.trim().split("\n");
    const blocked = (file: string) =>
      lines.some((l) => l.startsWith(file) && l.includes("blocked_by"));
    expect(blocked("02-two.md")).toBe(true);
    expect(blocked("03-three.md")).toBe(true);
    expect(lines.some((l) => l.startsWith("01-one.md"))).toBe(false);
    expect(lines.some((l) => l.startsWith("04-four.md"))).toBe(false);
    expect(result.code).toBe(1);
  });

  test("30.5 a spec with no User stories heading is a malformed call", async () => {
    await tree(["card-a"]);
    files("# Spec\n\n## Goals\n\n1. Not stories.\n", {
      "01-a.md": ticketText({ cites: "card-a", stories: "1" }),
    });
    const result = await check();
    expect(`${result.stdout}${result.stderr}`).toMatch(/no "?User stories"? heading/i);
    expect(result.stdout.trim()).toBe("");
    expect(result.code).toBe(2);
  });
});

void ok;
