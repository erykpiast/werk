import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));

/** Claude Code's rule order: a deny rule, then an ask rule, then an allow rule, from every settings file together. */
function decide(command: string, rules: { allow: string[]; ask?: string[]; deny?: string[] }) {
  const matches = (rule: string) => {
    const m = /^Bash\((.*)\)$/.exec(rule);
    if (!m) return false;
    const pattern = m[1] as string;
    if (pattern.endsWith(":*")) {
      const prefix = pattern.slice(0, -2);
      return command === prefix || command.startsWith(`${prefix} `);
    }
    return command === pattern;
  };
  if ((rules.deny ?? []).some(matches)) return "deny";
  if ((rules.ask ?? []).some(matches)) return "ask";
  if (rules.allow.some(matches)) return "allow";
  return "ask";
}

test("48.1 a make target runs freely while an accept command still asks", () => {
  const personal = ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"];
  const rules = {
    allow: [...settings.permissions.allow, ...personal],
    ask: settings.permissions.ask,
    deny: settings.permissions.deny,
  };
  expect(decide("make lint", rules)).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} login --actor you`, rules)).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} login --actor you`, rules)).toBe("ask");
  }
  expect(decide("werk show login", rules)).toBe("allow");
});

const dirs: string[] = [];
beforeEach(() => {});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(import.meta.dirname, "tmp-48-"));
  dirs.push(d);
  return d;
};
const input = (path: string) => JSON.stringify({ tool_input: { file_path: path } });
async function runHook(file: string) {
  const run = Bun.spawn(["bun", join(ROOT, "src/claude/lint-hook.ts")], {
    cwd: ROOT,
    stdin: new Response(input(file)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  return { out, err, code };
}

test("48.2 an edit that leaves an unused import is repaired and the agent hears nothing", async () => {
  // the shared settings must run the hook after Write, Edit and MultiEdit
  const post = settings.hooks.PostToolUse[0];
  expect(post.matcher).toMatch(/Edit/);
  expect(post.hooks[0].command).toContain("lint-hook");

  const dir = tmp();
  const file = join(dir, "widget.tsx");
  writeFileSync(file, 'import { useState } from "react";\nimport { useEffect } from "react";\nexport function W() {\n      const [a] = useState(1);\n  return <div>{a}</div>;\n}\n');
  const first = await runHook(file);
  expect(first.code).toBe(0);
  expect(first.out + first.err).toBe("");
  const fixed = readFileSync(file, "utf8");
  expect(fixed).not.toContain("useEffect");
  expect(fixed).toContain("\n  const [a] = useState(1);");

  writeFileSync(file, 'import { useEffect, useState } from "react";\nexport function W({ n }: { n: number }) {\n  const [a] = useState(1);\n  useEffect(() => {\n    console.log(n);\n  }, []);\n  return <div>{a}</div>;\n}\n');
  const second = await runHook(file);
  expect(readFileSync(file, "utf8")).toContain("useEffect");
  expect(second.code).toBe(2);
  expect(second.err).toMatch(/useExhaustiveDependencies|dependenc/i);

  writeFileSync(file, 'import { useEffect, useState } from "react";\nexport function W({ n }: { n: number }) {\n  const [a] = useState(1);\n  useEffect(() => {\n    console.log(n);\n  }, [n]);\n  return <div>{a}</div>;\n}\n');
  const third = await runHook(file);
  expect(third.code).toBe(0);
  expect(third.out + third.err).toBe("");
}, 60000);

test("48.3 a copied subagent fails the check and a restored link passes it", async () => {
  const repo = tmp();
  const names = ["prototyper", "test-scope"];
  mkdirSync(join(repo, ".claude/agents"), { recursive: true });
  mkdirSync(join(repo, "src/agent/subagents"), { recursive: true });
  for (const n of names) {
    writeFileSync(join(repo, "src/agent/subagents", `${n}.md`), `# ${n}\n`);
    symlinkSync(`../../src/agent/subagents/${n}.md`, join(repo, ".claude/agents", `${n}.md`));
  }
  const check = async () => {
    const run = Bun.spawn(["bun", join(ROOT, "src/claude/check-subagent-links.ts"), repo], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    return { text: out + err, code };
  };
  expect((await check()).code).toBe(0);
  const link = join(repo, ".claude/agents/prototyper.md");
  unlinkSync(link);
  copyFileSync(join(repo, "src/agent/subagents/prototyper.md"), link);
  const copied = await check();
  expect(copied.code).not.toBe(0);
  expect(copied.text).toContain("prototyper");
  expect(copied.text).toMatch(/not a link/);
  unlinkSync(link);
  symlinkSync("../../src/agent/subagents/prototyper.md", link);
  expect((await check()).code).toBe(0);
  unlinkSync(link);
  const missing = await check();
  expect(missing.code).not.toBe(0);
  expect(missing.text).toContain("prototyper");
  symlinkSync("../../src/agent/subagents/prototyper.md", link);
  writeFileSync(join(repo, ".claude/agents/dev-only.md"), "# only for werk's own development\n");
  expect((await check()).code).toBe(0);
});

test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const allow: string[] = settings.permissions.allow;
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((a) => /^Bash\(werk\b/.test(a))).toBe(true);
  for (const a of allow) {
    expect(a).not.toMatch(/\b(curl|wget|ssh|scp|git push|npm publish|gh |nc )\b/);
    expect(a).not.toMatch(/(^|[ (])(cp|mv|rm|tee|dd|chmod|ln)\b/);
    expect(a).not.toMatch(/(~|\/etc|\/usr|\$HOME)/);
  }
  expect(existsSync(join(ROOT, ".claude/skills"))).toBe(false);
  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(JSON.stringify(settings)).not.toMatch(/mcpServers|enabledMcpjsonServers/);
  // a personal settings file is ignored by git
  const repo = tmp();
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo });
  copyFileSync(join(ROOT, ".gitignore"), join(repo, ".gitignore"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".claude/settings.local.json"), '{"permissions":{"allow":["Bash(werk:*)"]}}');
  const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: repo }).stdout.toString();
  expect(status).not.toContain("settings.local.json");
});
