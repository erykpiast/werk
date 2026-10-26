import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { cleanEnv } from "../src/test-env/env.ts";
import { SHIPPED_SUBAGENTS } from "../src/agent/subagents.ts";
import { repoCopy, CHECKOUT } from "./repo-copy.ts";

let copy = "";
beforeAll(() => {
  copy = repoCopy();
}, 120000);
afterAll(() => {
  if (copy) rmSync(copy, { recursive: true, force: true });
});

const run = (cmd: string[], opts: { stdin?: string; cwd?: string } = {}) => {
  const r = Bun.spawnSync(cmd, {
    cwd: opts.cwd ?? copy,
    env: { ...cleanEnv(process.env), CLAUDE_PROJECT_DIR: copy },
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

const settings = () => JSON.parse(readFileSync(join(CHECKOUT, ".claude/settings.json"), "utf8"));

describe("48", () => {
  test("48.1 a make target runs freely while accept, remove and restore still ask", () => {
    const s = settings();
    const allow: string[] = s.permissions.allow;
    const ask: string[] = s.permissions.ask ?? [];
    expect(allow.some((a) => /^Bash\(make[: ]/.test(a))).toBe(true);
    expect(ask.some((a) => /^Bash\(make/.test(a))).toBe(false);
    for (const verb of ["accept", "remove", "restore"]) {
      // The ask rule must exist for the checkout command line and for the werk command.
      expect(ask.some((a) => a.includes(`werk ${verb}`))).toBe(true);
      expect(ask.some((a) => a.includes(`src/cli.ts ${verb}`))).toBe(true);
    }
    // A personal allow of every werk command does not remove an ask rule: ask is checked before allow.
    expect(s.permissions.deny ?? []).not.toContain("Bash(werk accept:*)");
    expect(existsSync(join(CHECKOUT, ".claude/settings.local.json"))).toBe(false);
  });

  test("48.2 a lint hook repairs, stays quiet, then reports a hook error", () => {
    const file = join(copy, "client/app/heldout-sample.tsx");
    const payload = JSON.stringify({ tool_input: { file_path: file } });
    writeFileSync(
      file,
      `import { useState } from "react";\nimport { clsx } from "clsx";\n\nexport function Sample() {\n      const [n] = useState(1);\n        return <p>{n}</p>;\n}\n`,
    );
    const first = run(["bun", join(copy, "src/claude/lint-hook.ts")], { stdin: payload });
    const fixed = readFileSync(file, "utf8");
    expect(first.code).toBe(0);
    expect(first.err + first.out).toBe("");
    expect(fixed).not.toContain("clsx");
    expect(fixed).toContain('  const [n] = useState(1);');
    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\n\nexport function Sample({ id }: { id: string }) {\n  const [n, setN] = useState(1);\n  useEffect(() => {\n    setN(id.length);\n  }, []);\n  return <p>{n}</p>;\n}\n`,
    );
    const second = run(["bun", join(copy, "src/claude/lint-hook.ts")], { stdin: payload });
    expect(readFileSync(file, "utf8")).toContain("useEffect");
    expect(second.code).toBe(2);
    expect(second.err).toMatch(/dependenc/i);
    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\n\nexport function Sample({ id }: { id: string }) {\n  const [n, setN] = useState(1);\n  useEffect(() => {\n    setN(id.length);\n  }, [id]);\n  return <p>{n}</p>;\n}\n`,
    );
    const third = run(["bun", join(copy, "src/claude/lint-hook.ts")], { stdin: payload });
    expect(third.code).toBe(0);
    expect(third.err + third.out).toBe("");
  }, 60000);

  test("48.3 a copied subagent fails the check, a restored link passes", () => {
    const check = () => run(["bun", join(copy, "src/claude/check-subagent-links.ts"), copy]);
    const names = Object.keys(SHIPPED_SUBAGENTS);
    expect(names.length).toBeGreaterThan(0);
    const name = names[0] as string;
    const link = join(copy, ".claude/agents", `${name}.md`);
    expect(check().code).toBe(0);
    const target = join(copy, "src/agent/subagents", `${name}.md`);
    unlinkSync(link);
    copyFileSync(target, link);
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
    const copied = check();
    expect(copied.code).not.toBe(0);
    expect(copied.err).toContain(name);
    expect(copied.err).toMatch(/not a link/);
    unlinkSync(link);
    symlinkSync(`../../src/agent/subagents/${name}.md`, link);
    expect(check().code).toBe(0);
    unlinkSync(link);
    const missing = check();
    expect(missing.code).not.toBe(0);
    expect(missing.err).toContain(name);
    symlinkSync(`../../src/agent/subagents/${name}.md`, link);
    writeFileSync(join(copy, ".claude/agents/dev-only.md"), "---\nname: dev-only\ndescription: x\n---\nx\n");
    expect(check().code).toBe(0);
  }, 60000);

  test("48.4 the shared settings are small, safe and free of skills and servers", () => {
    const s = settings();
    const allow: string[] = s.permissions.allow;
    expect(allow.some((a) => a.startsWith("Bash(make"))).toBe(true);
    expect(allow.some((a) => a.startsWith("Bash(werk"))).toBe(true);
    for (const entry of allow) {
      expect(entry).not.toMatch(/curl|wget|ssh|scp|rsync|git push|npm publish|\brm\b|\bcp\b|\bmv\b|\btee\b|Write|Edit|WebFetch|WebSearch/);
    }
    expect(s.mcpServers).toBeUndefined();
    expect(s.enabledMcpjsonServers).toBeUndefined();
    expect(existsSync(join(CHECKOUT, ".mcp.json"))).toBe(false);
    const tracked = run(["git", "ls-files"]).out.split("\n");
    expect(tracked.some((f) => /^\.claude\/skills\//.test(f) || /SKILL\.md$/.test(f))).toBe(false);
    writeFileSync(join(copy, ".claude/settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(git:*)"] } }));
    expect(run(["git", "check-ignore", ".claude/settings.local.json"]).code).toBe(0);
    expect(run(["git", "status", "--porcelain", "--", ".claude"]).out).not.toContain("settings.local.json");
  });
});
