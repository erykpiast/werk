import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyRepo, ROOT } from "./support.ts";

const settings = () =>
  JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8")) as {
    permissions: { allow: string[]; ask?: string[]; deny?: string[] };
    hooks?: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]>;
    mcpServers?: unknown;
  };

/** Claude Code's prefix rule: Bash(prefix:*) matches a command that is the prefix or starts with it and a space. */
const matches = (rule: string, command: string) => {
  const m = /^Bash\((.*?)(:\*)?\)$/.exec(rule);
  if (!m) return false;
  const prefix = m[1] as string;
  return m[2] ? command === prefix || command.startsWith(`${prefix} `) : command === prefix;
};
/** Deny, then ask, then allow: the first list with a match decides, whatever file the rule came from. */
const decide = (command: string, merged: { allow: string[]; ask: string[]; deny: string[] }) =>
  merged.deny.some((r) => matches(r, command))
    ? "deny"
    : merged.ask.some((r) => matches(r, command))
      ? "ask"
      : merged.allow.some((r) => matches(r, command))
        ? "allow"
        : "ask-default";

let tmp: string;
beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-48-")));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("48.1 a make target runs freely while an accept command still asks", () => {
  const shared = settings().permissions;
  // A person's personal file allows every werk command.
  const personal = { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"], ask: [], deny: [] };
  const merged = {
    allow: [...shared.allow, ...personal.allow],
    ask: [...(shared.ask ?? []), ...personal.ask],
    deny: [...(shared.deny ?? []), ...personal.deny],
  };
  expect(decide("make lint", merged)).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} card --actor you`, merged)).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} card --actor you`, merged)).toBe("ask");
  }
  expect(decide("werk show card", merged)).toBe("allow");
});

const SAMPLE = `import { useState } from "react";
import { useEffect } from "react";

export function Sample() {
      const [n] = useState(0);
  return <div>{n}</div>;
}
`;

test("48.2 an edit that leaves an unused import is repaired and the agent hears nothing", async () => {
  const dir = join(tmp, "repo48");
  mkdirSync(dir);
  copyRepo(dir);
  const hook = settings().hooks?.PostToolUse?.[0];
  expect(hook?.matcher).toMatch(/Edit/);
  const command = hook?.hooks[0]?.command as string;
  const file = join(dir, "client", "app", "sample.tsx");
  const run = async () => {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: dir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    proc.stdin.write(JSON.stringify({ tool_input: { file_path: file } }));
    proc.stdin.end();
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, out, err };
  };
  writeFileSync(file, SAMPLE);
  const first = await run();
  console.log("FIRST", first.code, JSON.stringify(first.out), JSON.stringify(first.err));
  expect(first.code).toBe(0);
  expect(first.out + first.err).toBe("");
  const fixed = readFileSync(file, "utf8");
  expect(fixed).not.toContain("useEffect");
  expect(fixed).toContain("  const [n] = useState(0);");
  expect(fixed).not.toContain("      const [n]");

  writeFileSync(
    file,
    `import { useEffect, useState } from "react";

export function Sample({ id }: { id: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(id.length);
  }, []);
  return <div>{n}</div>;
}
`,
  );
  const second = await run();
  expect(readFileSync(file, "utf8")).toContain("setN(id.length)");
  expect(second.code).toBe(2);
  expect(second.out + second.err).toMatch(/useExhaustiveDependencies|dependenc/);
  expect(second.out + second.err).toContain("id");

  writeFileSync(
    file,
    readFileSync(file, "utf8").replace("}, []);", "}, [id]);"),
  );
  const third = await run();
  expect(third.code).toBe(0);
  expect(third.out + third.err).toBe("");
});

const linkCheck = async (root: string) => {
  const proc = Bun.spawn(["bun", join(ROOT, "src/claude/check-subagent-links.ts"), root], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, text: out + err };
};

test("48.3 a copied subagent fails the check and a restored link passes it", async () => {
  const root = join(tmp, "repo483");
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "src", "agent"), { recursive: true });
  cpSync(join(ROOT, ".claude/agents"), join(root, ".claude/agents"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  cpSync(join(ROOT, "src/agent/subagents"), join(root, "src/agent/subagents"), {
    recursive: true,
  });
  const shipped = readdirSync(join(root, "src/agent/subagents")).filter((n) => n.endsWith(".md"));
  expect(shipped.length).toBeGreaterThan(0);
  expect((await linkCheck(root)).code).toBe(0);

  const name = shipped[0] as string;
  const entry = join(root, ".claude/agents", name);
  const target = `../../src/agent/subagents/${name}`;
  unlinkSync(entry);
  writeFileSync(entry, readFileSync(join(root, "src/agent/subagents", name)));
  const copied = await linkCheck(root);
  expect(copied.code).not.toBe(0);
  expect(copied.text).toContain(name.replace(/\.md$/, ""));
  expect(copied.text).toMatch(/not a link/);

  unlinkSync(entry);
  symlinkSync(target, entry);
  expect((await linkCheck(root)).code).toBe(0);

  unlinkSync(entry);
  const gone = await linkCheck(root);
  expect(gone.code).not.toBe(0);
  expect(gone.text).toContain(name.replace(/\.md$/, ""));
  expect(gone.text).toMatch(/no link|missing/);

  symlinkSync(target, entry);
  writeFileSync(join(root, ".claude/agents", "dev-only.md"), "---\nname: dev-only\n---\nOnly for werk's own development.\n");
  expect((await linkCheck(root)).code).toBe(0);
});

test("48.4 the shared settings stay small, safe and free of skills and servers", async () => {
  const s = settings();
  const allow = s.permissions.allow;
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((r) => /^Bash\((werk|bun src\/cli\.ts)/.test(r))).toBe(true);
  // Every make target is one allowed prefix, so no target needs its own entry.
  const make = readFileSync(join(ROOT, "Makefile"), "utf8");
  expect(make).toContain(".PHONY");
  const risky = /\b(curl|wget|ssh|scp|nc|rm|mv|cp|tee|dd|git push|npm|npx|pip|brew|gh)\b|>|\/\.\.|~\/|\/tmp|\/etc|sudo/;
  for (const rule of allow) expect(rule).not.toMatch(risky);
  expect(allow.every((r) => /^Bash\((make|werk|bun src\/cli\.ts):\*\)$/.test(r))).toBe(true);

  expect(existsSync(join(ROOT, ".claude/skills"))).toBe(false);
  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(s.mcpServers).toBeUndefined();
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }).stdout.toString();
  expect(tracked).not.toMatch(/SKILL\.md|\.mcp\.json|\.claude\/skills|\.claude\/commands/);

  const dir = join(tmp, "repo484");
  mkdirSync(dir);
  copyRepo(dir);
  writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(git:*)"] } }));
  const status = Bun.spawnSync(["git", "status", "--porcelain", "-uall"], { cwd: dir }).stdout.toString();
  expect(status).not.toContain("settings.local.json");
  const ignored = Bun.spawnSync(["git", "check-ignore", "-q", ".claude/settings.local.json"], { cwd: dir });
  expect(ignored.exitCode).toBe(0);
});
