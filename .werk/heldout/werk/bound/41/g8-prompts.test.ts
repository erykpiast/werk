import { expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { fillWerk, INSTRUCTIONS } from "../src/agent/prompt.ts";
import { currentWerkCommand } from "../src/own/running.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const REPO = join(import.meta.dir, "..");
const BASE = "You are the build agent. Build the ticket below.";
const HEADING = "## This project's build rules";
const WERK = currentWerkCommand();
const TEXT = fillWerk(INSTRUCTIONS, WERK).trimEnd();

type Card = { id: string; parent?: string; title?: string };
function writeMap(project: Project, cards: Card[]): string {
  const log = join(project.dir, ".werk", "log.jsonl");
  writeFileSync(
    log,
    `${cards
      .map(({ id, parent, title }, i) =>
        JSON.stringify({ seq: i + 1, at: "t", type: "node.added", actor: "agent", payload: { kind: "card", id, parent, title: title ?? `Title of ${id}`, status: "decided" } }),
      )
      .join("\n")}\n`,
  );
  return log;
}
const THREE: Card[] = [
  { id: "root" },
  { id: "how", parent: "root", title: "How the shop is built" },
  { id: "db", parent: "how", title: "Tests run against a real database" },
  { id: "money", parent: "how", title: "Money is stored in cents" },
  { id: "deploy", parent: "how", title: "A deploy is one tagged commit" },
];
const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;
const agentsOf = (args: string[]) => JSON.parse(args[args.indexOf("--agents") + 1] as string) as Record<string, { prompt: string }>;

// NOTE: no verb or route starts a "build pass" from outside in this checkout (role "builder" exists only in
// src/agent/prompt.ts). These tests drive the shared launcher module, projectAgentArgs, with role "builder".

test("19.1 build pass in another project", () => {
  const p = freshProject();
  writeMap(p, THREE);
  const args = projectAgentArgs({ role: "builder", base: BASE, project: p.dir });
  const prompt = promptOf(args);
  expect(prompt.startsWith(BASE)).toBe(true);
  const at = prompt.indexOf(TEXT);
  expect(at).toBe(BASE.length + 2);
  // names werk's command line by the folder werk runs from
  expect(WERK).toContain(join(REPO, "src", "cli.ts"));
  expect(TEXT).toContain(`${WERK} show <id>`);
  expect(INSTRUCTIONS).not.toMatch(/#(werk|st|lp|vi|pr|al|ms|how)\b/);
  const rules = prompt.slice(prompt.indexOf(HEADING));
  expect(prompt.indexOf(HEADING)).toBeGreaterThan(at + TEXT.length - 1);
  for (const t of ["Tests run against a real database", "Money is stored in cents", "A deploy is one tagged commit"]) expect(rules).toContain(t);
  const agents = agentsOf(args);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const a of Object.values(agents)) expect(a.prompt).toContain(WERK);
});

test("19.2 chat gets instructions and titles; sample does not", () => {
  const p = freshProject();
  writeMap(p, THREE);
  const chat = promptOf(projectAgentArgs({ role: "chat", base: "You chat.", project: p.dir }));
  expect(chat).toContain(TEXT);
  expect(chat).toContain(HEADING);
  expect(chat).toContain("Money is stored in cents");
  const sampleArgs = projectAgentArgs({ role: "sample", base: "You sample.", project: p.dir });
  const sample = promptOf(sampleArgs);
  expect(sample).not.toContain("werk — how to work with the decision map");
  expect(sample).not.toContain(HEADING);
  expect(sample).not.toContain("Money is stored in cents");
});

test("19.3 no build rules, no title list", () => {
  const p = freshProject();
  writeMap(p, [{ id: "root" }, { id: "how", parent: "root" }]);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: p.dir }));
  expect(prompt).toContain(TEXT);
  expect(prompt).not.toContain(HEADING);
  expect(prompt).not.toContain("build rules");
});

test("19.4 werk's own checkout: instructions once", () => {
  const p = freshProject();
  const log = writeMap(p, THREE);
  // The project folder is the real checkout (read only: AGENTS.md); the map is a temp log.
  expect(readFileSync(join(REPO, "AGENTS.md"), "utf8")).toContain("@src/agent/instructions.md");
  const args = projectAgentArgs({ role: "builder", base: BASE, project: REPO, log });
  const prompt = promptOf(args);
  const marker = "werk — how to work with the decision map";
  console.log("instruction copies in prompt:", prompt.split(marker).length - 1, "agents flag:", args.includes("--agents"));
  // In the checkout, AGENTS.md carries the instructions (Claude Code reads it); the prompt must not add a second copy.
  // "appear in the prompt one time only": count the copies in prompt + the AGENTS.md include.
  const appended = prompt.split(marker).length - 1;
  const viaAgentsMd = readFileSync(join(REPO, "AGENTS.md"), "utf8").split("\n").filter((l) => l.trim() === "@src/agent/instructions.md").length;
  expect(appended + viaAgentsMd).toBe(1);
  expect(prompt).toContain(HEADING);
  expect(prompt).toContain("Money is stored in cents");
});

test("19.5 replacing the subagent link with a copy fails the check; restoring passes", () => {
  const tmp = mkdtempSync(join(tmpdir(), "g8-copy-"));
  try {
    const copy = join(tmp, "checkout");
    cpSync(REPO, copy, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => !/\/(node_modules|\.git|dist|test-results|\.werk-heldout)(\/|$)/.test(src),
    });
    symlinkSync(join(REPO, "node_modules"), join(copy, "node_modules"));
    const link = join(copy, ".claude", "agents", "test-scope.md");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    const run = () => Bun.spawnSync(["bun", "test", "scripts/subagent-links.test.ts"], { cwd: copy, stdout: "pipe", stderr: "pipe" });
    const text = (r: ReturnType<typeof run>) => r.stdout.toString() + r.stderr.toString();
    const before = run();
    expect(before.exitCode, text(before)).toBe(0);
    const target = join(copy, "src", "agent", "subagents", "test-scope.md");
    unlinkSync(link);
    writeFileSync(link, readFileSync(target));
    const bad = run();
    expect(bad.exitCode).not.toBe(0);
    expect(text(bad)).toContain("test-scope.md");
    expect(text(bad)).toContain("a copy, not a link");
    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const good = run();
    expect(good.exitCode, text(good)).toBe(0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
