import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./cli-support.ts";

const MIN = 60_000;

function sh(
  argv: string[],
  cwd: string,
  input?: string,
  env: Record<string, string> = {},
) {
  const r = Bun.spawnSync(argv, {
    cwd,
    env: { ...process.env, ...env },
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: r.exitCode,
    out: r.stdout.toString(),
    err: r.stderr.toString(),
  };
}

/** A copy of the checkout's committed files with a cloned node_modules, so a task can write inside it. */
function copyOfRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-copy-"));
  const tar = Bun.spawnSync(
    ["sh", "-c", `git archive HEAD | tar -x -C "${dir}"`],
    { cwd: ROOT },
  );
  expect(tar.exitCode).toBe(0);
  const clone = sh(
    ["cp", "-cR", join(ROOT, "node_modules"), join(dir, "node_modules")],
    ROOT,
  );
  expect(clone.code).toBe(0);
  sh(["git", "init", "-q", "-b", "main"], dir);
  return dir;
}

describe("01 coverage gate", () => {
  test(
    "01.1 make test, then make test-coverage, then a missing own test file",
    () => {
      const dir = copyOfRepo();
      try {
        const unit = sh(["make", "test"], dir);
        expect(unit.code, unit.out + unit.err).toBe(0);
        expect(unit.out + unit.err).toMatch(/\d+ pass/);
        expect(unit.out + unit.err).not.toContain("src/map/thread.ts");
        expect(unit.out + unit.err).not.toMatch(/\bFAIL\b/);

        const cov = sh(["make", "test-coverage"], dir);
        expect(cov.code, cov.out + cov.err).toBe(0);
        const list = readFileSync(join(dir, "src/test/pure-files.ts"), "utf8");
        const files = [
          ...list.matchAll(/"((?:src|client)\/[^"]+\.tsx?)"/g),
        ].map((m) => m[1] as string);
        expect(files.length).toBeGreaterThan(10);
        for (const f of files) {
          const line = (cov.out + cov.err)
            .split("\n")
            .find((l) => l.includes(f) && /^ok\s+[\d.]+%/.test(l.trim()));
          expect(line, `no ok line for ${f}`).toBeDefined();
        }

        rmSync(join(dir, "src/map/thread.test.ts"));
        const again = sh(["make", "test-coverage"], dir);
        expect(again.code).not.toBe(0);
        expect(again.out + again.err).toMatch(/FAIL\s+0\.0%\s+src\/map\/thread\.ts/);
        expect(again.out + again.err).toContain("src/map/thread.test.ts");

        const unit2 = sh(["make", "test"], dir);
        expect(unit2.code, unit2.out + unit2.err).toBe(0);
        expect(unit2.out + unit2.err).not.toContain("missing test file");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    40 * MIN,
  );
});

describe("48 repository setup for Claude Code", () => {
  const settings = JSON.parse(
    readFileSync(join(ROOT, ".claude/settings.json"), "utf8"),
  );
  const allow: string[] = settings.permissions.allow;
  const ask: string[] = settings.permissions.ask;

  test("48.1 a make target runs freely while accept, remove and restore still ask", () => {
    expect(allow).toContain("Bash(make:*)");
    const asks = (verb: string) =>
      ask.some((a) => a.includes(`werk ${verb}`)) &&
      ask.some((a) => a.includes(`src/cli.ts ${verb}`));
    for (const verb of ["accept", "remove", "restore"])
      expect(asks(verb), verb).toBe(true);
    // A person's allow entry for every werk command cannot lift an ask rule: the ask rules sit in
    // the shared file, and Claude Code's order is deny, then ask, then allow.
    expect(allow).not.toContain("Bash(werk accept:*)");
    expect(settings.permissions.defaultMode).toBeUndefined();
  });

  const NEEDS = `${ROOT}/.werk-heldout`;
  const hookInput = (file: string) =>
    JSON.stringify({ tool_input: { file_path: file } });

  function lintDir() {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-lint-")));
    cpSync(join(ROOT, "biome.json"), join(dir, "biome.json"));
    cpSync(join(ROOT, ".gitignore"), join(dir, ".gitignore"));
    cpSync(join(ROOT, "package.json"), join(dir, "package.json"));
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
    sh(["git", "init", "-q", "-b", "main"], dir);
    mkdirSync(join(dir, "client"));
    return dir;
  }

  test("48.2 an edit that leaves an unused import is repaired, and a hook error reaches the agent", () => {
    void NEEDS;
    const dir = lintDir();
    try {
      const file = join(dir, "client/thing.tsx");
      writeFileSync(
        file,
        `import { useState } from "react";\nimport { useEffect } from "react";\n\nexport function Thing() {\n      const [n, setN] = useState(0);\n  return <button type="button" onClick={() => setN(n + 1)}>{n}</button>;\n}\n`,
      );
      const hook = join(ROOT, "src/claude/lint-hook.ts");
      const first = sh(["bun", hook], dir, hookInput(file));
      expect(first.code, first.err).toBe(0);
      expect(first.err + first.out).toBe("");
      const fixed = readFileSync(file, "utf8");
      expect(fixed).not.toContain("useEffect");
      expect(fixed).toContain("\n  const [n, setN] = useState(0);");

      writeFileSync(
        file,
        `import { useEffect, useState } from "react";\n\nexport function Thing({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, []);\n  return <b>{n}</b>;\n}\n`,
      );
      const second = sh(["bun", hook], dir, hookInput(file));
      expect(second.code).toBe(2);
      expect(second.err).toMatch(/useExhaustiveDependencies|dependenc/i);
      expect(existsSync(file)).toBe(true);

      writeFileSync(
        file,
        `import { useEffect, useState } from "react";\n\nexport function Thing({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, [id]);\n  return <b>{n}</b>;\n}\n`,
      );
      const third = sh(["bun", hook], dir, hookInput(file));
      expect(third.code, third.err).toBe(0);
      expect(third.err + third.out).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function agentsRoot() {
    const root = mkdtempSync(join(tmpdir(), "werk-heldout-agents-"));
    mkdirSync(join(root, "src/agent"), { recursive: true });
    cpSync(
      join(ROOT, "src/agent/subagents"),
      join(root, "src/agent/subagents"),
      { recursive: true },
    );
    mkdirSync(join(root, ".claude/agents"), { recursive: true });
    for (const name of ["prototyper", "test-scope"]) {
      symlinkSync(
        `../../src/agent/subagents/${name}.md`,
        join(root, `.claude/agents/${name}.md`),
      );
    }
    return root;
  }
  const checker = join(ROOT, "src/claude/check-subagent-links.ts");

  test("48.3 a copied subagent fails the check and a restored link passes it", () => {
    const real = lstatSync(join(ROOT, ".claude/agents/prototyper.md"));
    expect(real.isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(ROOT, ".claude/agents/prototyper.md"))).toContain(
      "src/agent/subagents/prototyper.md",
    );
    const root = agentsRoot();
    try {
      // a plain file that only werk's own development uses
      writeFileSync(join(root, ".claude/agents/dev-only.md"), "# dev only\n");
      expect(sh(["bun", checker, root], ROOT).code).toBe(0);

      const link = join(root, ".claude/agents/prototyper.md");
      rmSync(link);
      cpSync(join(root, "src/agent/subagents/prototyper.md"), link);
      const copy = sh(["bun", checker, root], ROOT);
      expect(copy.code).not.toBe(0);
      expect(copy.err).toContain("prototyper");
      expect(copy.err).toContain("not a link");
      expect(copy.err).not.toContain("dev-only");

      rmSync(link);
      symlinkSync("../../src/agent/subagents/prototyper.md", link);
      expect(sh(["bun", checker, root], ROOT).code).toBe(0);

      rmSync(link);
      const gone = sh(["bun", checker, root], ROOT);
      expect(gone.code).not.toBe(0);
      expect(gone.err).toContain("prototyper");
      expect(gone.err).toContain("no link");
      expect(gone.err).not.toContain("dev-only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
    expect(allow).toContain("Bash(make:*)");
    expect(allow.some((a) => /\bwerk\b|src\/cli\.ts/.test(a))).toBe(true);
    // every allowed command is a make target, the werk command line, or the checkout's cli
    for (const a of allow)
      expect(a).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
    for (const a of allow) {
      expect(a).not.toMatch(
        /curl|wget|ssh|scp|git push|npm|rm |sudo|install|>|~|\/tmp|\.\./,
      );
    }
    expect(settings.mcpServers).toBeUndefined();
    expect(settings.enabledMcpjsonServers).toBeUndefined();
    expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
    expect(existsSync(join(ROOT, ".claude/skills"))).toBe(false);
    expect(existsSync(join(ROOT, ".claude/commands"))).toBe(false);
    const ignored = sh(
      ["git", "check-ignore", "-q", ".claude/settings.local.json"],
      ROOT,
    );
    expect(ignored.code).toBe(0);
  });
});

describe("49 release executable", () => {
  test(
    "49.1 the release build makes four executables with checksums",
    () => {
      const dir = copyOfRepo();
      try {
        const build = sh(["make", "release-build"], dir);
        expect(build.code, build.out + build.err).toBe(0);
        const out = join(dir, "dist", "release");
        for (const p of [
          "darwin-arm64",
          "darwin-x64",
          "linux-arm64",
          "linux-x64",
        ]) {
          const exe = join(out, `werk-${p}`);
          expect(existsSync(exe), exe).toBe(true);
          const sumFile = `${exe}.sha256`;
          expect(existsSync(sumFile)).toBe(true);
          const hash = new Bun.CryptoHasher("sha256")
            .update(readFileSync(exe))
            .digest("hex");
          const text = readFileSync(sumFile, "utf8");
          expect(text).toContain(hash);
          expect(text).toContain(`werk-${p}`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    10 * MIN,
  );

  test(
    "49.3 the help of the executable lists every command the checkout lists",
    () => {
      const dir = copyOfRepo();
      try {
        const build = sh(
          ["bun", "src/release/build.ts", join(dir, "out"), "--current"],
          dir,
        );
        expect(build.code, build.out + build.err).toBe(0);
        const exe = join(
          dir,
          "out",
          `werk-${process.platform}-${process.arch}`,
        );
        const empty = mkdtempSync(join(tmpdir(), "werk-heldout-empty-"));
        const bare = join(empty, "werk");
        cpSync(exe, bare);
        const help = sh([bare, "help"], empty, undefined, {
          WERK_HOME: join(empty, "h"),
        });
        const checkout = sh(["bun", join(ROOT, "src/cli.ts"), "help"], empty);
        expect(help.code, help.err).toBe(0);
        expect(help.out.trim().length).toBeGreaterThan(50);
        expect(help.out).toBe(checkout.out);
        // run one listed command from the executable
        sh(["git", "init", "-q", "-b", "main"], empty);
        mkdirSync(join(empty, ".werk"));
        const add = sh([bare, "add", "x", "--title", "X"], empty, undefined, {
          WERK_HOME: join(empty, "h"),
        });
        expect(add.code, add.err).toBe(0);
        expect(add.out + add.err).not.toMatch(
          /no such file|not found|missing|ENOENT/i,
        );
        const show = sh([bare, "show", "x"], empty, undefined, {
          WERK_HOME: join(empty, "h"),
        });
        expect(show.code, show.err).toBe(0);
        expect(show.out).toContain("X");
        rmSync(empty, { recursive: true, force: true });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    10 * MIN,
  );
});

describe("50 CI", () => {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const runs = [...ci.matchAll(/- run: (.+)/g)].map((m) =>
    (m[1] as string).trim(),
  );

  test("50.1 a push to the main line runs every check and starts the executable", () => {
    expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(runs).toEqual([
      "make lint",
      "make typecheck",
      "make test",
      "make test-coverage",
      "make e2e",
      "make smoke",
    ]);
    // a clean machine: the make targets install the locked packages when node_modules is absent
    const mk = readFileSync(join(ROOT, "Makefile"), "utf8");
    expect(mk).toContain("bun install --frozen-lockfile");
    expect(ci).toContain("actions/checkout");
    expect(ci).not.toMatch(/node_modules|cache/);
    expect(readFileSync(join(ROOT, "package.json"), "utf8")).toContain(
      "bun src/release/build.ts dist/smoke --current && bun src/release/smoke.ts",
    );
  });

  test("50.2 a pull request gets the same run", () => {
    expect(ci).toMatch(/pull_request:/);
    expect(ci).not.toMatch(/if:\s/);
    expect(ci).not.toContain("continue-on-error");
  });

  test("50.3 a red run keeps the merge and blocks the release", () => {
    // A failed step ends the job red, with no step that reverts the commit.
    expect(ci).not.toMatch(/revert|reset|push --force|continue-on-error/);
    expect(ci).toContain("blocks a release");
  });

  test("50.4 the run uses the Bun version the repository pins", () => {
    const pinned = readFileSync(join(ROOT, ".bun-version"), "utf8").trim();
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ci).toMatch(
      /oven-sh\/setup-bun@v\d+\s*\n\s*with:\s*\n\s*bun-version-file: \.bun-version/,
    );
    // setup-bun comes before the first check
    expect(ci.indexOf("setup-bun")).toBeLessThan(ci.indexOf("make lint"));
    const mk = readFileSync(join(ROOT, "Makefile"), "utf8");
    expect(mk).toContain("PINNED_BUN := $(shell cat .bun-version)");
  });

  test(
    "50.5 an executable that does not serve the map fails the run",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "werk-heldout-smoke-"));
      try {
        // prints its address, then answers nothing
        const exe = join(dir, "werk-fake");
        writeFileSync(
          exe,
          `#!/bin/sh\necho "werk: serving on http://127.0.0.1:9"\nsleep 20\n`,
        );
        Bun.spawnSync(["chmod", "+x", exe]);
        const r = sh(["bun", join(ROOT, "src/release/smoke.ts"), exe], dir);
        expect(r.code).not.toBe(0);
        // smoke is the last step, a plain step with no continue-on-error
        expect(runs.at(-1)).toBe("make smoke");
        expect(ci).not.toContain("continue-on-error");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    2 * MIN,
  );
});
