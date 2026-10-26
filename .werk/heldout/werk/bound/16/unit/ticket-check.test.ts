import { describe, expect, test } from "bun:test";
import { ticket } from "../../src/tickets/fixtures.ts";
import { makeCard, useWerk, type Werk } from "./support.ts";

const w = useWerk();
const check = (t: Werk, ...extra: string[]) =>
  t.run("ticket-check", "tickets", "--root", "root", "--spec", "spec.md", ...extra);
const spec = (t: Werk, stories = ["1", "2"]) =>
  t.write("spec.md", `# Spec\n\n## User stories\n\n${stories.map((s) => `${s}. As a person I want ${s}.`).join("\n")}\n\n## Other\n`);
const lastLine = (s: string) => s.trim().split("\n").at(-1) ?? "";

describe("30 ticket-check", () => {
  test("30.1 a folder of correct tickets passes", async () => {
    const t = w();
    await makeCard(t, "root");
    await makeCard(t, "card-a", { parent: "root", decided: true });
    await makeCard(t, "card-b", { parent: "root", decided: true });
    spec(t);
    t.write("tickets/01-first.md", ticket({ cites: "card-a", stories: "1" }));
    t.write("tickets/02-second.md", ticket({ cites: "card-b", stories: "2", blockedBy: "1" }));
    const r = await check(t);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = r.stdout.trim().split("\n");
    expect(out).toHaveLength(1);
    expect(lastLine(r.stdout)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  });

  test("30.2 own-check failures name the ticket, the check and the field", async () => {
    const t = w();
    await makeCard(t, "root");
    await makeCard(t, "card-a", { parent: "root", decided: true });
    spec(t, ["1"]);
    t.write("tickets/01-ok.md", ticket({ cites: "card-a", stories: "1" }));
    // The path sits on line 12 of the file.
    const withPath = ticket({
      cites: "card-a",
      what: "Line nine.\nLine ten.\nLine eleven.\nEdit src/loop.ts now.",
    });
    expect(withPath.split("\n")[11]).toContain("src/loop.ts");
    t.write("tickets/02-path.md", withPath);
    t.write("tickets/03-notouch.md", ticket({ cites: "card-a", touches: null }));
    const r = await check(t);
    expect(r.code).toBe(1);
    const lines = r.stdout.trim().split("\n");
    expect(lines.find((l) => l.startsWith("02-path.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 12"))).toBeDefined();
    expect(lines.find((l) => l.startsWith("03-notouch.md") && l.includes("shape") && l.includes("touches"))).toBeDefined();
    expect(lines.some((l) => l.startsWith("01-ok.md"))).toBe(false);
    expect(lastLine(r.stdout)).toMatch(/^3 tickets, 2 own-check failures/);
  });

  test("30.3 an uncited decided card fails the set, a ghost does not count", async () => {
    const t = w();
    await makeCard(t, "root");
    await makeCard(t, "ghosty", { parent: "root", decided: true, ghost: true });
    await makeCard(t, "cited", { parent: "root", decided: true });
    await makeCard(t, "uncited", { parent: "root", decided: true });
    spec(t, ["1"]);
    t.write("tickets/01-a.md", ticket({ cites: "root, cited", stories: "1" }));
    const r = await check(t);
    expect(r.code).toBe(1);
    const lines = r.stdout.trim().split("\n");
    const setLines = lines.filter((l) => l.startsWith("ticket set"));
    expect(setLines).toHaveLength(1);
    expect(setLines[0]).toContain("uncited");
    expect(lines.some((l) => l.includes("ghosty"))).toBe(false);
    expect(lastLine(r.stdout)).toContain("2 decided cards");
  });

  test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
    const t = w();
    await makeCard(t, "root");
    await makeCard(t, "card-a", { parent: "root", decided: true });
    spec(t, ["1"]);
    t.write("tickets/01-a.md", ticket({ cites: "card-a", stories: "1" }));
    t.write("tickets/02-b.md", ticket({ cites: "card-a", stories: "1", blockedBy: "3" }));
    t.write("tickets/03-c.md", ticket({ cites: "card-a", stories: "1", blockedBy: "2" }));
    t.write("tickets/04-d.md", ticket({ cites: "card-a", stories: "1", blockedBy: "3" }));
    const r = await check(t);
    expect(r.code).toBe(1);
    const lines = r.stdout.trim().split("\n");
    const blocked = (f: string) => lines.some((l) => l.startsWith(f) && l.includes("blocked_by"));
    expect(blocked("02-b.md")).toBe(true);
    expect(blocked("03-c.md")).toBe(true);
    expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
    expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
  });

  test("30.5 a spec with no User stories heading is a malformed call", async () => {
    const t = w();
    await makeCard(t, "root");
    await makeCard(t, "card-a", { parent: "root", decided: true });
    t.write("spec.md", "# Spec\n\nNo stories here.\n");
    t.write("tickets/01-a.md", ticket({ cites: "card-a", stories: "1" }));
    const r = await check(t);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/User stories/);
    expect(r.stdout.trim()).toBe("");
  });
});
