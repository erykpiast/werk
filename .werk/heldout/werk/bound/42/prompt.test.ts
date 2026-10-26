import { expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { currentWerkCommand } from "../src/own/running.ts";
import { mk } from "./h.ts";

const CHECKOUT = join(import.meta.dir, "..");
const BASE = "You are the build agent. Build the ticket below.";
const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;
const agentsOf = (args: string[]) => JSON.parse(args[args.indexOf("--agents") + 1] as string) as Record<string, { prompt: string }>;

function rules(h: ReturnType<typeof mk>, n: number) {
  h.real("root", "Root");
  h.seed("node.added", { id: "how", kind: "card", title: "How it is built", status: "decided" });
  const titles = ["Tests hit a real database", "Money is stored in cents", "A deploy is one tag"].slice(0, n);
  titles.forEach((t, i) => h.seed("node.added", { id: `rule${i}`, kind: "card", title: t, parent: "how", status: "decided" }));
  return titles;
}

test("[19.1] a build pass in another project: instructions, subagents, rule titles", () => {
  const h = mk();
  const titles = rules(h, 3);
  const args = projectAgentArgs({ role: "builder", base: BASE, project: h.p.dir });
  const prompt = promptOf(args);
  expect(prompt.startsWith(`${BASE}\n\n`)).toBe(true);
  const after = prompt.slice(BASE.length);
  expect(after).toContain("how to work with the decision map");
  const werk = currentWerkCommand();
  console.log("WERK COMMAND:", werk);
  expect(werk).toContain(CHECKOUT);
  expect(after).toContain(werk);
  expect(after).not.toContain("{{werk}}");
  expect(after).not.toMatch(/#(werk|st|lp|vi|pr|al|ms)-[a-z]/);
  const iInstr = prompt.indexOf("how to work with the decision map");
  for (const t of titles) expect(prompt.indexOf(t)).toBeGreaterThan(iInstr);
  const agents = agentsOf(args);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const a of Object.values(agents)) {
    expect(a.prompt).toContain(werk);
    expect(a.prompt).not.toContain("{{werk}}");
  }
});

test("[19.2] chat agent gets the instructions and titles; the sample agent gets neither", async () => {
  const h = mk();
  const titles = rules(h, 3);
  h.p.script({ roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m", content: [{ type: "text", text: "hi" }] } } }]] } } });
  // the real chat launch: a server child plus a message through the page's route is covered by the e2e; here the launch arguments
  const chatArgs = projectAgentArgs({ role: "chat", base: "You chat.", project: h.p.dir });
  const chat = promptOf(chatArgs);
  expect(chat).toContain("how to work with the decision map");
  for (const t of titles) expect(chat).toContain(t);
  const sample = projectAgentArgs({ role: "sample", base: "You sample.", project: h.p.dir });
  expect(promptOf(sample)).not.toContain("how to work with the decision map");
  expect(promptOf(sample)).not.toMatch(/build rules/i);
  for (const t of titles) expect(promptOf(sample)).not.toContain(t);
});

test("[19.3] no build rules, no title list", () => {
  const h = mk();
  h.real("root", "Root");
  h.seed("node.added", { id: "how", kind: "card", title: "How it is built", status: "decided" });
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: h.p.dir }));
  expect(prompt).toContain("how to work with the decision map");
  expect(prompt).not.toMatch(/build rules/i);
});

test("[19.4] in werk's own checkout the instructions appear one time", () => {
  const h = mk();
  const titles = rules(h, 3);
  const agents = readFileSync(join(CHECKOUT, "AGENTS.md"), "utf8");
  writeFileSync(join(h.p.dir, "AGENTS.md"), agents);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: h.p.dir }));
  const instructions = readFileSync(join(CHECKOUT, "src/agent/instructions.md"), "utf8");
  const marker = "how to work with the decision map";
  // the whole context Claude Code reads: the appended prompt plus AGENTS.md with its @-include expanded
  const includes = agents.split("\n").filter((l) => l.trim() === "@src/agent/instructions.md").length;
  const inPrompt = prompt.split(marker).length - 1;
  const inInclude = includes * (instructions.split(marker).length - 1);
  console.log("in prompt", inPrompt, "via AGENTS.md include", inInclude);
  expect(inPrompt + inInclude).toBe(1);
  for (const t of titles) expect(prompt).toContain(t);
  expect(prompt.indexOf("This project's build rules")).toBeGreaterThan(-1);
});
