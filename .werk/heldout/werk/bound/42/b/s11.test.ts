import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, ghost, link, mapOf, mk, open, type Project } from "./h.ts";

let p: Project | undefined;
afterEach(() => p?.dispose());

const rollupLine = (s: string) => s.split("\n").filter((x) => x.startsWith("rollup:"));

test("11.1 rollup counts card and refines subtree", async () => {
  const { project, werk } = mk([
    ...decided("root", { title: "Root" }),
    ...open("c1", { parent: "root", title: "C1" }),
    ...open("c2", { parent: "root", title: "C2", status: "proto" }),
    ...open("g", { parent: "c1", title: "G", status: "decided" }),
  ]);
  p = project;
  expect(mapOf(project).problems).toEqual([]);
  const out = (await werk("show", "root")).stdout;
  expect(rollupLine(out)).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
});

test("11.2 incoming refines link shows child's rollup", async () => {
  const { project, werk } = mk([
    ...decided("par", { title: "Parent" }),
    ...open("kid", { parent: "par", title: "Kid" }),
    ...open("g1", { parent: "kid", title: "G1" }),
    ...open("g2", { parent: "kid", title: "G2", status: "decided" }),
  ]);
  p = project;
  const out = (await werk("show", "par")).stdout;
  const line = out.split("\n").find((l) => l.includes("<- refines"));
  expect(line).toContain("kid");
  expect(line).toContain("rollup: 3 cards");
  expect(rollupLine(out)).toEqual(["rollup: 4 cards: 2 open, 0 proto, 2 decided"]);
});

function chat(project: Project) {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "exact verbatim words" })}\n`,
  );
}

test("11.3 options, say, ev sections", async () => {
  const { project, werk } = mk([
    ...open("other", { title: "Other" }),
    ...open("card", { title: "The card" }),
    link("card", "other", "depends_on"),
    ghost("opt", { kind: "option", title: "Plan B", why: "too slow" }),
    { type: "node.accepted", id: "opt", actor: "you" },
    link("opt", "card", "alternative_to"),
    ghost("src", { kind: "source", title: "The paper", why: "it finds X" }),
    link("card", "src", "supported_by"),
  ]);
  p = project;
  chat(project);
  expect((await werk("quote", "card", "talk", "exact verbatim words")).code).toBe(0);
  const out = (await werk("show", "card")).stdout;
  expect(mapOf(project).problems).toEqual([]);
  const iDep = out.indexOf("depends_on");
  const iOpt = out.indexOf("Options:");
  const iSay = out.indexOf("Say:");
  const iEv = out.indexOf("Ev:");
  expect(iDep).toBeGreaterThan(-1);
  expect(out).toContain("takes"); // reason of the link
  expect(iOpt).toBeGreaterThan(iDep);
  expect(out).toContain("Plan B");
  expect(out).toContain("why not: too slow");
  expect(iSay).toBeGreaterThan(-1);
  expect(out).toContain("person: exact verbatim words");
  expect(iEv).toBeGreaterThan(-1);
  const ev = out.slice(iEv);
  expect(ev).toContain("The paper");
  expect(ev).toContain("finding: it finds X");
  expect(ev).toContain("proposed");
});

test("11.4 no options, no Options section", async () => {
  const { project, werk } = mk([
    ...open("card", { title: "The card" }),
    ghost("src", { kind: "source", title: "The paper", why: "finding" }),
    link("card", "src", "supported_by"),
  ]);
  p = project;
  chat(project);
  await werk("quote", "card", "talk", "exact verbatim words");
  const out = (await werk("show", "card")).stdout;
  expect(out).toContain("Say:");
  expect(out).toContain("Ev:");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints root", async () => {
  const { project, werk } = mk([
    ...decided("root", { title: "The Root" }),
    ...open("second", { parent: "root", title: "Second" }),
  ]);
  p = project;
  const r = await werk("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The Root");
  expect(rollupLine(r.stdout).length).toBe(1);
  const line = r.stdout.split("\n").find((l) => l.includes("<- refines"));
  expect(line).toContain("second");
  expect(line).toContain("rollup: 1 cards");
});
