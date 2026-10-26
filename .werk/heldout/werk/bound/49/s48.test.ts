import { expect, setDefaultTimeout, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

setDefaultTimeout(120000);

const REPO = resolve(import.meta.dirname, "..");
const settings = JSON.parse(
  readFileSync(join(REPO, ".claude/settings.json"), "utf8"),
) as {
  permissions: { allow: string[]; ask: string[]; deny?: string[] };
  hooks: unknown;
};

/** Claude Code's rule: ask beats allow, whichever settings file each rule came from. */
function decide(
  command: string,
  personalAllow: string[] = [],
): "allow" | "ask" | "none" {
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
  if (settings.permissions.ask.some(matches)) return "ask";
  if ([...settings.permissions.allow, ...personalAllow].some(matches))
    return "allow";
  return "none";
}

test("48.1 a make target runs freely while accept, remove and restore still ask", () => {
  const personal = ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"];
  expect(decide("make lint", personal)).toBe("allow");
  expect(decide("make test", personal)).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} login --actor you`, personal)).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} login --actor you`, personal)).toBe(
      "ask",
    );
  }
  expect(decide("werk show login", personal)).toBe("allow");
});

function runHook(file: string) {
  const run = Bun.spawnSync(["bun", join(REPO, "src/claude/lint-hook.ts")], {
    cwd: REPO,
    stdin: new TextEncoder().encode(
      JSON.stringify({ tool_input: { file_path: file } }),
    ),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

test("48.2 the hook repairs an unused import and reports a missing hook dependency", () => {
  const dir = join(REPO, ".werk-heldout", "tmp-hook");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "Widget.tsx");
  try {
    writeFileSync(
      file,
      `import { useState, useEffect } from "react";
export function Widget() {
      const [n] = useState(0);
  return <p>{n}</p>;
}
`,
    );
    const first = runHook(file);
    expect(first.code).toBe(0);
    expect(`${first.stdout}${first.stderr}`.trim()).toBe("");
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("useEffect");
    expect(after).toContain('import { useState } from "react";');
    expect(after).toContain("\n  const [n] = useState(0);");

    writeFileSync(
      file,
      `import { useEffect, useState } from "react";
export function Widget({ id }: { id: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(id);
  }, []);
  return <p>{n}</p>;
}
`,
    );
    const second = runHook(file);
    expect(readFileSync(file, "utf8")).toContain("setN(id)");
    expect(second.code).toBe(2);
    expect(`${second.stdout}${second.stderr}`).toMatch(
      /useExhaustiveDependencies|dependenc/,
    );

    writeFileSync(
      file,
      `import { useEffect, useState } from "react";
export function Widget({ id }: { id: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(id);
  }, [id]);
  return <p>{n}</p>;
}
`,
    );
    const third = runHook(file);
    expect(third.code).toBe(0);
    expect(`${third.stdout}${third.stderr}`.trim()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A tiny repository root: the shipped definitions, a link to each, and a development-only file. */
function fakeRoot() {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-48-"));
  mkdirSync(join(root, "src/agent/subagents"), { recursive: true });
  mkdirSync(join(root, ".claude/agents"), { recursive: true });
  for (const name of ["prototyper", "test-scope"]) {
    copyFileSync(
      join(REPO, "src/agent/subagents", `${name}.md`),
      join(root, "src/agent/subagents", `${name}.md`),
    );
    symlinkSync(
      `../../src/agent/subagents/${name}.md`,
      join(root, ".claude/agents", `${name}.md`),
    );
  }
  return root;
}
const checkLinks = (root: string) => {
  const run = Bun.spawnSync(
    ["bun", join(REPO, "src/claude/check-subagent-links.ts"), root],
    { cwd: REPO, stdout: "pipe", stderr: "pipe" },
  );
  return { code: run.exitCode, all: `${run.stdout}${run.stderr}` };
};

test("48.3 a copied subagent fails the check and a restored link passes it", () => {
  const root = fakeRoot();
  try {
    // A subagent only werk's own development uses stays a plain file.
    writeFileSync(
      join(root, ".claude/agents/dev-only.md"),
      "---\nname: dev-only\n---\nonly for development\n",
    );
    expect(checkLinks(root).code).toBe(0);

    const copy = join(root, ".claude/agents/prototyper.md");
    unlinkSync(copy);
    copyFileSync(join(root, "src/agent/subagents/prototyper.md"), copy);
    const copied = checkLinks(root);
    expect(copied.code).not.toBe(0);
    expect(copied.all).toContain("prototyper");
    expect(copied.all).toMatch(/not a link|copy/);

    unlinkSync(copy);
    symlinkSync("../../src/agent/subagents/prototyper.md", copy);
    expect(checkLinks(root).code).toBe(0);

    unlinkSync(join(root, ".claude/agents/test-scope.md"));
    const missing = checkLinks(root);
    expect(missing.code).not.toBe(0);
    expect(missing.all).toContain("test-scope");
    expect(missing.all).toMatch(/no link/);
    expect(missing.all).not.toContain("dev-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.3b the check passes on the real repository", () => {
  expect(checkLinks(REPO).code).toBe(0);
});

test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const allow = settings.permissions.allow;
  expect(allow).toContain("Bash(make:*)");
  expect(allow).toContain("Bash(werk:*)");
  const network =
    /\b(curl|wget|ssh|scp|nc|npm|npx|bunx|pip|gh|git push|git fetch|git pull)\b/;
  const outside = /\b(rm|mv|cp|chmod|chown|tee|dd|sudo)\b|\s\/|~|\.\.\//;
  for (const rule of allow) {
    expect(rule).not.toMatch(network);
    expect(rule).not.toMatch(outside);
  }
  // No skill definition and no MCP server entry.
  expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
  expect(existsSync(join(REPO, ".claude/skills"))).toBe(false);
  expect(JSON.stringify(settings)).not.toMatch(
    /mcpServers|enabledMcpjsonServers/,
  );
  const skills: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (
        [".git", "node_modules", ".werk-heldout", "dist", "coverage"].includes(
          e.name,
        )
      )
        continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "SKILL.md") skills.push(p);
    }
  };
  walk(REPO);
  expect(skills).toEqual([]);
  // A personal settings file is ignored by git.
  const ignored = Bun.spawnSync(
    ["git", "check-ignore", "-q", ".claude/settings.local.json"],
    { cwd: REPO },
  );
  expect(ignored.exitCode).toBe(0);
});
