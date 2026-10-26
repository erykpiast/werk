import { expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decided, ghost, open } from "../src/map/mark-fixtures.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { type Ctx, t } from "./helpers.ts";

const write = (ctx: Ctx, path: string, text: string) => {
  const full = join(ctx.project().dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const check = (ctx: Ctx) => ctx.werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
// The root is decided first so its children can be decided, then reopened so only the children count.
const reopenRoot = { type: "node.reopened", id: "root", reason: "postponed", at: "2026-10-10T09:00:00.000Z" };
const lastLine = (s: string) => s.trim().split("\n").pop() as string;
const SPEC2 = "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";

t("30.1 a folder of correct tickets passes", async (ctx) => {
  ctx.seed(
    ...decided("root", { title: "Root" }),
    ...decided("a", { parent: "root", title: "A" }),
    ...decided("b", { parent: "root", title: "B" }),
    reopenRoot,
  );
  write(ctx, "spec.md", SPEC2);
  write(ctx, "tickets/01-first.md", ticket({ cites: "a", stories: "1" }));
  write(ctx, "tickets/02-second.md", ticket({ cites: "b", stories: "2", blockedBy: "1" }));
  const r = await check(ctx);
  expect(r.stdout.trim().split("\n")).toHaveLength(1);
  expect(lastLine(r.stdout)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

t("30.2 own-check failures name the ticket, the check and the field", async (ctx) => {
  ctx.seed(...open("root", { title: "Root", status: "proto" }));
  write(ctx, "spec.md", "## User stories\n\n1. a\n");
  write(ctx, "tickets/01-ok.md", ticket({ cites: "", stories: "1" }));
  write(ctx, "tickets/02-path.md", ticket({ what: "Do a thing.\nAnd another.\nAnd more.\nEdit src/loop.ts now.", cites: "" }));
  write(ctx, "tickets/03-notouch.md", ticket({ touches: null, cites: "" }));
  const r = await check(ctx);
  const lines = r.stdout.trim().split("\n");
  expect(lines.some((l) => l.includes("02-path") && /file-paths|no-file-paths/.test(l) && l.includes("src/loop.ts") && l.includes("12"))).toBe(true);
  expect(lines.some((l) => l.includes("03-notouch") && /shape/.test(l) && l.includes("touches"))).toBe(true);
  expect(lines.some((l) => l.includes("01-ok"))).toBe(false);
  expect(lastLine(r.stdout)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

t("30.3 an uncited decided card fails the set and a ghost does not count", async (ctx) => {
  ctx.seed(
    ...decided("root", { title: "Root" }),
    ...decided("cited", { parent: "root", title: "Cited" }),
    ...decided("uncited", { parent: "root", title: "Uncited" }),
    ghost("ghosty", { parent: "root", title: "Ghosty" }),
    { type: "node.edited", id: "ghosty", who: "me", noBasis: "t" },
    { type: "criterion.added", id: "ghosty", form: "revisit" },
    { type: "node.decided", id: "ghosty" },
    reopenRoot,
  );
  write(ctx, "spec.md", "## User stories\n\n1. a\n");
  write(ctx, "tickets/01-a.md", ticket({ cites: "root, cited", stories: "1" }));
  const r = await check(ctx);
  const set = r.stdout.trim().split("\n").filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("uncited");
  expect(r.stdout).not.toContain("ghosty");
  expect(lastLine(r.stdout)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

t("30.4 a cycle in blocked_by names only the tickets on the cycle", async (ctx) => {
  ctx.seed(...decided("root", { title: "Root" }), ...decided("d", { parent: "root", title: "D" }), reopenRoot);
  write(ctx, "spec.md", "## User stories\n\n1. a\n");
  write(ctx, "tickets/01-a.md", ticket({ cites: "d", stories: "1", blockedBy: "" }));
  write(ctx, "tickets/02-b.md", ticket({ cites: "d", stories: "1", blockedBy: "3" }));
  write(ctx, "tickets/03-c.md", ticket({ cites: "d", stories: "1", blockedBy: "2" }));
  write(ctx, "tickets/04-d.md", ticket({ cites: "d", stories: "1", blockedBy: "3" }));
  const r = await check(ctx);
  const lines = r.stdout.trim().split("\n");
  const bl = (n: string) => lines.some((l) => l.includes(`${n}-`) && l.includes("blocked_by"));
  expect(bl("02")).toBe(true);
  expect(bl("03")).toBe(true);
  expect(lines.some((l) => l.startsWith("01-"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-"))).toBe(false);
  expect(r.code).toBe(1);
});

t("30.5 a spec with no User stories heading is a malformed call", async (ctx) => {
  ctx.seed(...decided("root", { title: "Root" }), ...decided("d", { parent: "root", title: "D" }), reopenRoot);
  write(ctx, "spec.md", "# Spec\n\nNothing here.\n");
  write(ctx, "tickets/01-a.md", ticket({ cites: "d", stories: "1" }));
  const r = await check(ctx);
  expect(r.stderr + r.stdout).toMatch(/no "?User stories"? heading/);
  expect(r.stdout).not.toMatch(/\d+ tickets,/);
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});
