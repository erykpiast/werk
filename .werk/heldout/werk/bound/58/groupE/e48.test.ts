import { expect, test } from "bun:test";
import {
  copyFileSync,
  cpSync,
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

const REPO = join(import.meta.dir, "..", "..");
const settings = JSON.parse(
  readFileSync(join(REPO, ".claude/settings.json"), "utf8"),
);

test("48.1 make runs freely; accept/remove/restore are in the ask list (which outranks any allow)", () => {
  const allow: string[] = settings.permissions.allow;
  const ask: string[] = settings.permissions.ask;
  expect(allow).toContain("Bash(make:*)");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(ask).toContain(`Bash(werk ${verb}:*)`);
    expect(ask).toContain(`Bash(bun src/cli.ts ${verb}:*)`);
  }
  // No make rule in ask, no deny/ask entry for make.
  expect(ask.some((a) => a.includes("make"))).toBe(false);
});

function hook(root: string, file: string) {
  return Bun.spawnSync(
    [process.execPath, join(REPO, "src/claude/lint-hook.ts")],
    {
      cwd: REPO,
      stdin: Buffer.from(
        JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

test("48.2 hook repairs unused import silently, reports a hook-deps error", () => {
  const dir = join(REPO, ".werk-heldout", "groupE", "tmp-hook");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "Thing.tsx");
  try {
    writeFileSync(
      file,
      `import { useState } from "react";\nimport { useEffect } from "react";\nexport function A() {\n      const [n] = useState(0);\n  return <div>{n}</div>;\n}\n`,
    );
    const r1 = hook(REPO, file);
    const out1 = r1.stdout.toString() + r1.stderr.toString();
    const disk = readFileSync(file, "utf8");
    expect(disk).not.toContain("useEffect");
    expect(disk).toContain('\n  const [n] = useState(0);');
    expect(r1.exitCode).toBe(0);
    expect(out1).toBe("");

    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\nexport function A({ p }: { p: number }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(p);\n  }, []);\n  return <div>{n}</div>;\n}\n`,
    );
    const r2 = hook(REPO, file);
    const out2 = r2.stdout.toString() + r2.stderr.toString();
    expect(readFileSync(file, "utf8")).toContain("useEffect");
    expect(out2).toContain("useExhaustiveDependencies");
    expect(r2.exitCode).toBe(2);

    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\nexport function A({ p }: { p: number }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(p);\n  }, [p]);\n  return <div>{n}</div>;\n}\n`,
    );
    const r3 = hook(REPO, file);
    expect(r3.exitCode).toBe(0);
    expect(r3.stdout.toString() + r3.stderr.toString()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function check(root: string) {
  return Bun.spawnSync(
    [process.execPath, join(REPO, "src/claude/check-subagent-links.ts"), root],
    { cwd: REPO, stdout: "pipe", stderr: "pipe" },
  );
}

test("48.3 copied subagent fails, restored link passes, missing link fails, dev-only file passes", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-sub-"));
  try {
    mkdirSync(join(root, "src/agent"), { recursive: true });
    cpSync(join(REPO, "src/agent/subagents"), join(root, "src/agent/subagents"), {
      recursive: true,
    });
    mkdirSync(join(root, ".claude/agents"), { recursive: true });
    for (const n of ["prototyper", "test-scope"])
      symlinkSync(
        `../../src/agent/subagents/${n}.md`,
        join(root, `.claude/agents/${n}.md`),
      );
    expect(check(root).exitCode).toBe(0);

    rmSync(join(root, ".claude/agents/prototyper.md"));
    copyFileSync(
      join(root, "src/agent/subagents/prototyper.md"),
      join(root, ".claude/agents/prototyper.md"),
    );
    const bad = check(root);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr.toString()).toContain("prototyper");
    expect(bad.stderr.toString()).toMatch(/not a link/);

    rmSync(join(root, ".claude/agents/prototyper.md"));
    symlinkSync(
      "../../src/agent/subagents/prototyper.md",
      join(root, ".claude/agents/prototyper.md"),
    );
    expect(check(root).exitCode).toBe(0);

    rmSync(join(root, ".claude/agents/test-scope.md"));
    const missing = check(root);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain("test-scope");

    symlinkSync(
      "../../src/agent/subagents/test-scope.md",
      join(root, ".claude/agents/test-scope.md"),
    );
    writeFileSync(join(root, ".claude/agents/dev-only.md"), "---\nname: x\n---\n");
    expect(check(root).exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.4 settings are small, safe, no skills/MCP, local settings ignored", () => {
  const allow: string[] = settings.permissions.allow;
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((a) => a.startsWith("Bash(werk"))).toBe(true);
  for (const a of allow) {
    expect(a).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
    expect(a).not.toMatch(/curl|wget|ssh|rm |npm|git push|sudo/);
  }
  expect(existsSync(join(REPO, ".claude/skills"))).toBe(false);
  expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
  expect(JSON.stringify(settings)).not.toMatch(/mcpServers|enabledMcp/);
  const ig = Bun.spawnSync(
    ["git", "check-ignore", ".claude/settings.local.json"],
    { cwd: REPO },
  );
  expect(ig.exitCode).toBe(0);
});
