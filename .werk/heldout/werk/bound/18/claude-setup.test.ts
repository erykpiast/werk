import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./support.ts";

type Settings = {
  permissions?: { allow?: string[]; ask?: string[]; deny?: string[] };
  [key: string]: unknown;
};
const shared: Settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

/** Claude Code's prefix rule for Bash: `Bash(cmd:*)` matches the command and anything after it. */
function matches(rule: string, command: string): boolean {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const body = m[1] as string;
  if (body.endsWith(":*")) {
    const prefix = body.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return command === body;
}

/** Deny beats ask, and ask beats allow, over the shared and the personal settings together. */
function decide(command: string, ...files: Settings[]): "deny" | "ask" | "allow" | "prompt" {
  const rules = (key: "deny" | "ask" | "allow") =>
    files.flatMap((f) => f.permissions?.[key] ?? []);
  for (const key of ["deny", "ask", "allow"] as const) {
    if (rules(key).some((r) => matches(r, command))) return key;
  }
  return "prompt";
}

const personal: Settings = { permissions: { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)", "Bash(*)"] } };

test("48.1 a make target runs freely while an accept command still asks", () => {
  expect(decide("make lint", shared, personal)).toBe("allow");
  expect(decide("make lint", shared)).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} login --actor you`, shared)).toBe("ask");
    expect(decide(`werk ${verb} login --actor you`, shared, personal)).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} login --actor you`, shared, personal)).toBe("ask");
  }
  // Another werk command is allowed without a question.
  expect(decide("werk show root", shared)).toBe("allow");
});

// ---------------------------------------------------------------- 48.2
function repoCopy(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-hook-")));
  for (const name of ["biome.json", "package.json", "tsconfig.json", ".gitignore"]) {
    cpSync(join(ROOT, name), join(dir, name));
  }
  // The Biome configuration reads the ignore file of a git repository.
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, "client"), { recursive: true });
  return dir;
}

function hook(dir: string, file: string) {
  const run = Bun.spawnSync(["bun", join(ROOT, "src", "claude", "lint-hook.ts")], {
    cwd: dir,
    stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { file_path: file } })),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

test("48.2 an edit that leaves an unused import is repaired and the agent hears nothing", () => {
  const dir = repoCopy();
  try {
    const file = join(dir, "client", "sample.tsx");
    writeFileSync(
      file,
      `import { useState } from "react";
import { clsx } from "clsx";

export function Sample() {
      const [n] = useState(0);
  return <div>{n}</div>;
}
`,
    );
    const first = hook(dir, file);
    expect(first.code).toBe(0);
    expect(first.out).toBe("");
    expect(first.err).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("clsx");
    expect(fixed).toContain("  const [n] = useState(0);");

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
    const second = hook(dir, file);
    expect(readFileSync(file, "utf8")).toContain("setN(id.length)");
    expect(second.code).toBe(2);
    expect(second.err).toContain("useExhaustiveDependencies");

    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("}, []);", "}, [id]);"),
    );
    const third = hook(dir, file);
    expect(third.code).toBe(0);
    expect(third.err).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- 48.3
function check(root: string) {
  const run = Bun.spawnSync(["bun", join(ROOT, "src", "claude", "check-subagent-links.ts"), root], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode, text: run.stdout.toString() + run.stderr.toString() };
}

test("48.3 a copied subagent fails the check and a restored link passes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-links-"));
  try {
    mkdirSync(join(dir, "src", "agent"), { recursive: true });
    cpSync(join(ROOT, "src", "agent", "subagents"), join(dir, "src", "agent", "subagents"), { recursive: true });
    mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
    for (const name of ["prototyper", "test-scope"]) {
      symlinkSync(`../../src/agent/subagents/${name}.md`, join(dir, ".claude", "agents", `${name}.md`));
    }
    // A subagent that only werk's own development uses is a plain file.
    writeFileSync(join(dir, ".claude", "agents", "dev-helper.md"), "---\nname: dev-helper\n---\nhelp\n");
    const agents = join(dir, ".claude", "agents");

    expect(check(dir).code).toBe(0);

    const target = readlinkSync(join(agents, "prototyper.md"));
    unlinkSync(join(agents, "prototyper.md"));
    cpSync(join(dir, "src", "agent", "subagents", "prototyper.md"), join(agents, "prototyper.md"));
    const copied = check(dir);
    expect(copied.code).not.toBe(0);
    expect(copied.text).toContain("prototyper");
    expect(copied.text).toMatch(/not a link/);
    expect(copied.text).not.toContain("test-scope");

    unlinkSync(join(agents, "prototyper.md"));
    symlinkSync(target, join(agents, "prototyper.md"));
    expect(check(dir).code).toBe(0);

    unlinkSync(join(agents, "test-scope.md"));
    const missing = check(dir);
    expect(missing.code).not.toBe(0);
    expect(missing.text).toContain("test-scope");
    expect(missing.text).not.toContain("dev-helper");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- 48.4
test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const allow = shared.permissions?.allow ?? [];
  const makefile = readFileSync(join(ROOT, "Makefile"), "utf8");
  const targets = [...makefile.matchAll(/^([a-z0-9-]+):.*## /gm)].map((m) => m[1] as string);
  expect(targets.length).toBeGreaterThan(5);
  for (const target of targets) {
    expect(allow.some((r) => matches(r, `make ${target}`))).toBe(true);
  }
  expect(allow.some((r) => matches(r, "werk show root"))).toBe(true);
  const risky = /\b(curl|wget|ssh|scp|nc|git push|npm|rm|mv|cp|tee|dd|sudo|chmod|pip|brew)\b|>|\/\.\.|~|\/Users|\/tmp/;
  for (const rule of allow) expect(rule).not.toMatch(risky);
  // Only the task runner and werk's command line are allowed.
  for (const rule of allow) expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);

  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(existsSync(join(ROOT, ".claude", "skills"))).toBe(false);
  expect(JSON.stringify(shared)).not.toMatch(/mcpServers|enabledMcpjsonServers/);

  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-ignore-"));
  try {
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    git("init", "-q", "-b", "main");
    cpSync(join(ROOT, ".gitignore"), join(dir, ".gitignore"));
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "settings.local.json"), '{"permissions":{"allow":["Bash(npm:*)"]}}');
    const status = git("status", "--porcelain").stdout.toString();
    expect(status).not.toContain("settings.local.json");
    expect(git("check-ignore", ".claude/settings.local.json").exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
