import { expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./support.ts";

type Settings = {
  permissions?: { allow?: string[]; ask?: string[]; deny?: string[] };
  hooks?: {
    PostToolUse?: {
      matcher: string;
      hooks: { type: string; command: string }[];
    }[];
  };
  mcpServers?: unknown;
};
const shared = (): Settings =>
  JSON.parse(readFileSync(join(REPO, ".claude", "settings.json"), "utf8"));

/** Claude Code's rule order: a matching ask rule decides before any allow rule, from any settings file. */
function matches(rule: string, command: string): boolean {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const pattern = m[1] as string;
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return command === pattern;
}
function decide(
  command: string,
  ...files: Settings[]
): "ask" | "allow" | "none" {
  const rules = (key: "allow" | "ask" | "deny") =>
    files.flatMap((f) => f.permissions?.[key] ?? []);
  if (rules("deny").some((r) => matches(r, command))) return "none";
  if (rules("ask").some((r) => matches(r, command))) return "ask";
  if (rules("allow").some((r) => matches(r, command))) return "allow";
  return "none";
}

test("48.1 a make target runs freely while an accept command still asks", () => {
  const personal: Settings = {
    permissions: { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"] },
  };
  expect(decide("make lint", shared(), personal)).toBe("allow");
  expect(decide("make lint", shared())).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} login --actor you`, shared(), personal)).toBe(
      "ask",
    );
    expect(
      decide(`bun src/cli.ts ${verb} login --actor you`, shared(), personal),
    ).toBe("ask");
  }
  expect(decide("werk show root", shared())).toBe("allow");
});

function tempProject() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-lint-")));
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
  copyFileSync(join(REPO, "biome.json"), join(root, "biome.json"));
  copyFileSync(join(REPO, ".gitignore"), join(root, ".gitignore"));
  copyFileSync(join(REPO, "package.json"), join(root, "package.json"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  mkdirSync(join(root, "client", "lib"), { recursive: true });
  return root;
}

function runHook(root: string, file: string) {
  const hook = shared().hooks?.PostToolUse?.[0];
  expect(hook?.matcher).toContain("Edit");
  const command = hook?.hooks[0]?.command as string;
  const run = Bun.spawnSync(["sh", "-c", command], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
    stdin: new TextEncoder().encode(
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: join(root, file) },
      }),
    ),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: run.exitCode,
    out: `${run.stdout.toString()}${run.stderr.toString()}`,
  };
}

test("48.2 an edit that leaves an unused import is repaired silently, and a hook error is reported", () => {
  const root = tempProject();
  try {
    const file = "client/lib/thing.tsx";
    writeFileSync(
      join(root, file),
      [
        'import { useEffect, useState } from "react";',
        'import { clsx } from "clsx";',
        "",
        "export function Thing() {",
        "    const [n] = useState(0);",
        "    return <p>{n}</p>;",
        "}",
        "",
      ].join("\n"),
    );
    const first = runHook(root, file);
    expect(first.code).toBe(0);
    expect(first.out.trim()).toBe("");
    const fixed = readFileSync(join(root, file), "utf8");
    expect(fixed).not.toContain("clsx");
    expect(fixed).not.toContain("useEffect");
    expect(fixed).toContain("  const [n] = useState(0);");
    expect(fixed).not.toContain("    const [n]");

    writeFileSync(
      join(root, file),
      [
        'import { useEffect, useState } from "react";',
        "",
        "export function Thing({ id }: { id: number }) {",
        "  const [n, setN] = useState(0);",
        "  useEffect(() => {",
        "    setN(id);",
        "  }, []);",
        "  return <p>{n}</p>;",
        "}",
        "",
      ].join("\n"),
    );
    const second = runHook(root, file);
    expect(readFileSync(join(root, file), "utf8")).toContain("setN(id)");
    expect(second.code).not.toBe(0);
    expect(second.out).toMatch(/useExhaustiveDependencies|dependenc/i);

    writeFileSync(
      join(root, file),
      readFileSync(join(root, file), "utf8").replace("}, []);", "}, [id]);"),
    );
    const third = runHook(root, file);
    expect(third.code).toBe(0);
    expect(third.out.trim()).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const SUBAGENTS = ["prototyper", "test-scope"];
const checkLinks = (root: string) => {
  const run = Bun.spawnSync(
    ["bun", join(REPO, "src", "claude", "check-subagent-links.ts"), root],
    { stdout: "pipe", stderr: "pipe" },
  );
  return { code: run.exitCode, out: `${run.stdout}${run.stderr}` };
};

test("48.3 a copied subagent fails the check and a restored link passes it", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-links-"));
  try {
    mkdirSync(join(root, "src", "agent", "subagents"), { recursive: true });
    mkdirSync(join(root, ".claude", "agents"), { recursive: true });
    const link = (name: string) =>
      symlinkSync(
        `../../src/agent/subagents/${name}.md`,
        join(root, ".claude", "agents", `${name}.md`),
      );
    for (const name of SUBAGENTS) {
      copyFileSync(
        join(REPO, "src", "agent", "subagents", `${name}.md`),
        join(root, "src", "agent", "subagents", `${name}.md`),
      );
      link(name);
    }
    expect(checkLinks(root).code).toBe(0);
    const target = join(root, ".claude", "agents", "prototyper.md");
    unlinkSync(target);
    copyFileSync(
      join(root, "src", "agent", "subagents", "prototyper.md"),
      target,
    );
    const copied = checkLinks(root);
    expect(copied.code).not.toBe(0);
    expect(copied.out).toContain("prototyper");
    expect(copied.out).toMatch(/not a link|copy/);
    unlinkSync(target);
    link("prototyper");
    expect(checkLinks(root).code).toBe(0);
    unlinkSync(join(root, ".claude", "agents", "test-scope.md"));
    const missing = checkLinks(root);
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain("test-scope");
    link("test-scope");
    writeFileSync(
      join(root, ".claude", "agents", "dev-only.md"),
      "---\nname: dev-only\n---\nonly dev\n",
    );
    expect(checkLinks(root).code).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const s = shared();
  const allow = s.permissions?.allow ?? [];
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((r) => r.startsWith("Bash(werk"))).toBe(true);
  const risky =
    /curl|wget|ssh|scp|rm |sudo|chmod|mv |cp |git push|npm|bunx|pip|brew|\.\.\/|~\/|\/etc|\/usr/;
  for (const rule of allow) {
    expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
    expect(risky.test(rule)).toBe(false);
  }
  expect(s.mcpServers).toBeUndefined();
  expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
  expect(existsSync(join(REPO, ".claude", "skills"))).toBe(false);
  const tracked = Bun.spawnSync(["git", "ls-files"], {
    cwd: REPO,
  }).stdout.toString();
  expect(tracked).not.toMatch(
    /SKILL\.md|\.mcp\.json|\.claude\/skills|\.claude\/commands/,
  );

  const root = mkdtempSync(join(tmpdir(), "werk-heldout-ignore-"));
  try {
    Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    mkdirSync(join(root, ".claude"));
    copyFileSync(join(REPO, ".gitignore"), join(root, ".gitignore"));
    writeFileSync(
      join(root, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Bash(git status:*)"] } }),
    );
    const status = Bun.spawnSync(
      ["git", "status", "--porcelain", "--untracked-files=all"],
      { cwd: root },
    ).stdout.toString();
    expect(status).not.toContain("settings.local.json");
    const ignored = Bun.spawnSync(
      ["git", "check-ignore", ".claude/settings.local.json"],
      { cwd: root },
    );
    expect(ignored.exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
