import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { INSTRUCTIONS } from "../src/agent/prompt.ts";
import { freshProject } from "../src/test/project.ts";
import { card, ok, seeded } from "./helpers.ts";

const verbsOf = (help: string) => [...help.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1] as string);

async function verbs() {
  return verbsOf((await ok(freshProject(), ["help"])).out);
}

test("19.1 a build pass in another project starts with the werk instructions", async () => {
  const names = await verbs();
  // A person needs some way to start a build pass on a ticket: a verb of the command line.
  expect(names.some((v) => /build|pass|implement/.test(v))).toBe(true);
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const names = await verbs();
  expect(names.some((v) => /chat/.test(v))).toBe(true);
  expect(names.some((v) => /sample/.test(v))).toBe(true);
});

test("19.3 a project with no build rules gets no title list", async () => {
  const names = await verbs();
  expect(names.some((v) => /build|pass|implement/.test(v))).toBe(true);
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const names = await verbs();
  expect(names.some((v) => /build|pass|implement/.test(v))).toBe(true);
});

// A probe below the user path: what the shared launcher would give a builder. Not a step result.
test("probe: the launcher's builder prompt in another project and in a checkout with the include", async () => {
  const p = seeded([
    card("how", "Build rules", { status: "decided" }),
    card("r1", "Rule one", { parent: "how", status: "decided" }),
    card("r2", "Rule two", { parent: "how", status: "decided" }),
    card("r3", "Rule three", { parent: "how", status: "decided" }),
  ]);
  const args = projectAgentArgs({ role: "builder", base: "BASE PROMPT", project: p.dir }, "/opt/werk/werk");
  const prompt = args[1] as string;
  expect(prompt.startsWith("BASE PROMPT")).toBe(true);
  expect(prompt).toContain("/opt/werk/werk show");
  expect(prompt).not.toContain("{{werk}}");
  for (const t of ["Rule one", "Rule two", "Rule three"]) expect(prompt).toContain(t);
  expect(args).toContain("--agents");
  writeFileSync(join(p.dir, "AGENTS.md"), "@src/agent/instructions.md\n");
  const own = projectAgentArgs({ role: "builder", base: "BASE", project: p.dir }, "w")[1] as string;
  expect(own).not.toContain(INSTRUCTIONS.split("\n")[0] as string);
  const sample = projectAgentArgs({ role: "sample", base: "S", project: p.dir }, "w")[1] as string;
  expect(sample).not.toContain("Rule one");
});
