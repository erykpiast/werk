// A build pass, a chat agent and a sample agent each start the agent (the fake `claude` on PATH),
// and the test reads the prompt it started with from the fake's launch record.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, type Held, held } from "./helpers.ts";

const INSTRUCTIONS = readFileSync(join(import.meta.dir, "..", "src", "agent", "instructions.md"), "utf8");
const INSTRUCTIONS_HEAD = "# werk — how to work with the decision map";

function ticketFolder(h: Held): string {
  mkdirSync(join(h.dir, "tickets"), { recursive: true });
  const file = join(h.dir, "tickets", "01-export.md");
  writeFileSync(
    file,
    "title: Export writes one file\ncites: export\nblocked_by:\nstories: 1\ntouches: export\n\n## What to build\n\nAn export.\n\n## Acceptance criteria\n\n- [ ] One file.\n\n## Checks\n",
  );
  return file;
}

/** The person starts a build pass on a ticket, and the prompt of the agent it launched. */
async function buildPass(
  h: Held,
): Promise<{ run: Awaited<ReturnType<Held["werk"]>>; prompt?: string; agents?: string }> {
  h.script({ roles: {} });
  const file = ticketFolder(h);
  const run = await h.w("build", file);
  const launch = h.launches()[0];
  const args = launch?.args ?? [];
  const at = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  return { run, prompt: at("--append-system-prompt"), agents: at("--agents") };
}

function rules(h: Held, children: number): void {
  card(h, "export", "Export", {}, true);
  card(h, "how", "How this project is built", {}, true);
  for (let i = 1; i <= children; i++) card(h, `rule-${i}`, `Build rule number ${i}`, { parent: "how" }, true);
}

test("19.1 a build pass in another project starts with the werk instructions, its subagents and the build-rule titles", async () => {
  const h = held();
  rules(h, 3);
  const { run, prompt, agents } = await buildPass(h);
  expect(run.code, `werk build: ${run.err}`).toBe(0);
  expect(prompt).toBeDefined();
  const text = prompt as string;
  expect(text.indexOf(INSTRUCTIONS_HEAD)).toBeGreaterThan(0);
  expect(text).not.toContain("{{werk}}");
  expect(text).not.toMatch(/#werk-[a-z]/);
  const after = text.indexOf(INSTRUCTIONS_HEAD);
  for (let i = 1; i <= 3; i++) expect(text.indexOf(`Build rule number ${i}`)).toBeGreaterThan(after);
  expect(agents).toContain("test-scope");
  expect(agents).toContain("prototyper");
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const h = held();
  rules(h, 2);
  h.script({ roles: {} });
  // The chat pane and the sample of options have no command-line form; the server is the only entry.
  const help = await h.w("help");
  expect(help.out).toMatch(/^\s+(chat|sample)\b/m);
});

test("19.3 a project with no build rules gets no title list", async () => {
  const h = held();
  rules(h, 0);
  const { run, prompt } = await buildPass(h);
  expect(run.code, `werk build: ${run.err}`).toBe(0);
  expect(prompt).toContain(INSTRUCTIONS_HEAD);
  expect(prompt).not.toContain("build rules");
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const h = held();
  rules(h, 2);
  writeFileSync(join(h.dir, "AGENTS.md"), `# Working on werk\n\n@src/agent/instructions.md\n`);
  mkdirSync(join(h.dir, "src", "agent"), { recursive: true });
  writeFileSync(join(h.dir, "src", "agent", "instructions.md"), INSTRUCTIONS);
  const { run, prompt } = await buildPass(h);
  expect(run.code, `werk build: ${run.err}`).toBe(0);
  const text = prompt ?? "";
  const count = text.split(INSTRUCTIONS_HEAD).length - 1;
  expect(count).toBeLessThanOrEqual(1);
  expect(text.indexOf("Build rule number 1")).toBeGreaterThan(0);
});
