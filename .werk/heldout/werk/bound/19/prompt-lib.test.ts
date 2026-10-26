// Detail for step 19 (1-4): what the prompt library gives, since no command starts an agent.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { agentArgs, INSTRUCTIONS, systemPrompt } from "../src/agent/prompt.ts";
import { fold } from "../src/map/fold.ts";

const line = (seq: number, payload: object) => JSON.stringify({ seq, at: "2026-01-01T00:00:00Z", actor: "you", type: "node.added", payload });
const withRules = (n: number) =>
  fold(
    [line(1, { id: "how", kind: "card", title: "How" }),
      ...Array.from({ length: n }, (_, i) => line(i + 2, { id: `r${i}`, kind: "card", title: `Rule ${i} holds`, parent: "how", status: "decided" }))].join("\n") + "\n",
  );
const W = "/opt/werk/bin/werk";

test("19 lib", () => {
  const b = systemPrompt({ role: "builder", base: "BUILD BASE", werk: W, map: withRules(3) });
  expect(b.startsWith("BUILD BASE\n")).toBe(true);
  expect(b).toContain(`${W} add`);
  expect(b).not.toContain("{{werk}}");
  console.log("werk card ids in shipped text:", INSTRUCTIONS.match(/#werk-[\w-]+/g));
  for (let i = 0; i < 3; i++) expect(b.indexOf(`Rule ${i} holds`)).toBeGreaterThan(b.indexOf("Classify a module"));
  const args = agentArgs({ role: "builder", base: "x", werk: W, map: withRules(3) });
  const agents = JSON.parse(args[3] as string);
  console.log(Object.keys(agents), agents["test-scope"].prompt.includes(W), agents.prototyper.prompt.includes(W));
  const s = systemPrompt({ role: "sample", base: "S", werk: W, map: withRules(2) });
  console.log("sample has instructions:", s.includes("decision map"), "sample has rule titles:", s.includes("Rule 0 holds"));
  const e = systemPrompt({ role: "builder", base: "B", werk: W, map: withRules(0) });
  console.log("no rules: has instructions", e.includes("decision map"), "has list", e.includes("build rules"));
  const own = readFileSync(`${import.meta.dir}/../AGENTS.md`, "utf8");
  const o = systemPrompt({ role: "builder", base: "B", werk: W, map: withRules(2), projectInstructions: own });
  console.log("own checkout: instruction copies in prompt", o.split("# werk — how to work with the decision map").length - 1, "titles", o.includes("Rule 1 holds"));
});
