import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentArgs, INSTRUCTIONS, subagentsFor, systemPrompt } from "../src/agent/prompt.ts";
import { fold } from "../src/map/fold.ts";
import { card, ok, withMap } from "./helpers.ts";

const evt = (seq: number, type: string, payload: object) => JSON.stringify({ seq, at: "t", actor: "you", type, payload });
const mapWith = (rules: string[]) =>
  fold(
    [
      evt(1, "node.added", { id: "how", kind: "card", title: "How", status: "decided" }),
      ...rules.map((r, i) => evt(i + 2, "node.added", { id: `rule-${i}`, kind: "card", title: r, parent: "how", status: "decided" })),
    ].join("\n") + "\n",
  );

test("19.x a person can start a build pass, a chat agent and a sample from werk", async () => {
  const p = withMap([card("how", "How")]);
  const help = (await ok(p, ["help"])).out;
  const verbs = help.split("\n").filter((l) => /^  [a-z]/.test(l)).map((l) => l.trim().split(/\s/)[0]);
  console.log("verbs:", verbs.join(" "));
  expect(verbs.some((v) => /^(build|chat|sample|serve)$/.test(v ?? ""))).toBe(true);
});

const BASE = "You are the build agent. Build the ticket.";
const WERK = "/opt/werk/bin/bun /opt/werk/src/cli.ts";

test("19.1 library: a builder prompt in another project", () => {
  const map = mapWith(["Rule one", "Rule two", "Rule three"]);
  const prompt = systemPrompt({ role: "builder", base: BASE, werk: WERK, map });
  expect(prompt.startsWith(BASE)).toBe(true);
  const iInstr = prompt.indexOf("# werk — how to work with the decision map");
  expect(iInstr).toBeGreaterThan(BASE.length - 1);
  expect(prompt).toContain(`${WERK} add`);
  expect(prompt).not.toContain("{{werk}}");
  const instr = prompt.slice(iInstr, prompt.indexOf("## This project's build rules"));
  const ownIds = readFileSync(join(import.meta.dir, "..", "AGENTS.md"), "utf8"); // werk's own card ids appear as #werk-...
  expect(instr).not.toMatch(/#werk-[a-z]/);
  void ownIds;
  for (const t of ["Rule one", "Rule two", "Rule three"]) expect(prompt.indexOf(t)).toBeGreaterThan(iInstr);
  const subs = subagentsFor({ role: "builder", base: BASE, werk: WERK, map }) ?? {};
  expect(Object.keys(subs).sort()).toEqual(["prototyper", "test-scope"]);
  for (const s of Object.values(subs)) expect(s.prompt).toContain(WERK);
  expect(agentArgs({ role: "builder", base: BASE, werk: WERK, map })).toContain("--agents");
});

test("19.2 library: chat gets the instructions, sample does not", () => {
  const map = mapWith(["Rule one"]);
  const chat = systemPrompt({ role: "chat", base: "chat", werk: WERK, map });
  expect(chat).toContain("# werk — how to work with the decision map");
  expect(chat).toContain("Rule one");
  const sample = systemPrompt({ role: "sample", base: "sample", werk: WERK, map });
  expect(sample).not.toContain("# werk — how to work with the decision map");
  expect(sample).not.toContain("Rule one");
});

test("19.3 library: no build rules, no title list", () => {
  const map = mapWith([]);
  const prompt = systemPrompt({ role: "builder", base: BASE, werk: WERK, map });
  expect(prompt).toContain("# werk — how to work with the decision map");
  expect(prompt).not.toContain("build rules");
});

test("19.4 library: werk's own checkout gets the instructions one time", () => {
  const map = mapWith(["Rule one"]);
  const agents = readFileSync(join(import.meta.dir, "..", "AGENTS.md"), "utf8");
  // In the checkout, Claude Code itself expands the @include of AGENTS.md; model that expansion.
  const expanded = agents.replace("@src/agent/instructions.md", INSTRUCTIONS);
  const prompt = systemPrompt({ role: "builder", base: BASE, werk: WERK, map, projectInstructions: agents });
  const whole = `${expanded}\n${prompt}`;
  expect(whole.split("# werk — how to work with the decision map").length - 1).toBe(1);
  expect(whole.indexOf("Rule one")).toBeGreaterThan(whole.indexOf("# werk — how to work with the decision map"));
});
