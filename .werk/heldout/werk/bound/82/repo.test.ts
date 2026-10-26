// Tests that run the repository's own tasks, in a copy of the checkout, so no file of the checkout changes.
import { beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
const path = (process.env.PATH ?? "").split(delimiter).filter((d) => d && !existsSync(join(d, "claude")) && !d.endsWith("fake-bin"));
const PATH = path.join(delimiter);

let copy = "";
const sh = (cmd: string[], cwd = copy, env: Record<string, string> = {}) => {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, PATH, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString(), all: r.stdout.toString() + r.stderr.toString() };
};

beforeAll(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-repo-")));
  copy = join(root, "w");
  Bun.spawnSync(["mkdir", copy]);
  for (const name of readdirSync(CHECKOUT)) {
    if ([".git", ".werk-heldout", "node_modules", "test-results", "dist", "coverage", "playwright-report"].includes(name)) continue;
    Bun.spawnSync(["cp", "-cR", join(CHECKOUT, name), copy]);
  }
  Bun.spawnSync(["cp", "-cRp", join(CHECKOUT, "node_modules"), copy]);
  sh(["git", "init", "-q", "-b", "main"]);
  sh(["git", "config", "user.email", "t@t.t"]);
  sh(["git", "config", "user.name", "t"]);
  sh(["git", "add", "-A"]);
  sh(["git", "commit", "-q", "-m", "copy"]);
}, 120000);

let coverageOutput = "";

test("[61.3] the tests pass on a machine with no real agent installed [01.1 part 1]", () => {
  expect(Bun.which("claude", { PATH })).toBeNull();
  const r = sh(["make", "test"]);
  expect(r.code, r.all.slice(-3000)).toBe(0);
  expect(r.all).not.toMatch(/coverage/i);
  expect(sh(["git", "status", "--porcelain"]).out.trim()).toBe("");
}, 900000);

test("[01.1 part 2] make test-coverage reports each pure file with its percentage", () => {
  const r = sh(["make", "test-coverage"]);
  coverageOutput = r.all;
  expect(r.code, r.all.slice(-3000)).toBe(0);
  const pure = readFileSync(join(copy, "pure-files.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  for (const f of pure) {
    const line = r.all.split("\n").find((l) => l.includes(f));
    expect(line, `no line for ${f}`).toBeDefined();
    expect(line).toMatch(/\d+(\.\d+)?%/);
  }
}, 900000);

test("[01.1 part 3] deleting the own test file of a pure file gives 0% and a failure that names it, while make test passes", () => {
  unlinkSync(join(copy, "src/cli/card-id.test.ts"));
  const c = sh(["make", "test-coverage"]);
  expect(c.code).not.toBe(0);
  const line = c.all.split("\n").find((l) => l.includes("src/cli/card-id.ts"));
  expect(line).toMatch(/\b0(\.0+)?%/);
  expect(c.all).toContain("card-id.test.ts");
  const t = sh(["make", "test"]);
  expect(t.code, t.all.slice(-2000)).toBe(0);
  expect(t.all).not.toMatch(/coverage/i);
  sh(["git", "checkout", "--", "."]);
}, 900000);

test("[61.4] the coverage gate fails below 90% on a pure file and passes again at 90% or above", () => {
  const file = "src/cli/args.test.ts";
  const original = readFileSync(join(copy, file), "utf8");
  try {
    writeFileSync(join(copy, file), `import { expect, test } from "bun:test";\ntest("one", () => { expect(1).toBe(1); });\n`);
    const t = sh(["make", "test"]);
    expect(t.code, t.all.slice(-2500)).toBe(0);
    const c = sh(["make", "test-coverage"]);
    expect(c.code).not.toBe(0);
    const line = c.all.split("\n").find((l) => l.includes("src/cli/args.ts"));
    expect(line).toMatch(/\d+(\.\d+)?%/);
  } finally {
    writeFileSync(join(copy, file), original);
  }
  const ok = sh(["make", "test-coverage"]);
  expect(ok.code, ok.all.slice(-2000)).toBe(0);
}, 1200000);

test("[61.2] the help verb lists every registered verb, and a new verb module appears in it with no other edit", () => {
  const before = sh(["bun", "src/cli.ts", "help"]);
  expect(before.code).toBe(0);
  const names = readdirSync(join(copy, "src/verbs")).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "index.ts");
  expect(before.out).toContain("help");
  for (const n of names) expect(before.out).toMatch(new RegExp(`^\\s+${n.replace(/\.ts$/, "").replace(/-check$/, "-check")}\\b`, "m"));
  writeFileSync(
    join(copy, "src/verbs/ping.ts"),
    `import { registerVerb } from "../cli/registry.ts";\nregisterVerb({ name: "ping", help: "Answer pong.", run: (_a, io) => { io.out("pong\\n"); return 0; } });\n`,
  );
  const after = sh(["bun", "src/cli.ts", "help"]);
  expect(after.out).toMatch(/^\s+ping\b/m);
  for (const line of before.out.split("\n").filter((l) => /^ {2}\S/.test(l))) expect(after.out).toContain(line);
  expect(sh(["git", "status", "--porcelain"]).out.trim()).toBe("?? src/verbs/ping.ts");
  rmSync(join(copy, "src/verbs/ping.ts"));
}, 120000);

test("[19.5] the repository check catches a subagent copy that replaces its link", () => {
  const link = join(copy, ".claude/agents/test-scope.md");
  const target = join(copy, "src/agent/subagents/test-scope.md");
  const clean = sh(["bun", "test", "scripts/subagent-links.test.ts"]);
  expect(clean.code, clean.all.slice(-1500)).toBe(0);
  unlinkSync(link);
  writeFileSync(link, readFileSync(target));
  const bad = sh(["bun", "test", "scripts/subagent-links.test.ts"]);
  expect(bad.code).not.toBe(0);
  expect(bad.all).toContain("test-scope");
  unlinkSync(link);
  symlinkSync("../../src/agent/subagents/test-scope.md", link);
  const good = sh(["bun", "test", "scripts/subagent-links.test.ts"]);
  expect(good.code, good.all.slice(-1500)).toBe(0);
}, 300000);
