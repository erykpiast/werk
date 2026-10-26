import { expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { CHECKOUT, repoCopy, sh, tempDir } from "./p2-support.ts";

const settings = JSON.parse(
  readFileSync(join(CHECKOUT, ".claude/settings.json"), "utf8"),
);

/**
 * Claude Code's documented rule order: deny, then ask, then allow; the first list with a match wins,
 * whatever settings file the rule comes from. A rule `Bash(prefix:*)` matches a command that starts
 * with the prefix. This models that; it is not Claude Code itself.
 */
function decide(command: string, ...files: any[]): "deny" | "ask" | "allow" | "prompt" {
  const lists = (key: string): string[] =>
    files.flatMap((f) => f?.permissions?.[key] ?? []);
  const matches = (rule: string) => {
    const m = /^Bash\((.*):\*\)$/.exec(rule);
    if (m) return command === m[1] || command.startsWith(`${m[1]} `);
    const exact = /^Bash\((.*)\)$/.exec(rule);
    return exact ? command === exact[1] : false;
  };
  for (const kind of ["deny", "ask", "allow"] as const) {
    if (lists(kind).some(matches)) return kind;
  }
  return "prompt";
}

test("48.1 a make target runs freely while accept, remove and restore still ask", () => {
  const personal = {
    permissions: { allow: ["Bash(werk:*)", "Bash(bun:*)", "Bash(make:*)"] },
  };
  // make target: no question
  expect(decide("make lint", settings, personal)).toBe("allow");
  expect(decide("make typecheck", settings)).toBe("allow");
  // the werk verbs exist
  for (const verb of ["accept", "remove", "restore"]) {
    expect(existsSync(join(CHECKOUT, "src/verbs", `${verb}.ts`))).toBe(true);
    // the personal allow entry does not turn the question off
    expect(decide(`werk ${verb} some-card`, settings, personal)).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} some-card`, settings, personal)).toBe("ask");
    // and without the personal file it still asks (not merely denied or unlisted)
    expect(decide(`werk ${verb} some-card`, settings)).toBe("ask");
  }
  // the shared allow list alone would allow these, so the ask entry is what makes the question
  const allowOnly = { permissions: { allow: settings.permissions.allow } };
  expect(decide("werk accept some-card", allowOnly)).toBe("allow");
  // the hook is shared too
  expect(settings.hooks.PostToolUse[0].matcher).toBe("Write|Edit|MultiEdit");
});

function hookRun(root: string, file: string) {
  const command = settings.hooks.PostToolUse[0].hooks[0].command as string;
  const r = Bun.spawnSync(["sh", "-c", command], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    stdin: new TextEncoder().encode(
      JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } }),
    ),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
  };
}

test("48.2 the hook repairs the file silently, then reports an unfixable hook error, then goes quiet", () => {
  const root = repoCopy("lint");
  try {
    const file = join(root, "client", "p2-sample.tsx");
    // wrong indentation and an unused import
    const first =
      'import { useState } from "react";\nexport function A() {\n      return <div>hi</div>;\n}\n';
    writeFileSync(file, first);
    const r1 = hookRun(root, file);
    expect(r1.code, r1.stderr + r1.stdout).toBe(0);
    expect(r1.stdout).toBe("");
    expect(r1.stderr).toBe("");
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("useState");
    expect(after).toContain('\n  return <div>hi</div>;\n');
    expect(after).not.toContain("      return");

    // add a hook with a missing dependency: the edit is saved (the hook never reverts), the error is reported
    const second =
      'import { useEffect, useState } from "react";\nexport function A({ n }: { n: number }) {\n  const [v, setV] = useState(0);\n  useEffect(() => {\n    setV(n);\n  }, []);\n  return <div>{v}</div>;\n}\n';
    writeFileSync(file, second);
    const r2 = hookRun(root, file);
    expect(r2.code).toBe(2);
    expect(readFileSync(file, "utf8")).toContain("useEffect");
    expect(r2.stderr).toContain("useExhaustiveDependencies");
    expect(r2.stderr).toContain("n");

    // the fix: no output
    writeFileSync(file, second.replace("}, []);", "}, [n]);"));
    const r3 = hookRun(root, file);
    expect(r3.code).toBe(0);
    expect(r3.stdout + r3.stderr).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120000);

const check = (root: string) =>
  sh(["bun", "src/claude/check-subagent-links.ts", root], root);

test("48.3 a copied subagent fails the check, a restored link passes, a missing link fails, a dev-only file is fine", () => {
  const root = repoCopy("links");
  try {
    const agents = join(root, ".claude/agents");
    const ok = check(root);
    expect(ok.code, ok.stderr).toBe(0);

    // replace one link by a copy of the same file
    const link = join(agents, "prototyper.md");
    const target = join(root, "src/agent/subagents/prototyper.md");
    unlinkSync(link);
    copyFileSync(target, link);
    const copy = check(root);
    expect(copy.code).toBe(1);
    expect(copy.stderr).toContain("prototyper");
    expect(copy.stderr).toContain("not a link");
    expect(copy.stderr).not.toContain("test-scope");

    // restore the link
    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/prototyper.md", link);
    expect(check(root).code).toBe(0);

    // a plain file that only werk's own development uses
    writeFileSync(join(agents, "dev-only.md"), "---\nname: dev-only\n---\nx\n");
    expect(check(root).code).toBe(0);

    // remove the link of a shipped subagent
    unlinkSync(join(agents, "test-scope.md"));
    const gone = check(root);
    expect(gone.code).toBe(1);
    expect(gone.stderr).toContain("test-scope");
    expect(gone.stderr).toContain("no link");
    expect(gone.stderr).not.toContain("dev-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);

test("48.4 the shared settings are small, safe, free of skills and servers; a personal file is ignored", () => {
  const allow: string[] = settings.permissions.allow;
  expect(allow.length).toBeLessThanOrEqual(5);
  // every make target and the werk command line
  const makefile = readFileSync(join(CHECKOUT, "Makefile"), "utf8");
  const phony = /^\.PHONY:(.*)$/m.exec(makefile)?.[1]?.trim().split(/\s+/) ?? [];
  expect(phony.length).toBeGreaterThan(5);
  for (const target of phony) expect(decide(`make ${target}`, settings)).toBe("allow");
  expect(decide("werk help", settings)).toBe("allow");
  expect(decide("bun src/cli.ts help", settings)).toBe("allow");
  // no entry names a network program, a path outside the repository, or a destructive/publishing tool
  for (const rule of [...allow, ...settings.permissions.ask]) {
    expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts)[ :]/);
    expect(rule).not.toMatch(/curl|wget|ssh|scp|\bnc\b|fetch|npm|publish|git push|\brm\b|\bcp\b|\bmv\b|tee|sudo|\.\.|~|\/Users|\$HOME/);
  }
  // no skill and no MCP server entry
  const files = sh(["git", "ls-files", "-co", "--exclude-standard"], CHECKOUT).stdout
    .split("\n")
    .filter((f) => f && !f.startsWith(".werk-heldout/"));
  expect(files.filter((f) => /(^|\/)SKILL\.md$/.test(f) || f.startsWith(".claude/skills/"))).toEqual([]);
  expect(files.filter((f) => /(^|\/)\.mcp\.json$/.test(f))).toEqual([]);
  expect(JSON.stringify(settings)).not.toMatch(/mcpServers|enabledMcpjsonServers/);
  // personal settings file: ignored, not listed as new
  const ignored = sh(["git", "check-ignore", "-v", ".claude/settings.local.json"], CHECKOUT);
  expect(ignored.code).toBe(0);
  const root = repoCopy("ignore");
  try {
    writeFileSync(join(root, ".claude/settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }));
    const status = sh(["git", "status", "--porcelain", "--untracked-files=all"], root).stdout;
    expect(status).not.toContain("settings.local.json");
    expect(status).toContain(".claude/settings.json"); // the shared file is listed as untracked in the fresh copy: the check is real
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);

// ---------------------------------------------------------------- 50

const ciText = readFileSync(join(CHECKOUT, ".github/workflows/ci.yml"), "utf8");
const ci: any = Bun.YAML.parse(ciText);
const steps: any[] = ci.jobs.check.steps;
const runs = steps.map((s) => s.run).filter(Boolean) as string[];

test("50.1 the push run installs locked packages, runs five separate checks, builds and starts the executable", () => {
  expect(ci.on.push.branches).toContain("main");
  expect(ci.jobs.check["runs-on"]).toBe("ubuntu-latest");
  expect(steps[0].uses).toMatch(/^actions\/checkout/);
  expect(runs).toEqual([
    "make lint",
    "make typecheck",
    "make test",
    "make test-coverage",
    "make e2e",
    "make smoke",
  ]);
  for (const s of steps) {
    expect(s["continue-on-error"]).toBeUndefined();
    expect(s.if).toBeUndefined();
  }
  // no cache of node_modules: the runner is clean, and every make target installs from the lock file
  expect(ciText).not.toMatch(/actions\/cache|cache:/);
  const makefile = readFileSync(join(CHECKOUT, "Makefile"), "utf8");
  expect(makefile).toContain("bun install --frozen-lockfile");
  for (const t of ["lint", "typecheck", "test", "test-coverage", "e2e", "smoke"]) {
    expect(new RegExp(`^${t}:.*\\$\\(STAMP\\)`, "m").test(makefile)).toBe(true);
  }
  const tracked = sh(["git", "ls-files"], CHECKOUT).stdout.split("\n");
  expect(tracked.some((f) => f.startsWith("node_modules/"))).toBe(false);
  // dry run of `make lint` in a clean dir: the first thing it would run is the frozen install (-n runs nothing)
  const dir = tempDir("make-n");
  try {
    for (const f of ["Makefile", ".bun-version", "package.json", "bun.lock"]) {
      copyFileSync(join(CHECKOUT, f), join(dir, f));
    }
    const dry = sh(["make", "-n", "lint"], dir);
    expect(dry.code, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("bun install --frozen-lockfile");
    expect(dry.stdout).toContain("bun run lint");
    expect(dry.stdout.indexOf("bun install")).toBeLessThan(dry.stdout.indexOf("bun run lint"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // smoke target = build for this platform + start once + read the map
  expect(makefile).toMatch(/^smoke:.*\n\tbun run smoke/m);
  const pkg = JSON.parse(readFileSync(join(CHECKOUT, "package.json"), "utf8"));
  expect(pkg.scripts.smoke).toBe("bun src/release/build.ts dist/smoke --current && bun src/release/smoke.ts");
});

test("50.1b (evidence) the smoke commands really build the platform executable and read the map, in a copy", () => {
  const root = repoCopy("smoke");
  try {
    const out = sh(["bun", "run", "smoke"], root);
    expect(out.code, out.stderr + out.stdout).toBe(0);
    expect(out.stdout).toContain("the executable served its map");
    expect(existsSync(join(root, "dist/smoke/werk-darwin-arm64")) || existsSync(join(root, `dist/smoke/werk-${process.platform}-${process.arch}`))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 300000);

test("50.2 the pull request gets the same run; gating the merge button needs a GitHub setting that the repository files cannot hold", () => {
  expect(ci.on).toHaveProperty("pull_request");
  expect(ci.on.pull_request === null || ci.on.pull_request.branches === undefined).toBe(true);
  expect(ci.on.pull_request?.["paths-ignore"]).toBeUndefined();
  // one job, so every step is in one check that a branch rule can require; no step is conditional on the event
  expect(Object.keys(ci.jobs)).toEqual(["check"]);
  expect(ciText).not.toMatch(/github\.event_name/);
  // what the repository configures for the merge button: nothing (informational)
  const gh = sh(["git", "ls-files", ".github"], CHECKOUT).stdout.split("\n").filter(Boolean);
  expect(gh).toEqual([".github/workflows/ci.yml"]);
});

test("50.3 a failed step turns the run red and nothing in the workflow can undo the merge", () => {
  expect(ci.permissions).toEqual({ contents: "read" });
  expect(ciText).not.toMatch(/git (push|revert|reset)|gh pr|gh api|\|\| true|continue-on-error/);
  // a type error on a clean machine: the typecheck exits non-zero and names the file
  const root = repoCopy("typeerr");
  try {
    writeFileSync(join(root, "src/p2-bad.ts"), 'export const n: number = "text";\n');
    const r = sh(["bun", "run", "typecheck"], root);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("src/p2-bad.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120000);

test("50.4 the run installs the pinned Bun before any check, from the pin file", () => {
  const pin = readFileSync(join(CHECKOUT, ".bun-version"), "utf8").trim();
  expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
  const setup = steps.findIndex((s) => /^oven-sh\/setup-bun@/.test(s.uses ?? ""));
  const firstRun = steps.findIndex((s) => s.run);
  expect(setup).toBeGreaterThan(-1);
  expect(setup).toBeLessThan(firstRun);
  expect(steps[setup].with).toEqual({ "bun-version-file": ".bun-version" });
  // no second copy of a version number in the workflow, so a new pin is the only edit
  expect(ciText).not.toMatch(/bun-version:\s*\S/);
  expect(ciText).not.toContain(pin);
  // the make targets fail when the installed Bun differs from the pin
  const dir = tempDir("pin");
  try {
    for (const f of ["Makefile", "package.json", "bun.lock"]) copyFileSync(join(CHECKOUT, f), join(dir, f));
    writeFileSync(join(dir, ".bun-version"), "9.9.9\n");
    const bad = sh(["make", "bun-version"], dir);
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain("wrong Bun version");
    writeFileSync(join(dir, ".bun-version"), `${Bun.version}\n`);
    expect(sh(["make", "bun-version"], dir).code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeExecutable(dir: string, body: string) {
  const file = join(dir, "werk-fake");
  writeFileSync(file, `#!/usr/bin/env bun\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

test("50.5 an executable that does not serve the map fails the smoke step, which has no escape in the workflow", async () => {
  // the workflow step is a plain make smoke, last, with no continue-on-error
  expect(steps.at(-1).run).toBe("make smoke");
  expect(steps.at(-1)["continue-on-error"]).toBeUndefined();
  const dir = tempDir("fakeexe");
  const app = repoCopy("fakeexe-app");
  const SMOKE = join(app, "src/release/smoke.ts");
  try {
    const smoke = (exe: string) => sh(["bun", SMOKE, exe], dir);
    // 1. exits at once, no address
    const none = smoke(fakeExecutable(dir, "process.exit(0);"));
    expect(none.code).not.toBe(0);
    // 2. prints an address, answers the map read with 500
    const err500 = smoke(
      fakeExecutable(
        dir,
        'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });\nconsole.log(`werk: serving on http://127.0.0.1:${s.port}`);\nawait new Promise(() => {});',
      ),
    );
    expect(err500.code).not.toBe(0);
    expect(err500.stderr).toContain("500");
    // 3. answers 200 but no list of nodes
    const nonodes = smoke(
      fakeExecutable(
        dir,
        'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({}) });\nconsole.log(`werk: serving on http://127.0.0.1:${s.port}`);\nawait new Promise(() => {});',
      ),
    );
    expect(nonodes.code).not.toBe(0);
    // control: an executable that serves a node list passes
    const good = smoke(
      fakeExecutable(
        dir,
        'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ nodes: [] }) });\nconsole.log(`werk: serving on http://127.0.0.1:${s.port}`);\nawait new Promise(() => {});',
      ),
    );
    expect(good.code, good.stderr).toBe(0);
    // 4. prints an address but never answers: does the step end?
    const hang = fakeExecutable(
      dir,
      'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Promise(() => {}) });\nconsole.log(`werk: serving on http://127.0.0.1:${s.port}`);\nawait new Promise(() => {});',
    );
    const child = Bun.spawn(["bun", SMOKE, hang], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    const ended = await Promise.race([child.exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 40000))]);
    child.kill();
    console.log(`50.5 hang case: smoke ended within 40 s = ${ended}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(app, { recursive: true, force: true });
  }
}, 180000);
