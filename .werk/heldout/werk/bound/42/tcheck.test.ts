import { expect, test } from "bun:test";
import { join, mk, mkdirSync, writeFileSync } from "./h.ts";

const all = (r: { out: string; err: string }) => r.out + r.err;

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n\n## Seams\n\nNone.\n`;

const ticket = (o: { title?: string; cites: string; blocked?: string; stories: string; checks?: string; extra?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}\nblocked_by: ${o.blocked ?? ""}\nstories: ${o.stories}\ntouches: map view\n\n## What to build\n\nA person does the thing.${o.extra ?? ""}\n\n## Acceptance criteria\n\n- [ ] The thing is done.\n\n## Checks\n\n${o.checks ?? ""}\n`;

function setup(nStories: number, ghost = false) {
  const h = mk();
  h.real("croot", "Croot");
  h.real("d1", "Decided one", "croot");
  h.real("d2", "Decided two", "croot");
  h.decide("croot");
  h.decide("d1");
  h.decide("d2");
  if (ghost) {
    h.seed("node.proposed", { id: "gh", kind: "card", title: "Ghost card", parent: "croot" }, "agent");
  }
  writeFileSync(join(h.p.dir, "spec.md"), spec(nStories));
  mkdirSync(join(h.p.dir, "tickets"));
  const put = (name: string, text: string) => writeFileSync(join(h.p.dir, "tickets", name), text);
  const run = (...extra: string[]) => h.w("ticket-check", "tickets", "--root", "croot", "--spec", "spec.md", ...extra);
  return { h, put, run };
}

test("[26.1] valid tickets pass", async () => {
  const { put, run } = setup(2);
  put("01-a.md", ticket({ title: "First", cites: "croot, d1", stories: "1", checks: "- `make test`" }));
  put("02-b.md", ticket({ title: "Second", cites: "#d2", blocked: "1", stories: "2" }));
  const r = await run();
  console.log(all(r));
  expect(r.code).toBe(0);
  const lines = r.out.split("\n").filter(Boolean);
  expect(lines.length).toBe(1);
  expect(lines[0]).toMatch(/\b0 failures\b/);
});

test("[26.2] file path and oversized ticket", async () => {
  const { put, run } = setup(2);
  put("01-a.md", ticket({ title: "First", cites: "croot, d1", stories: "1", checks: "- `make test`" }));
  put("02-b.md", ticket({ title: "Second", cites: "#d2", blocked: "1", stories: "2" }));
  expect((await run()).code).toBe(0);
  // line 9 is the first line of What to build's text
  const t1 = ticket({ title: "First", cites: "croot, d1", stories: "1", checks: "- `make test`" }).split("\n");
  t1[8] = "Edit src/loop.ts and also Makefile.";
  put("01-a.md", t1.join("\n"));
  put("02-b.md", ticket({ title: "Second", cites: "#d2", blocked: "1", stories: "2", extra: `\n\n${"padding words here. ".repeat(250)}` }));
  const r = await run();
  console.log(all(r));
  expect(r.code).toBe(1);
  const lines = all(r).split("\n");
  const l1 = lines.find((l) => l.startsWith("01-a.md"));
  expect(l1).toBeTruthy();
  expect(l1).toContain("no-file-paths");
  expect(l1).toContain("src/loop.ts");
  expect(l1).toMatch(/line 9|:9\b|\b9\b/);
  expect(lines.some((l) => l.includes("Makefile"))).toBe(false);
  const l2 = lines.find((l) => l.startsWith("02-b.md"));
  expect(l2).toBeTruthy();
  expect(l2).toMatch(/size/);
  expect(lines.at(-2) ?? "").toMatch(/failure/);
});

test("[26.3] set checks: uncited card, missing story, cycle, not the ghost", async () => {
  const { put, run } = setup(3, true);
  put("01-a.md", ticket({ title: "First", cites: "croot, d1", stories: "1" }));
  put("02-b.md", ticket({ title: "Second", cites: "croot", blocked: "3", stories: "2" }));
  put("03-c.md", ticket({ title: "Third", cites: "croot", blocked: "2", stories: "2" }));
  const r = await run();
  console.log(all(r));
  expect(r.code).toBe(1);
  const lines = all(r).split("\n");
  const setLines = lines.filter((l) => l.startsWith("ticket set"));
  console.log(setLines);
  expect(setLines.filter((l) => /cards-cited/.test(l) && l.includes("d2")).length).toBe(1);
  expect(setLines.filter((l) => /stories/.test(l) && /\b3\b/.test(l)).length).toBe(1);
  expect(lines.some((l) => /blocked_by/.test(l) && /02/.test(l) && /03/.test(l))).toBe(true);
  expect(all(r)).not.toContain("gh");
  expect(all(r)).not.toContain("Ghost card");
});

test("[26.4] ticket with no title fails alone", async () => {
  const h = mk();
  h.real("croot", "Croot");
  h.real("d1", "Decided one", "croot");
  h.decide("croot");
  h.decide("d1");
  writeFileSync(join(h.p.dir, "spec.md"), spec(1));
  mkdirSync(join(h.p.dir, "tickets"));
  writeFileSync(join(h.p.dir, "tickets", "01-a.md"), ticket({ cites: "d1", stories: "1" }));
  const r = await h.w("ticket-check", "tickets", "--root", "croot", "--spec", "spec.md");
  console.log(all(r));
  expect(r.code).toBe(1);
  const lines = all(r).split("\n");
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  const sets = lines.filter((l) => l.startsWith("ticket set"));
  expect(sets.some((l) => l.includes("d1"))).toBe(true);
  expect(sets.some((l) => /stor/.test(l))).toBe(true);
});

test("[26.5] malformed calls exit 2", async () => {
  const { h, put } = setup(2);
  put("01-a.md", ticket({ title: "First", cites: "croot, d1", stories: "1" }));
  const a = await h.w("ticket-check", "tickets", "--root", "croot", "--spec", "nope.md");
  console.log(all(a));
  expect(a.code).toBe(2);
  expect(all(a)).toMatch(/spec/i);
  expect(all(a)).toMatch(/no spec file|missing|not found|no such|does not exist/i);
  writeFileSync(join(h.p.dir, "nostories.md"), "# Spec\n\nNothing here.\n");
  const b = await h.w("ticket-check", "tickets", "--root", "croot", "--spec", "nostories.md");
  console.log(all(b));
  expect(b.code).toBe(2);
  const c = await h.w("ticket-check", "tickets", "--root", "ghostroot", "--spec", "spec.md");
  console.log(all(c));
  expect(c.code).toBe(2);
  const d = await h.w("ticket-check", "tickets", "--spec", "spec.md");
  console.log(all(d));
  expect(d.code).toBe(2);
});
