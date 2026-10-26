// Held-out steps 19.1-19.5: the prompt of the agents that werk starts.
// The user path: the person starts a build pass, sends a chat message, or samples options.
// The fake agent on PATH records every launch; project.launches() reads them back.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";
import { projectAgentArgs } from "../src/agent/launch.ts";

type Card = { id: string; parent?: string; title?: string };
function writeMap(project: Project, cards: Card[]): void {
  const lines = cards.map(({ id, parent, title }, i) =>
    JSON.stringify({ seq: i + 1, at: "t", type: "node.added", actor: "you", payload: { kind: "card", id, parent, title: title ?? id, status: "decided" } }),
  );
  writeFileSync(join(project.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}
const THREE: Card[] = [
  { id: "root" },
  { id: "how", parent: "root", title: "How it is built" },
  { id: "r1", parent: "how", title: "Rule one title" },
  { id: "r2", parent: "how", title: "Rule two title" },
  { id: "r3", parent: "how", title: "Rule three title" },
];

/** The verbs of the command line, from werk help. */
async function verbs(project: Project): Promise<string[]> {
  const help = (await project.werk(["help"])).out;
  return [...help.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1] as string);
}

/** Every way the person has to start a build pass, a chat agent or a sample agent. */
async function starter(project: Project, kind: RegExp): Promise<string | undefined> {
  return (await verbs(project)).find((v) => kind.test(v));
}

const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;

test("19.1 a build pass in another project: werk offers a way to start one", async () => {
  const p = freshProject();
  writeMap(p, THREE);
  const verb = await starter(p, /build|pass|run|loop|ticket$/);
  console.log("verbs:", (await verbs(p)).join(" "), "| build starter:", verb);
  // Supporting check at the module that every launcher would use.
  const args = projectAgentArgs({ role: "builder", base: "BUILD AGENT BASE", project: p.dir }, "/opt/werk/bun /opt/werk/src/cli.ts");
  const prompt = promptOf(args);
  console.log("module prompt starts with base:", prompt.startsWith("BUILD AGENT BASE\n"), "| has titles:", ["Rule one title", "Rule two title", "Rule three title"].every((t) => prompt.includes(t)), "| subagents:", Object.keys(JSON.parse(args[args.indexOf("--agents") + 1] as string)));
  expect(verb).toBeDefined();
  expect(p.launches().length).toBeGreaterThan(0);
});

test("19.2 a chat agent and a sample agent: werk offers a way to start each", async () => {
  const p = freshProject();
  writeMap(p, THREE);
  const chat = await starter(p, /chat|ask|message/);
  const sample = await starter(p, /sample/);
  const c = promptOf(projectAgentArgs({ role: "chat", base: "CHAT", project: p.dir }, "W"));
  const s = promptOf(projectAgentArgs({ role: "sample", base: "SAMPLE", project: p.dir }, "W"));
  console.log("chat starter:", chat, "sample starter:", sample, "| module: chat has text+titles:", c.includes("decision map") && c.includes("Rule one title"), "| sample has text:", s.includes("decision map"), "sample has titles:", s.includes("Rule one title"));
  expect(chat).toBeDefined();
  expect(sample).toBeDefined();
});

test("19.3 a project with no build rules: werk offers a way to start a build pass", async () => {
  const p = freshProject();
  writeMap(p, [{ id: "root" }, { id: "how", parent: "root" }]);
  const verb = await starter(p, /build|pass|run|loop|ticket$/);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: "B", project: p.dir }, "W"));
  console.log("build starter:", verb, "| module: text:", prompt.includes("decision map"), "rules heading:", prompt.includes("build rules"));
  expect(verb).toBeDefined();
});

test("19.4 werk's own checkout: werk offers a way to start a build pass there", async () => {
  const p = freshProject();
  writeMap(p, THREE);
  copyFileSync(join(import.meta.dir, "..", "AGENTS.md"), join(p.dir, "AGENTS.md"));
  const verb = await starter(p, /build|pass|run|loop|ticket$/);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: "B", project: p.dir }, "W"));
  console.log("build starter:", verb, "| module: text appears", prompt.split("# werk — how to work with the decision map").length - 1, "times (AGENTS.md includes it by reference)");
  expect(verb).toBeDefined();
});

const CHECKOUT = join(import.meta.dir, "..");
const root = realpathSync(mkdtempSync(join(tmpdir(), "heldout-19-")));
const copy = join(root, "werk");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sh = (cmd: string[], cwd = copy) => {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test(
  "19.5 the repository checks catch a subagent copy that replaces its link",
  () => {
    expect(sh(["rsync", "-a", "--exclude", "node_modules", "--exclude", ".werk-heldout", "--exclude", ".git", `${CHECKOUT}/`, `${copy}/`], CHECKOUT).code).toBe(0);
    expect(sh(["cp", "-cRp", join(CHECKOUT, "node_modules"), join(copy, "node_modules")], CHECKOUT).code).toBe(0);
    const link = join(copy, ".claude/agents/test-scope.md");
    const before = sh(["make", "test"]);
    console.log(before.out.split("\n").slice(-5).join("\n"));
    expect(before.code).toBe(0);

    const text = readFileSync(link, "utf8");
    rmSync(link);
    writeFileSync(link, text);
    const broken = sh(["make", "test"]);
    console.log(broken.out.split("\n").filter((l) => l.includes("test-scope") || /\(fail\)/.test(l)).join("\n"));
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("test-scope.md");

    rmSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const again = sh(["make", "test"]);
    console.log(again.out.split("\n").slice(-5).join("\n"));
    expect(again.code).toBe(0);
  },
  600000,
);
