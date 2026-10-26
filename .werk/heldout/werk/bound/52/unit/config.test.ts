import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const ROOT = join(import.meta.dir, "..", "..");
let copy = "";
const sh = (cmd: string, cwd: string, env: Record<string, string> = {}, input?: string) => {
  const r = Bun.spawnSync(["sh", "-c", cmd], { cwd, env: { ...process.env, ...env } as Record<string, string>, stdin: input ? new TextEncoder().encode(input) : undefined });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

beforeAll(() => {
  copy = realpathSync(mkdtempSync(join(tmpdir(), "werk-held-cfg-")));
  const tar = sh(`git archive HEAD | tar -x -C "${copy}"`, ROOT);
  if (tar.code !== 0) throw new Error(tar.err);
  sh(`cp -cR "${join(ROOT, "node_modules")}" "${join(copy, "node_modules")}"`, ROOT);
  sh("git init -q -b main && git add -A && git -c user.name=t -c user.email=t@t commit -q -m start", copy);
});
afterAll(() => rmSync(copy, { recursive: true, force: true }));

const settings = () => JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));

describe("48 repository setup", () => {
  test("48.1 a make target runs freely while accept, remove and restore still ask", () => {
    const s = settings();
    const allow: string[] = s.permissions.allow;
    const ask: string[] = s.permissions.ask;
    // make lint is allowed with no question
    expect(allow.some((r) => r === "Bash(make:*)")).toBe(true);
    expect(ask.some((r) => /make/.test(r))).toBe(false);
    // the accept, remove and restore commands ask, in both forms of the command
    for (const verb of ["accept", "remove", "restore"]) {
      expect(ask).toContain(`Bash(werk ${verb}:*)`);
      expect(ask).toContain(`Bash(bun src/cli.ts ${verb}:*)`);
    }
    // a personal allow entry for every werk command does not remove the ask: the shared file keeps an ask rule
    // for each of them, and Claude Code decides an ask rule before an allow rule from any file.
    const personal = { permissions: { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"] } };
    for (const rule of personal.permissions.allow) expect(allow.concat(personal.permissions.allow)).toContain(rule);
    expect(ask.length).toBeGreaterThanOrEqual(6);
  });

  test("48.2 an edit that leaves an unused import is repaired, silently; a lint error is reported", () => {
    const file = join(copy, "client", "lib", "held-hook.tsx");
    const hook = (path: string) =>
      sh(`bun "${join(copy, "src/claude/lint-hook.ts")}"`, copy, { CLAUDE_PROJECT_DIR: copy }, JSON.stringify({ tool_input: { file_path: path } }));
    writeFileSync(
      file,
      `import { useState, useEffect } from "react";\nexport function A() {\n      const [n] = useState(0);\n  return <p>{n}</p>;\n}\n`,
    );
    const first = hook(file);
    expect(first.code, first.out + first.err).toBe(0);
    expect(first.out + first.err).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("useEffect");
    expect(fixed).toContain('  const [n] = useState(0);');
    // a hook with a missing dependency
    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\nexport function A({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, []);\n  return <p>{n}</p>;\n}\n`,
    );
    const second = hook(file);
    expect(existsSync(file)).toBe(true);
    expect(second.code).toBe(2);
    expect(second.err + second.out).toContain("useExhaustiveDependencies");
    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\nexport function A({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, [id]);\n  return <p>{n}</p>;\n}\n`,
    );
    const third = hook(file);
    expect(third.code).toBe(0);
    expect(third.out + third.err).toBe("");
  }, 120000);

  test("48.3 a copied subagent fails the check and a restored link passes", () => {
    const check = () => sh(`bun src/claude/check-subagent-links.ts "${copy}"`, copy);
    const agents = join(copy, ".claude", "agents");
    expect(check().code).toBe(0);
    const link = join(agents, "prototyper.md");
    const target = join(copy, "src/agent/subagents/prototyper.md");
    unlinkSync(link);
    cpSync(target, link);
    const bad = check();
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain("prototyper");
    expect(bad.err).toContain("not a link");
    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/prototyper.md", link);
    expect(check().code).toBe(0);
    unlinkSync(link);
    const missing = check();
    expect(missing.code).not.toBe(0);
    expect(missing.err).toContain("prototyper");
    expect(missing.err).toContain("no link");
    symlinkSync("../../src/agent/subagents/prototyper.md", link);
    writeFileSync(join(agents, "dev-only.md"), "---\nname: dev-only\ndescription: dev\n---\nonly for werk's own development\n");
    expect(lstatSync(join(agents, "dev-only.md")).isSymbolicLink()).toBe(false);
    expect(check().code).toBe(0);
  }, 120000);

  test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
    const s = settings();
    const allow: string[] = s.permissions.allow;
    expect(allow).toContain("Bash(make:*)");
    expect(allow.some((r) => r.startsWith("Bash(werk"))).toBe(true);
    // every make target and the werk command line are allowed, and nothing else
    for (const rule of allow) expect(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/.test(rule)).toBe(true);
    for (const rule of allow) expect(rule).not.toMatch(/curl|wget|ssh|scp|rm |sudo|npm|git push|\/\.\.|~|\/tmp/);
    expect(existsSync(join(ROOT, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
    expect(JSON.stringify(s)).not.toContain("mcpServers");
    expect(existsSync(join(ROOT, ".claude", "commands"))).toBe(false);
    // a personal settings file is ignored by git and not listed as new
    writeFileSync(join(copy, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }));
    const status = sh("git status --porcelain -uall", copy);
    expect(status.out).not.toContain("settings.local.json");
    expect(sh("git check-ignore .claude/settings.local.json", copy).code).toBe(0);
  });
});

describe("50 CI workflow", () => {
  const ci = () => readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const runs = () => [...ci().matchAll(/^\s*- run: (.+)$/gm)].map((m) => m[1]);

  test("50.1 a push to main runs every check as separate steps, builds and starts the executable", () => {
    const text = ci();
    expect(text).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(runs()).toEqual(["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]);
    // a clean machine: the locked packages install from a clean state by the make targets
    const dry = sh("make -n lint", copy.replace(/$/, "")).out;
    expect(readFileSync(join(ROOT, "Makefile"), "utf8")).toContain("bun install --frozen-lockfile");
    const clean = mkdtempSync(join(tmpdir(), "werk-held-clean-"));
    sh(`git archive HEAD | tar -x -C "${clean}"`, ROOT);
    expect(sh("make -n lint", clean).out).toContain("bun install --frozen-lockfile");
    rmSync(clean, { recursive: true, force: true });
    void dry;
    expect(readFileSync(join(ROOT, "Makefile"), "utf8")).toMatch(/smoke:.*\n\tbun run smoke/);
  });

  test("50.4 the run installs the Bun version that the repository pins", () => {
    expect(ci()).toMatch(/oven-sh\/setup-bun@v\d[\s\S]*bun-version-file: \.bun-version/);
    const lines = ci().split("\n");
    const setup = lines.findIndex((l) => l.includes("setup-bun"));
    const firstCheck = lines.findIndex((l) => l.includes("make lint"));
    expect(setup).toBeGreaterThan(-1);
    expect(setup).toBeLessThan(firstCheck);
    expect(ci()).not.toMatch(/bun-version:\s*['"]?\d/);
    expect(readFileSync(join(ROOT, ".bun-version"), "utf8").trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("50.5 an executable that does not serve the map fails the smoke step", async () => {
    // a server that answers every map read with 500, and an "executable" that names its address
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });
    const dir = mkdtempSync(join(tmpdir(), "werk-held-smoke-"));
    const exe = join(dir, "werk-fake");
    writeFileSync(exe, `#!/bin/sh\necho "werk: serving on http://127.0.0.1:${server.port}"\nsleep 30\n`, { mode: 0o755 });
    const proc = Bun.spawn(["bun", "src/release/smoke.ts", exe], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const r = { code: await proc.exited, err: await new Response(proc.stderr).text(), out: await new Response(proc.stdout).text() };
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("500");
    // the smoke step is the last step of the one job, so a failed smoke makes the run red
    expect(runs().at(-1)).toBe("make smoke");
    expect(ci()).not.toContain("continue-on-error");
  }, 90000);
});
