import { expect, test } from "bun:test";
import { lstatSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { make, repoCopy } from "./repo-copy.ts";
import { card, decided, project, seed } from "./helpers.ts";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { INSTRUCTIONS } from "../src/agent/prompt.ts";

const verbs = async () => {
  const p = project();
  return (await p.werk(["help"])).out;
};

test("19.1-19.4 a person can start a build pass, a chat agent or a sample from werk", async () => {
  // The steps need a user-facing way to start a build pass on a ticket, a chat message, or a sample.
  const help = await verbs();
  expect(help, "werk help lists a verb that starts a build pass").toMatch(/^\s{2}(build|run|pass)\b/m);
});

test("19.x probe: the prompt that the launcher seam would give each role", () => {
  const p = project();
  seed(p, [
    card("how", "Build rules"),
    card("rule-a", "Rule A title", { parent: "how" }),
    card("rule-b", "Rule B title", { parent: "how" }),
    card("rule-c", "Rule C title", { parent: "how" }),
    decided("how"),
    decided("rule-a"),
    decided("rule-b"),
    decided("rule-c"),
  ]);
  const werk = "/opt/werk/bin/werk";
  const builder = projectAgentArgs({ role: "builder", base: "BUILDER BASE PROMPT", project: p.dir }, werk);
  const prompt = builder[1] as string;
  expect(prompt.startsWith("BUILDER BASE PROMPT")).toBe(true);
  expect(prompt).toContain(INSTRUCTIONS.split("\n")[0] as string);
  expect(prompt).toContain(werk);
  expect(prompt).not.toContain("{{werk}}");
  for (const t of ["Rule A title", "Rule B title", "Rule C title"]) expect(prompt.indexOf(t)).toBeGreaterThan(prompt.indexOf("# werk"));
  const agents = JSON.parse(builder[builder.indexOf("--agents") + 1] as string);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  expect(JSON.stringify(agents)).toContain(werk);
  const sample = projectAgentArgs({ role: "sample", base: "SAMPLE BASE", project: p.dir }, werk);
  expect(sample[1]).not.toContain(INSTRUCTIONS.split("\n")[0] as string);
  expect(sample[1]).not.toContain("Rule A title");
  const chat = projectAgentArgs({ role: "chat", base: "CHAT BASE", project: p.dir }, werk);
  expect(chat[1]).toContain(INSTRUCTIONS.split("\n")[0] as string);
  expect(chat[1]).toContain("Rule A title");
});

test("19.5 the repository check catches a subagent copy that replaces its link", () => {
  const dir = repoCopy();
  const link = join(dir, ".claude", "agents", "test-scope.md");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  const base = make(dir, "test");
  expect(base.code, base.out.slice(-3000)).toBe(0);
  const text = readFileSync(link, "utf8");
  rmSync(link);
  writeFileSync(link, text);
  const broken = make(dir, "test");
  expect(broken.code).not.toBe(0);
  expect(broken.out).toContain("test-scope");
  rmSync(link);
  symlinkSync(join("..", "..", "src", "agent", "subagents", "test-scope.md"), link);
  const fixed = make(dir, "test");
  expect(fixed.code, fixed.out.slice(-3000)).toBe(0);
}, 900000);
