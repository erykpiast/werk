import { afterAll, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const HOOK = join(ROOT, "src", "claude", "lint-hook.ts");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const SAMPLE = join(import.meta.dir, "hook", "sample.tsx");
afterAll(() => rmSync(SAMPLE, { force: true }));

function hook(file: string) {
  const r = Bun.spawnSync(["bun", HOOK], { cwd: ROOT, stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { file_path: file } })), stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

// ---------- 48 ----------

test("48.1 a make target is allowed; accept, remove and restore ask whatever a personal file allows", () => {
  const { allow, ask } = settings.permissions;
  expect(allow).toContain("Bash(make:*)");
  expect(ask.some((r: string) => r.startsWith("Bash(make"))).toBe(false);
  for (const verb of ["accept", "remove", "restore"]) {
    expect(ask).toContain(`Bash(werk ${verb}:*)`);
    expect(ask).toContain(`Bash(bun src/cli.ts ${verb}:*)`);
  }
  // A personal allow entry for every werk command sits in the same list as these allows.
  // Claude Code resolves a command that matches both an ask rule and an allow rule as ask (deny, then ask, then allow).
  expect(allow).toContain("Bash(werk:*)");
  expect(settings.permissions.deny ?? []).toEqual([]);
});

test("48.2 a hook repairs unused imports and indentation silently, and shows a lint error that remains", () => {
  writeFileSync(SAMPLE, 'import { useEffect, useState } from "react";\nimport { unused } from "./nothing.ts";\nexport function A() {\n      const [n, setN] = useState(0);\n  return <button type="button" onClick={() => setN(n + 1)}>{n}</button>;\n}\n');
  const first = hook(SAMPLE);
  expect(first.code).toBe(0);
  expect(first.err).toBe("");
  const fixed = readFileSync(SAMPLE, "utf8");
  expect(fixed).not.toContain("unused");
  expect(fixed).toContain("\n  const [n, setN]");
  const withHook = (deps: string) =>
    `import { useEffect, useState } from "react";\nexport function A() {\n  const [n, setN] = useState(0);\n  const [m, setM] = useState(0);\n  useEffect(() => {\n    setM(n + m);\n  }, ${deps});\n  return (\n    <button type="button" onClick={() => setN(n + 1)}>\n      {n}\n    </button>\n  );\n}\n`;
  writeFileSync(SAMPLE, withHook("[]"));
  const second = hook(SAMPLE);
  expect(second.code).toBe(2);
  expect(`${second.out}${second.err}`).toMatch(/useExhaustiveDependencies|dependenc/i);
  expect(readFileSync(SAMPLE, "utf8")).toContain("useEffect");
  writeFileSync(SAMPLE, withHook("[n, m]"));
  const third = hook(SAMPLE);
  expect(third.code).toBe(0);
  expect(`${third.out}${third.err}`).toBe("");
});

test("48.3 a copied subagent fails the check and a restored link passes it", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-links-"));
  try {
    const defs = join(root, "src", "agent", "subagents");
    const agents = join(root, ".claude", "agents");
    mkdirSync(defs, { recursive: true });
    mkdirSync(agents, { recursive: true });
    for (const name of ["prototyper", "test-scope"]) {
      copyFileSync(join(ROOT, "src", "agent", "subagents", `${name}.md`), join(defs, `${name}.md`));
      symlinkSync(`../../src/agent/subagents/${name}.md`, join(agents, `${name}.md`));
    }
    writeFileSync(join(agents, "dev-only.md"), "---\nname: dev-only\n---\nonly for werk's own development\n");
    const check = () => Bun.spawnSync(["bun", "src/claude/check-subagent-links.ts", root], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(check().exitCode).toBe(0);
    rmSync(join(agents, "prototyper.md"));
    copyFileSync(join(defs, "prototyper.md"), join(agents, "prototyper.md"));
    let r = check();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toMatch(/prototyper.*(not a link|copy)/);
    rmSync(join(agents, "prototyper.md"));
    symlinkSync("../../src/agent/subagents/prototyper.md", join(agents, "prototyper.md"));
    expect(check().exitCode).toBe(0);
    rmSync(join(agents, "test-scope.md"));
    r = check();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toMatch(/test-scope.*no link/);
    expect(lstatSync(join(agents, "dev-only.md")).isFile()).toBe(true);
    expect(r.stderr.toString()).not.toContain("dev-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const { allow } = settings.permissions;
  expect(allow).toEqual(expect.arrayContaining(["Bash(make:*)", "Bash(werk:*)"]));
  for (const rule of allow as string[]) expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
  expect(allow.some((r: string) => /curl|wget|ssh|git push|rm |sudo/.test(r))).toBe(false);
  expect(settings.mcpServers).toBeUndefined();
  expect(Bun.spawnSync(["test", "-e", join(ROOT, ".mcp.json")]).exitCode).not.toBe(0);
  expect(Bun.spawnSync(["test", "-e", join(ROOT, ".claude", "skills")]).exitCode).not.toBe(0);
  const ignored = Bun.spawnSync(["git", "check-ignore", "-q", ".claude/settings.local.json"], { cwd: ROOT });
  expect(ignored.exitCode).toBe(0);
});

// ---------- 50 ----------

test("50.1 / 50.2 / 50.4 the workflow runs on push and pull request, the checks as separate steps, with the pinned Bun", () => {
  expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
  expect(ci).toMatch(/pull_request:/);
  const runs = [...ci.matchAll(/- run: (.+)/g)].map((m) => m[1]);
  expect(runs).toEqual(["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]);
  expect(ci).toMatch(/bun-version-file: \.bun-version/);
  const lines = ci.split("\n");
  const bunAt = lines.findIndex((l) => l.includes("setup-bun"));
  const lintAt = lines.findIndex((l) => l.includes("make lint"));
  expect(bunAt).toBeLessThan(lintAt);
  expect(ci).not.toContain("continue-on-error");
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  expect(pkg.scripts.smoke).toContain("release/build.ts");
  expect(pkg.scripts.smoke).toContain("--current");
  expect(pkg.scripts.smoke).toContain("release/smoke.ts");
  const frozen = Bun.spawnSync(["make", "-n", "lint"], { cwd: ROOT, stdout: "pipe" }).stdout.toString();
  expect(frozen + readFileSync(join(ROOT, "Makefile"), "utf8")).toContain("bun install --frozen-lockfile");
});

test("50.5 an executable that does not serve the map fails the smoke step", () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-smoke-"));
  try {
    const stub = join(dir, "werk-stub");
    writeFileSync(stub, '#!/bin/sh\necho "werk: serving on http://127.0.0.1:9"\nsleep 3\n');
    chmodSync(stub, 0o755);
    const r = Bun.spawnSync(["bun", "src/release/smoke.ts", stub], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).not.toBe(0);
    const noAddress = join(dir, "werk-silent");
    writeFileSync(noAddress, "#!/bin/sh\nsleep 3\n");
    chmodSync(noAddress, 0o755);
    const r2 = Bun.spawnSync(["bun", "src/release/smoke.ts", noAddress], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(r2.exitCode).not.toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120000);
