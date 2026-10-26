import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib.ts";

const settings = JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));
const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Claude Code's rule order: a deny rule, then an ask rule, then an allow rule. The first match decides, across every settings file. */
function decide(command: string, allow: string[], ask: string[], deny: string[] = []) {
  const matches = (rule: string) => {
    const m = /^Bash\((.*?)(:\*)?\)$/.exec(rule);
    if (!m) return false;
    const prefix = m[1] as string;
    return m[2] ? command === prefix || command.startsWith(`${prefix} `) : command === prefix;
  };
  if (deny.some(matches)) return "deny";
  if (ask.some(matches)) return "ask";
  if (allow.some(matches)) return "allow";
  return "ask-default";
}

test("48.1 a make target runs freely while an accept command still asks", () => {
  const allow: string[] = settings.permissions.allow;
  const ask: string[] = settings.permissions.ask ?? [];
  // the person's own settings allow every werk command
  const personal = ["Bash(werk:*)", "Bash(bun src/cli.ts:*)", "Bash(*)"];
  expect(decide("make lint", allow, ask)).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    for (const cmd of [`werk ${verb} card --actor you`, `bun src/cli.ts ${verb} card --actor you`]) {
      expect(decide(cmd, allow, ask), `shared settings: ${cmd}`).toBe("ask");
      expect(decide(cmd, [...allow, ...personal], ask), `with personal allow: ${cmd}`).toBe("ask");
    }
  }
  expect(decide("werk search cache", allow, ask)).toBe("allow");
});

test("48.2 an edit that leaves an unused import is repaired and the agent hears nothing", async () => {
  const hooks = settings.hooks.PostToolUse as { matcher: string; hooks: { command: string }[] }[];
  expect(hooks.some((h) => /Edit/.test(h.matcher) && h.hooks.some((x) => x.command.includes("lint-hook.ts")))).toBe(true);

  const dir = mkdtempSync(join(ROOT, ".werk-heldout", "hook-tmp-"));
  cleanups.push(dir);
  const file = join(dir, "widget.tsx");
  const run = async () => {
    const p = Bun.spawn(["bun", "src/claude/lint-hook.ts"], {
      cwd: ROOT,
      stdin: new Response(JSON.stringify({ tool_input: { file_path: file } })),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  };
  writeFileSync(
    file,
    'import { useEffect } from "react";\nimport { unused } from "./nothing";\nexport function A() {\n        return <div>hi</div>;\n}\n',
  );
  const first = await run();
  expect(first.code).toBe(0);
  expect(`${first.out}${first.err}`).toBe("");
  const fixed = readFileSync(file, "utf8");
  expect(fixed).not.toContain("unused");
  expect(fixed).toContain("\n  return <div>hi</div>;");

  writeFileSync(
    file,
    'import { useEffect } from "react";\nexport function A({ n }: { n: number }) {\n  useEffect(() => {\n    console.log(n);\n  }, []);\n  return <div>hi</div>;\n}\n',
  );
  const second = await run();
  expect(readFileSync(file, "utf8")).toContain("console.log(n)");
  expect(second.code).toBe(2);
  expect(second.err).toContain("useExhaustiveDependencies");

  writeFileSync(
    file,
    'import { useEffect } from "react";\nexport function A({ n }: { n: number }) {\n  useEffect(() => {\n    console.log(n);\n  }, [n]);\n  return <div>hi</div>;\n}\n',
  );
  const third = await run();
  expect(third.code).toBe(0);
  expect(`${third.out}${third.err}`).toBe("");
}, 120000);

function subagentRoot() {
  const root = mkdtempSync(join(tmpdir(), "werk-subagents-"));
  cleanups.push(root);
  mkdirSync(join(root, ".claude/agents"), { recursive: true });
  mkdirSync(join(root, "src/agent/subagents"), { recursive: true });
  for (const name of ["prototyper", "test-scope"]) {
    writeFileSync(
      join(root, `src/agent/subagents/${name}.md`),
      readFileSync(join(ROOT, `src/agent/subagents/${name}.md`)),
    );
    symlinkSync(`../../src/agent/subagents/${name}.md`, join(root, `.claude/agents/${name}.md`));
  }
  return root;
}
const check = async (root: string) => {
  const p = Bun.spawn(["bun", "src/claude/check-subagent-links.ts", root], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  return { err, code };
};

test("48.3 a copied subagent fails the check and a restored link passes it", async () => {
  const root = subagentRoot();
  const link = join(root, ".claude/agents/prototyper.md");
  expect((await check(root)).code).toBe(0);
  rmSync(link);
  writeFileSync(link, readFileSync(join(root, "src/agent/subagents/prototyper.md")));
  const copied = await check(root);
  expect(copied.code).not.toBe(0);
  expect(copied.err).toContain("prototyper");
  expect(copied.err).toMatch(/not a link|copy/);
  rmSync(link);
  symlinkSync("../../src/agent/subagents/prototyper.md", link);
  expect((await check(root)).code).toBe(0);
  rmSync(link);
  const removed = await check(root);
  expect(removed.code).not.toBe(0);
  expect(removed.err).toContain("prototyper");
  expect(removed.err).toMatch(/no link/);
  symlinkSync("../../src/agent/subagents/prototyper.md", link);
  writeFileSync(join(root, ".claude/agents/dev-only.md"), "---\ndescription: only for werk's own development\n---\nbody\n");
  expect((await check(root)).code).toBe(0);
});

test("48.4 the shared settings stay small, safe and free of skills and servers", async () => {
  const allow: string[] = settings.permissions.allow;
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((a) => a.startsWith("Bash(werk"))).toBe(true);
  for (const entry of allow) {
    expect(entry).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
    expect(entry).not.toMatch(/curl|wget|ssh|scp|rsync|rm |mv |cp |git push|npm|gh |http/);
  }
  expect(JSON.stringify(settings)).not.toMatch(/mcpServers|enabledMcpjsonServers/);
  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(existsSync(join(ROOT, ".claude/skills"))).toBe(false);
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }).stdout.toString();
  expect(tracked).not.toMatch(/SKILL\.md|\.mcp\.json|\.claude\/skills\//);

  const repo = mkdtempSync(join(tmpdir(), "werk-ignore-"));
  cleanups.push(repo);
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  writeFileSync(join(repo, ".gitignore"), readFileSync(join(ROOT, ".gitignore")));
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude/settings.local.json"), '{"permissions":{"allow":["Bash(*)"]}}');
  const status = Bun.spawnSync(["git", "status", "--porcelain", "-uall"], { cwd: repo }).stdout.toString();
  expect(status).not.toContain("settings.local.json");
  const ignored = Bun.spawnSync(["git", "check-ignore", ".claude/settings.local.json"], { cwd: repo });
  expect(ignored.exitCode).toBe(0);
});
