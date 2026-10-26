import { expect, test } from "bun:test";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentWerk, projectAgentArgs } from "../src/agent/launch.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const WERK = "/opt/werk-home/bun /opt/werk-home/src/cli.ts";
const BASE = "You are the build agent. Build the ticket below.";
const HEAD = "## This project's build rules";
const ROOT = join(import.meta.dir, "..");

type Card = { id: string; parent?: string; title?: string };
function writeMap(project: Project, cards: Card[]): void {
  const lines = cards.map(({ id, parent, title }, i) =>
    JSON.stringify({ seq: i + 1, at: "t", type: "node.added", actor: "agent", payload: { kind: "card", id, parent, title: title ?? `Title of ${id}`, status: "decided" } }),
  );
  writeFileSync(join(project.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}
const RULES: Card[] = [
  { id: "root" },
  { id: "how", parent: "root", title: "How the shop is built" },
  { id: "db", parent: "how", title: "Tests run against a real database" },
  { id: "money", parent: "how", title: "Money is stored in cents" },
  { id: "deploy", parent: "how", title: "A deploy is one tagged commit" },
];
const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;
const agentsOf = (args: string[]) => JSON.parse(args[args.indexOf("--agents") + 1] as string) as Record<string, { prompt: string }>;
const instructions = readFileSync(join(ROOT, "src/agent/instructions.md"), "utf8");

test("19.1 build pass in another project", () => {
  const project = freshProject();
  writeMap(project, RULES);
  const args = projectAgentArgs({ role: "builder", base: BASE, project: project.dir }); // real currentWerk()
  const prompt = promptOf(args);
  expect(prompt.startsWith(BASE)).toBe(true);
  const at = prompt.indexOf("# werk — how to work with the decision map");
  expect(at).toBeGreaterThan(BASE.length - 1);
  // names werk's command line by the folder werk runs from
  expect(prompt).toContain(currentWerk());
  expect(currentWerk()).toContain(ROOT);
  expect(prompt).not.toContain("{{werk}}");
  const text = prompt.slice(at, prompt.indexOf(HEAD));
  expect(text).not.toMatch(/#(werk|st|lp|vi|pr|al|ms)[-a-z0-9]*/);
  expect(prompt.indexOf(HEAD)).toBeGreaterThan(at);
  const rules = prompt.slice(prompt.indexOf(HEAD));
  for (const t of ["Tests run against a real database", "Money is stored in cents", "A deploy is one tagged commit"]) expect(rules).toContain(t);
  const agents = agentsOf(args);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const a of Object.values(agents)) expect(a.prompt).toContain(currentWerk());
});

test("19.2 chat agent gets text and titles; sample agent gets none", () => {
  const project = freshProject();
  writeMap(project, RULES);
  const chat = promptOf(projectAgentArgs({ role: "chat", base: "You chat.", project: project.dir }, WERK));
  expect(chat).toContain("how to work with the decision map");
  expect(chat).toContain(HEAD);
  expect(chat).toContain("Money is stored in cents");
  const sample = promptOf(projectAgentArgs({ role: "sample", base: "You sample.", project: project.dir }, WERK));
  expect(sample).not.toContain("how to work with the decision map");
  expect(sample).not.toContain(HEAD);
  expect(sample).not.toContain("Money is stored in cents");
});

test("19.3 no build rules, no title list", () => {
  const project = freshProject();
  writeMap(project, [{ id: "root" }, { id: "how", parent: "root" }]);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: project.dir }, WERK));
  expect(prompt).toContain("how to work with the decision map");
  expect(prompt).not.toContain(HEAD);
});

test("19.4 own checkout: instructions once", () => {
  const project = freshProject();
  writeMap(project, RULES);
  const own = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  expect(own).toContain("@src/agent/instructions.md");
  writeFileSync(join(project.dir, "AGENTS.md"), own);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: project.dir }, WERK));
  // the instructions reach the agent through AGENTS.md (one include) and the prompt adds none
  const copies = prompt.split("how to work with the decision map").length - 1;
  const included = own.split("@src/agent/instructions.md").length - 1;
  expect(copies + included).toBe(1);
  expect(prompt.indexOf(HEAD)).toBeGreaterThan(-1);
  expect(prompt).toContain("A deploy is one tagged commit");
  expect(instructions.length).toBeGreaterThan(100);
});

test("19.5 repository check catches a copy that replaces the link", () => {
  const copy = mkdtempSync(join(tmpdir(), "g19-"));
  try {
    for (const p of ["src", "scripts", ".claude", "web"]) cpSync(join(ROOT, p), join(copy, p), { recursive: true, verbatimSymlinks: true });
    for (const f of ["bunfig.toml", "package.json", "tsconfig.json", "pure-files.txt", ".bun-version", "biome.json"]) cpSync(join(ROOT, f), join(copy, f));
    symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
    const run = () => Bun.spawnSync(["bun", "test", "./scripts/subagent-links.test.ts"], { cwd: copy, stdout: "pipe", stderr: "pipe" });
    const link = join(copy, ".claude/agents/test-scope.md");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    const target = readlinkSync(link);
    expect(run().exitCode).toBe(0);
    rmSync(link);
    writeFileSync(link, readFileSync(join(copy, "src/agent/subagents/test-scope.md")));
    const bad = run();
    const out = bad.stdout.toString() + bad.stderr.toString();
    expect(bad.exitCode).not.toBe(0);
    expect(out).toContain("test-scope.md");
    rmSync(link);
    symlinkSync(target, link);
    expect(run().exitCode).toBe(0);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
