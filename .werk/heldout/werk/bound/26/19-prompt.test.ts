// 19.1-19.4: the person starts a build pass, a chat, or a sample. The test looks for the command
// line verb that starts each, then records what the prompt module gives each agent role.
import { expect, test } from "bun:test";
import { fold } from "../src/map/fold.ts";
import { INSTRUCTIONS, systemPrompt, subagentsFor } from "../src/agent/prompt.ts";
import { freshProject } from "./helpers.ts";

const STARTERS = ["build", "chat", "sample", "serve", "plan"];

async function startVerbs(): Promise<string[]> {
  const p = freshProject();
  const help = await p.werk(["help"]);
  return STARTERS.filter((verb) => new RegExp(`^  ${verb}\\b`, "m").test(help.out));
}

function mapWithRules(children: number) {
  const ev = [
    { type: "node.added", payload: { id: "how", kind: "card", title: "How we build" } },
    ...Array.from({ length: children }, (_, i) => ({ type: "node.added", payload: { id: `rule-${i}`, kind: "card", title: `Rule ${i} title`, parent: "how" } })),
    { type: "node.decided", payload: { id: "how" } },
    ...Array.from({ length: children }, (_, i) => ({ type: "node.decided", payload: { id: `rule-${i}` } })),
  ];
  return fold(ev.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })).join("\n") + "\n");
}

test("19.1 a build pass in another project starts with the werk instructions", async () => {
  const verbs = await startVerbs();
  console.log("19.1 verbs that start an agent:", verbs);
  const prompt = systemPrompt({ role: "builder", base: "BUILDER BASE", werk: "/opt/werk/bin/werk", map: mapWithRules(3) });
  console.log("19.1 prompt module (builder): starts with base:", prompt.startsWith("BUILDER BASE"), "has rules:", prompt.includes("Rule 2 title"), "subagents:", Object.keys(subagentsFor({ role: "builder", base: "", werk: "/opt/werk/bin/werk", map: mapWithRules(3) }) ?? {}));
  expect(verbs).toContain("build");
});

test("19.2 a chat agent gets the instructions, a sample agent does not", async () => {
  const verbs = await startVerbs();
  console.log("19.2 verbs that start an agent:", verbs);
  const map = mapWithRules(2);
  const chat = systemPrompt({ role: "chat", base: "CHAT", werk: "werk", map });
  const sample = systemPrompt({ role: "sample", base: "SAMPLE", werk: "werk", map });
  console.log("19.2 prompt module: chat has instructions:", chat.includes(INSTRUCTIONS.slice(0, 60)), "chat has rules:", chat.includes("Rule 1 title"), "sample has instructions:", sample.includes(INSTRUCTIONS.slice(0, 60)), "sample has rules:", sample.includes("Rule 1 title"));
  expect(verbs).toContain("chat");
  expect(verbs).toContain("sample");
  expect(sample).not.toContain("Rule 1 title");
});

test("19.3 a project with no build rules gets no title list", async () => {
  const verbs = await startVerbs();
  const prompt = systemPrompt({ role: "builder", base: "B", werk: "werk", map: mapWithRules(0) });
  console.log("19.3 prompt module: has instructions:", prompt.includes(INSTRUCTIONS.slice(0, 60)), "has rules heading:", prompt.includes("build rules"));
  expect(verbs).toContain("build");
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const verbs = await startVerbs();
  const prompt = systemPrompt({ role: "builder", base: "B", werk: "werk", map: mapWithRules(2), projectInstructions: "# x\n@src/agent/instructions.md\n" });
  console.log("19.4 prompt module: instructions inside prompt:", prompt.includes(INSTRUCTIONS.slice(0, 60)), "(expected false: the AGENTS.md include supplies them)");
  expect(verbs).toContain("build");
});
