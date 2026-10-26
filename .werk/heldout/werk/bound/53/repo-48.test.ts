import { expect, test } from "bun:test";
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const settings = JSON.parse(
  readFileSync(join(REPO, ".claude/settings.json"), "utf8"),
);
const allow: string[] = settings.permissions?.allow ?? [];
const ask: string[] = settings.permissions?.ask ?? [];

/** Claude Code's rule syntax: `Bash(prefix:*)` matches a command that starts with the prefix. */
const matches = (rule: string, command: string) => {
  const m = /^Bash\((.*):\*\)$/.exec(rule);
  if (!m) return false;
  const prefix = m[1] as string;
  return command === prefix || command.startsWith(`${prefix} `);
};
/** Claude Code order: deny, then ask, then allow. A personal allow cannot override a shared ask. */
const decide = (command: string, personalAllow: string[] = []) => {
  if (ask.some((r) => matches(r, command))) return "ask";
  if ([...allow, ...personalAllow].some((r) => matches(r, command)))
    return "allow";
  return "ask-default";
};

test("48.1 a make target runs freely while accept, remove and restore still ask", () => {
  const personal = ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"];
  expect(decide("make lint", personal)).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} auth --actor you`, personal)).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} auth`, personal)).toBe("ask");
  }
  // The personal allow of every werk command does not turn the question off.
  expect(decide("werk show root", personal)).toBe("allow");
});

/** A temp project with the repo's biome config, so the hook formats like the real one. */
function sandbox() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "heldout-48-")));
  cpSync(join(REPO, "biome.json"), join(dir, "biome.json"));
  cpSync(join(REPO, "tsconfig.json"), join(dir, "tsconfig.json"));
  cpSync(join(REPO, ".gitignore"), join(dir, ".gitignore"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, "client"), { recursive: true });
  return dir;
}
function hook(dir: string, file: string) {
  const run = Bun.spawnSync(["bun", join(REPO, "src/claude/lint-hook.ts")], {
    cwd: dir,
    stdin: new TextEncoder().encode(
      JSON.stringify({ tool_input: { file_path: file } }),
    ),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: run.exitCode,
    out: run.stdout.toString() + run.stderr.toString(),
  };
}

test("48.2 an edit with an unused import is repaired silently, and a hook lint error is shown", () => {
  const dir = sandbox();
  try {
    const file = join(dir, "client", "thing.tsx");
    writeFileSync(
      file,
      `import { useState } from "react";\nimport { useEffect } from "react";\nexport function A() {\n      const [n] = useState(0);\n  return <p>{n}</p>;\n}\n`,
    );
    const first = hook(dir, file);
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("useEffect");
    expect(after).toContain("  const [n] = useState(0);");
    expect(first.code).toBe(0);
    expect(first.out.trim()).toBe("");

    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\nexport function A({ k }: { k: number }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(k);\n  }, []);\n  return <p>{n}</p>;\n}\n`,
    );
    const second = hook(dir, file);
    expect(existsSync(file)).toBe(true);
    expect(second.out).toContain("useExhaustiveDependencies");
    expect(second.code).toBe(2);

    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\nexport function A({ k }: { k: number }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(k);\n  }, [k]);\n  return <p>{n}</p>;\n}\n`,
    );
    const third = hook(dir, file);
    expect(third.code).toBe(0);
    expect(third.out.trim()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function linkCheck(root: string) {
  const run = Bun.spawnSync(
    ["bun", join(REPO, "src/claude/check-subagent-links.ts"), root],
    { stdout: "pipe", stderr: "pipe" },
  );
  return { code: run.exitCode, out: run.stderr.toString() + run.stdout.toString() };
}

test("48.3 a copied subagent fails the link check, a restored link passes", () => {
  const root = mkdtempSync(join(tmpdir(), "heldout-48-links-"));
  try {
    cpSync(join(REPO, "src/agent/subagents"), join(root, "src/agent/subagents"), {
      recursive: true,
    });
    mkdirSync(join(root, ".claude/agents"), { recursive: true });
    const shipped = readdirSync(join(root, "src/agent/subagents")).filter((f) =>
      f.endsWith(".md"),
    );
    expect(shipped.length).toBeGreaterThan(0);
    const agents = join(root, ".claude/agents");
    const relink = (f: string) =>
      symlinkSync(`../../src/agent/subagents/${f}`, join(agents, f));
    for (const f of shipped) relink(f);
    expect(linkCheck(root).code).toBe(0);

    const one = shipped[0] as string;
    rmSync(join(agents, one));
    cpSync(join(root, "src/agent/subagents", one), join(agents, one));
    let r = linkCheck(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain(one.replace(/\.md$/, ""));
    expect(r.out).toContain("not a link");

    rmSync(join(agents, one));
    relink(one);
    expect(linkCheck(root).code).toBe(0);

    rmSync(join(agents, one));
    r = linkCheck(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain(one.replace(/\.md$/, ""));
    expect(r.out).toContain("no link");

    relink(one);
    writeFileSync(join(agents, "dev-only.md"), "---\nname: dev-only\n---\n");
    expect(linkCheck(root).code).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.4 the shared settings are small and safe, with no skills or servers", () => {
  // every make target and the werk command line are allowed
  expect(allow.some((r) => matches(r, "make lint"))).toBe(true);
  expect(allow.some((r) => matches(r, "make e2e"))).toBe(true);
  expect(allow.some((r) => matches(r, "werk show root"))).toBe(true);
  // no allowed pattern writes outside the repository or reaches the network
  const risky = /\b(curl|wget|ssh|scp|nc|rm|mv|cp|git push|npm|npx|bunx|gh|chmod|sudo|>|tee)\b/;
  for (const rule of allow) expect(risky.test(rule)).toBe(false);
  // no skills, no MCP servers
  expect(existsSync(join(REPO, ".claude/skills"))).toBe(false);
  expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
  expect(JSON.stringify(settings)).not.toContain("mcpServers");
  // personal settings file is ignored by git, in a real temp repo that uses the repo's .gitignore
  const dir = mkdtempSync(join(tmpdir(), "heldout-48-git-"));
  try {
    Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
    cpSync(join(REPO, ".gitignore"), join(dir, ".gitignore"));
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude/settings.local.json"), "{}");
    const status = Bun.spawnSync(["git", "status", "--porcelain", "-uall"], {
      cwd: dir,
      stdout: "pipe",
    }).stdout.toString();
    expect(status).not.toContain("settings.local.json");
    const ignored = Bun.spawnSync(
      ["git", "check-ignore", ".claude/settings.local.json"],
      { cwd: dir },
    );
    expect(ignored.exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
