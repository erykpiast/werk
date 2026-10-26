import { expect, test } from "bun:test";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

/** Claude Code's own order: a deny rule beats an ask rule, and an ask rule beats an allow rule. */
function decide(command: string, files: { allow?: string[]; ask?: string[]; deny?: string[] }[]) {
  const hit = (rules: string[]) =>
    rules.some((rule) => {
      const m = /^Bash\((.*?)(:\*)?\)$/.exec(rule);
      if (!m) return false;
      const prefix = m[1] as string;
      return m[2] ? command === prefix || command.startsWith(`${prefix} `) : command === prefix;
    });
  const all = (key: "allow" | "ask" | "deny") => files.flatMap((f) => f[key] ?? []);
  if (hit(all("deny"))) return "deny";
  if (hit(all("ask"))) return "ask";
  if (hit(all("allow"))) return "allow";
  return "ask";
}

test("48.1 a make target runs freely while an accept command still asks", () => {
  const shared = settings.permissions;
  const personal = { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)", "Bash(*)"] };
  expect(decide("make lint", [shared, personal])).toBe("allow");
  expect(decide("make lint", [shared])).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    for (const prefix of ["werk", "bun src/cli.ts"]) {
      expect(decide(`${prefix} ${verb} login --actor you`, [shared])).toBe("ask");
      expect(decide(`${prefix} ${verb} login --actor you`, [shared, personal])).toBe("ask");
    }
  }
  expect(decide("werk show root", [shared])).toBe("allow");
});

const input = (path: string) => JSON.stringify({ tool_input: { file_path: path } });

async function runHook(path: string) {
  const entry = settings.hooks.PostToolUse.find((h: { matcher: string }) => /Edit/.test(h.matcher));
  expect(entry.matcher).toMatch(/Write/);
  const command: string = entry.hooks[0].command;
  const child = Bun.spawn(["sh", "-c", command], {
    cwd: ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    stdin: new Response(input(path)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
}

test("48.2 an edit that leaves an unused import is repaired and the agent hears nothing", async () => {
  const dir = mkdtempSync(join(ROOT, ".werk-heldout", "hook-"));
  try {
    const file = join(dir, "widget.tsx");
    writeFileSync(
      file,
      'import { useEffect, useState } from "react";\nimport { unusedThing } from "./nowhere";\nexport function W() {\n      const [a] = useState(1);\n  return <p>{a}</p>;\n}\n',
    );
    const first = await runHook(file);
    expect(first.code).toBe(0);
    expect(first.err.trim()).toBe("");
    expect(first.out.trim()).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("unusedThing");
    expect(fixed).not.toContain("useEffect");
    expect(fixed).toContain("\n  const [a] = useState(1);");

    writeFileSync(
      file,
      `${fixed.replace('import { useState }', "import { useEffect, useState }").replace("  return <p>", "  useEffect(() => {\n    console.log(a);\n  }, []);\n  return <p>")}`,
    );
    const second = await runHook(file);
    expect(second.code).toBe(2);
    expect(`${second.err}${second.out}`).toMatch(/useExhaustiveDependencies|dependenc/i);
    expect(readFileSync(file, "utf8")).toContain("useEffect");

    writeFileSync(file, readFileSync(file, "utf8").replace("}, []);", "}, [a]);"));
    const third = await runHook(file);
    expect(third.code).toBe(0);
    expect(`${third.err}${third.out}`.trim()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

test("48.3 a copied subagent fails the check and a restored link passes it", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-ho-links-"));
  try {
    mkdirSync(join(root, ".claude", "agents"), { recursive: true });
    cpSync(join(ROOT, "src", "agent", "subagents"), join(root, "src", "agent", "subagents"), { recursive: true });
    const names = ["prototyper", "test-scope"];
    const link = (n: string) =>
      symlinkSync(`../../src/agent/subagents/${n}.md`, join(root, ".claude", "agents", `${n}.md`));
    for (const n of names) link(n);
    const check = () =>
      Bun.spawnSync(["bun", join(ROOT, "src/claude/check-subagent-links.ts"), root], { cwd: ROOT });
    const text = (r: ReturnType<typeof check>) => `${r.stdout}${r.stderr}`;
    expect(check().exitCode).toBe(0);

    const path = join(root, ".claude", "agents", "prototyper.md");
    unlinkSync(path);
    copyFileSync(join(root, "src/agent/subagents/prototyper.md"), path);
    const copied = check();
    expect(copied.exitCode).not.toBe(0);
    expect(text(copied)).toContain("prototyper");
    expect(text(copied)).toMatch(/not a link/);

    unlinkSync(path);
    link("prototyper");
    expect(check().exitCode).toBe(0);

    unlinkSync(join(root, ".claude", "agents", "test-scope.md"));
    const missing = check();
    expect(missing.exitCode).not.toBe(0);
    expect(text(missing)).toContain("test-scope");
    link("test-scope");

    writeFileSync(join(root, ".claude", "agents", "dev-only.md"), "---\nname: dev-only\n---\nOnly werk's own development uses this.\n");
    expect(check().exitCode).toBe(0);
    expect(lstatSync(join(root, ".claude", "agents", "dev-only.md")).isSymbolicLink()).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const allow: string[] = settings.permissions.allow;
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((r) => /^Bash\((werk|bun src\/cli\.ts)/.test(r))).toBe(true);
  const risky = /curl|wget|ssh|scp|git push|npm|npx|pip|brew|rm |sudo|tee|cp |mv |>|~\/|\/etc|Write\(|Edit\(/;
  for (const rule of allow) expect(rule).not.toMatch(risky);
  expect(JSON.stringify(settings)).not.toMatch(/mcpServers|enabledMcp/);
  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(existsSync(join(ROOT, ".claude", "skills"))).toBe(false);
  const ignored = Bun.spawnSync(["git", "check-ignore", "-q", ".claude/settings.local.json"], { cwd: ROOT });
  expect(ignored.exitCode).toBe(0);
});
