import { expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./helpers.ts";

const shared = JSON.parse(
  readFileSync(join(REPO, ".claude", "settings.json"), "utf8"),
) as {
  permissions: { allow?: string[]; ask?: string[]; deny?: string[] };
  hooks?: Record<string, { matcher: string; hooks: { command: string }[] }[]>;
  mcpServers?: unknown;
};

/** The documented order of Claude Code permission rules: deny, then ask, then allow, across every settings file. */
function decide(
  command: string,
  files: { allow?: string[]; ask?: string[]; deny?: string[] }[],
): "deny" | "ask" | "allow" | "default" {
  const matches = (rule: string) => {
    const m = /^Bash\((.*?)(:\*)?\)$/.exec(rule);
    if (!m) return false;
    const prefix = m[1] as string;
    return m[2] ? command === prefix || command.startsWith(`${prefix} `) : command === prefix;
  };
  for (const kind of ["deny", "ask", "allow"] as const) {
    if (files.some((f) => (f[kind] ?? []).some(matches))) return kind;
  }
  return "default";
}

test("48.1 a make target runs freely while an accept command still asks", () => {
  const personal = { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)", "Bash(make:*)"] };
  const files = [shared.permissions, personal];
  expect(decide("make lint", files)).toBe("allow");
  expect(decide("make lint", [shared.permissions])).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} login --actor you`, files)).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} login --actor you`, files)).toBe("ask");
    // with the personal allow gone the question still stands
    expect(decide(`werk ${verb} login --actor you`, [shared.permissions])).toBe("ask");
  }
  // the ask rules live in the shared file, not in a personal one
  expect((shared.permissions.ask ?? []).length).toBeGreaterThanOrEqual(3);
});

test("48.2 an edit that leaves an unused import is repaired and the agent hears nothing", async () => {
  expect(
    shared.hooks?.PostToolUse?.some(
      (h) => /Edit/.test(h.matcher) && h.hooks.some((x) => x.command.includes("lint-hook")),
    ),
  ).toBe(true);
  const dir = mkdtempSync(join(REPO, ".werk-heldout", ".hook-"));
  try {
    const file = join(dir, "Thing.tsx");
    const run = async () => {
      const proc = Bun.spawn(["bun", "src/claude/lint-hook.ts"], {
        cwd: REPO,
        stdin: new Response(JSON.stringify({ tool_input: { file_path: file } })),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, code };
    };
    writeFileSync(
      file,
      'import { useState } from "react";\n\nexport function Thing() {\n        const x = 1;\n            return <div>{x}</div>;\n}\n',
    );
    const first = await run();
    expect(first.code).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("useState");
    expect(fixed).toContain("\n  const x = 1;\n  return <div>{x}</div>;\n");

    writeFileSync(
      file,
      'import { useEffect } from "react";\n\nexport function Thing({ count }: { count: number }) {\n  useEffect(() => {\n    document.title = String(count);\n  }, []);\n  return <div />;\n}\n',
    );
    const second = await run();
    expect(readFileSync(file, "utf8")).toContain("document.title");
    expect(second.code).toBe(2);
    expect(second.stderr).toMatch(/useExhaustiveDependencies|dependenc/i);

    writeFileSync(
      file,
      'import { useEffect } from "react";\n\nexport function Thing({ count }: { count: number }) {\n  useEffect(() => {\n    document.title = String(count);\n  }, [count]);\n  return <div />;\n}\n',
    );
    const third = await run();
    expect(third.code).toBe(0);
    expect(third.stderr).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

test("48.3 a copied subagent fails the check and a restored link passes it", async () => {
  const root = mkdtempSync(join(tmpdir(), "werk-ho-agents-"));
  try {
    mkdirSync(join(root, ".claude", "agents"), { recursive: true });
    mkdirSync(join(root, "src", "agent", "subagents"), { recursive: true });
    const shipped = readdirSync(join(REPO, "src", "agent", "subagents")).filter((n) => n.endsWith(".md"));
    expect(shipped.length).toBeGreaterThan(0);
    for (const name of shipped) {
      copyFileSync(join(REPO, "src", "agent", "subagents", name), join(root, "src", "agent", "subagents", name));
    }
    const link = (name: string) =>
      symlinkSync(`../../src/agent/subagents/${name}`, join(root, ".claude", "agents", name));
    for (const name of shipped) link(name);
    const check = async () => {
      const proc = Bun.spawn(["bun", "src/claude/check-subagent-links.ts", root], {
        cwd: REPO,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { text: out + err, code };
    };
    expect((await check()).code).toBe(0);

    const [one, two] = shipped as [string, string];
    const oneName = one.replace(/\.md$/, "");
    const twoName = two.replace(/\.md$/, "");
    unlinkSync(join(root, ".claude", "agents", one));
    copyFileSync(join(root, "src", "agent", "subagents", one), join(root, ".claude", "agents", one));
    const copied = await check();
    expect(copied.code).not.toBe(0);
    expect(copied.text).toContain(oneName);
    expect(copied.text).toMatch(/not a link/);

    unlinkSync(join(root, ".claude", "agents", one));
    link(one);
    expect((await check()).code).toBe(0);

    unlinkSync(join(root, ".claude", "agents", two));
    const missing = await check();
    expect(missing.code).not.toBe(0);
    expect(missing.text).toContain(twoName);
    expect(missing.text).toMatch(/no link/);
    link(two);

    writeFileSync(join(root, ".claude", "agents", "dev-only.md"), "---\nname: dev-only\n---\nOnly for werk's own development.\n");
    expect((await check()).code).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);

test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const allow = shared.permissions.allow ?? [];
  const makefile = readFileSync(join(REPO, "Makefile"), "utf8");
  const targets = [...makefile.matchAll(/^([a-z0-9-]+):.*##/gm)].map((m) => m[1] as string);
  expect(targets.length).toBeGreaterThan(5);
  for (const target of targets) {
    expect(decide(`make ${target}`, [shared.permissions])).toBe("allow");
  }
  expect(decide("werk show root", [shared.permissions])).toBe("allow");
  expect(decide("werk add x --title y", [shared.permissions])).toBe("allow");
  // no allow entry names a command that writes outside the repository or reaches the network
  const risky = /\b(curl|wget|ssh|scp|rsync|nc|git push|gh|npm|npx|pip|brew|sudo|rm|mv|cp|tee|chmod|chown|dd|ln|bunx|bun install|bun add)\b/;
  for (const rule of allow) expect(rule).not.toMatch(risky);
  expect(allow.every((rule) => /^Bash\((make|werk|bun src\/cli\.ts):\*\)$/.test(rule))).toBe(true);

  expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
  expect(existsSync(join(REPO, ".claude", "skills"))).toBe(false);
  expect(shared.mcpServers).toBeUndefined();
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: REPO }).stdout.toString().split("\n");
  expect(tracked.some((f) => /(^|\/)SKILL\.md$/.test(f))).toBe(false);
  expect(tracked.some((f) => /\.mcp\.json$/.test(f))).toBe(false);

  // a personal settings file is ignored and is not listed as new
  const repo = mkdtempSync(join(tmpdir(), "werk-ho-git-"));
  try {
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
    copyFileSync(join(REPO, ".gitignore"), join(repo, ".gitignore"));
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".claude", "settings.local.json"), '{"permissions":{"allow":["Bash(git:*)"]}}\n');
    const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: repo }).stdout.toString();
    expect(status).not.toContain("settings.local.json");
    const ignored = Bun.spawnSync(["git", "check-ignore", ".claude/settings.local.json"], { cwd: repo });
    expect(ignored.exitCode).toBe(0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
