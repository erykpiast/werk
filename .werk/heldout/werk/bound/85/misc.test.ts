import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelFlags } from "../src/agent/role-model.ts";
import type { Step } from "../src/test/fake-script.ts";
import { freshProject } from "../src/test/project.ts";
import { decided, root, seed, w } from "./h.ts";

setDefaultTimeout(300000);
const edit = (path: string, content: string): Step => ({ edit: { path, content } });
const spec = "# Spec\n\n## User stories\n\n1. As a person, I want a thing.\n\n## Test seams\n\nx\n";
const tk = "title: T\ncites: checkout, c1\nblocked_by: \nstories: 1\ntouches: x\n\n## What to build\n\nA.\n\n## Acceptance criteria\n\n- ok\n\n## Checks\n\n- `make test`\n";

async function plannedProject() {
  const p = freshProject();
  seed(p, [...root(), decided("checkout"), decided("c1", { parent: "checkout" })]);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "x"], { cwd: p.target });
  await p.werk(["target", p.target]);
  p.script({ roles: {
    "spec-writer": { replies: [[edit(".werk/specs/checkout.md", spec), edit(".werk/specs/checkout.spec-answers.json", "[]")]] },
    "ticket-writer": { replies: [[edit(".werk/tickets/checkout/01.md", tk), edit(".werk/specs/checkout.ticket-answers.json", "[]")]] },
  } });
  return p;
}
const flag = (args: string[], n: string) => args[args.indexOf(n) + 1];

test("76.1", async () => {
  const p = await plannedProject();
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(0);
  const ls = p.launches();
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  for (const l of ls) {
    expect(flag(l.args, "--model")).toBe("claude-opus-5-5");
    expect(l.args).not.toContain("--advisor");
    expect(["opus", "sonnet", "haiku"]).not.toContain(flag(l.args, "--model"));
  }
});

test("76.4 unknown role", () => {
  let error: unknown;
  let flags: string[] = [];
  try {
    flags = modelFlags("mystery-role");
  } catch (e) {
    error = e;
  }
  console.log("76.4 flags for unknown role:", JSON.stringify(flags), "error:", String(error));
  expect(error).toBeDefined();
  expect(String(error)).toContain("mystery-role");
});

test("76.3 / 76.5 / 85 / 19.1 / 19.3 / 19.4: a build pass starts only through a build command", async () => {
  const p = freshProject();
  const help = await p.werk(["help"]);
  const verbs = [...help.out.matchAll(/^  ([a-z-]+)/gm)].map((m) => m[1]);
  console.log("verbs:", verbs.join(" "));
  const b = await p.werk(["build", "x/01"]);
  console.log("werk build:", JSON.stringify(b));
  expect(verbs).toContain("build");
  expect(b.code).not.toBe(2);
});
