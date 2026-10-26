import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { CHECKOUT, copyRepo } from "./c-repo-copy.ts";

const settings = JSON.parse(
  readFileSync(join(CHECKOUT, ".claude", "settings.json"), "utf8"),
);
const allow: string[] = settings.permissions?.allow ?? [];
const ask: string[] = settings.permissions?.ask ?? [];

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
const fresh = () => {
  const c = copyRepo();
  roots.push(c.root);
  return c.repo;
};

/** Claude Code matches a Bash rule "Bash(prefix:*)" as a command prefix. */
const matches = (rule: string, command: string) => {
  const m = /^Bash\((.*):\*\)$/.exec(rule);
  return m ? command === m[1] || command.startsWith(`${m[1]} `) : false;
};
const decide = (command: string, personalAllow: string[]) => {
  // Documented order: deny, then ask, then allow. A personal allow never beats an ask.
  if (ask.some((r) => matches(r, command))) return "ask";
  if ([...allow, ...personalAllow].some((r) => matches(r, command)))
    return "allow";
  return "ask-default";
};

describe("48.1 permissions (static: Claude Code itself is not run)", () => {
  const personal = ["Bash(werk:*)", "Bash(make:*)", "Bash(bun:*)", "Bash"];
  test("a make target runs without a question", () => {
    expect(decide("make lint", [])).toBe("allow");
    expect(decide("make lint", personal)).toBe("allow");
  });
  test("accept, remove and restore ask, with every personal allow", () => {
    for (const verb of ["accept", "remove", "restore"]) {
      for (const cmd of [`werk ${verb} abc`, `bun src/cli.ts ${verb} abc`]) {
        expect(decide(cmd, [])).toBe("ask");
        expect(decide(cmd, personal)).toBe("ask");
      }
    }
  });
  test("the ask rules are in the shared settings, not only in a local file", () => {
    for (const verb of ["accept", "remove", "restore"]) {
      expect(ask).toContain(`Bash(werk ${verb}:*)`);
    }
    // a personal file is not part of the repo: it is ignored
    expect(existsSync(join(CHECKOUT, ".claude", "settings.local.json"))).toBe(
      false,
    );
  });
});

describe("48.2 lint hook", () => {
  const hookCommand: string =
    settings.hooks.PostToolUse[0].hooks[0].command;
  const hookRun = (repo: string, file: string) => {
    const r = Bun.spawnSync(["sh", "-c", hookCommand], {
      cwd: repo,
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
      stdin: new TextEncoder().encode(
        JSON.stringify({
          tool_name: "Edit",
          tool_input: { file_path: file },
        }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: r.exitCode,
      out: r.stdout.toString(),
      err: r.stderr.toString(),
    };
  };

  test("unused import repaired silently; hook error for missing dependency; fixed edit is silent", () => {
    expect(settings.hooks.PostToolUse[0].matcher).toContain("Edit");
    const repo = fresh();
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
    const file = join(repo, "client", "lib", "heldout-sample.tsx");
    // wrong indentation, then an edit that leaves an unused import
    writeFileSync(
      file,
      `import { useState } from "react";\nexport const a = 1;\nexport function f() {\n      return a;\n}\n`,
    );
    const first = hookRun(repo, file);
    expect(first.code).toBe(0);
    expect(first.out + first.err).toBe("");
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("useState");
    expect(after).toContain("\n  return a;\n");

    // next edit: hook with a missing dependency
    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\nexport function C({ id }: { id: string }) {\n  const [v, setV] = useState("");\n  useEffect(() => {\n    setV(id);\n  }, []);\n  return v;\n}\n`,
    );
    const second = hookRun(repo, file);
    expect(readFileSync(file, "utf8")).toContain("useEffect"); // edit saved
    expect(second.code).toBe(2);
    expect(second.err).toMatch(/useExhaustiveDependencies/);
    expect(second.err).toContain("id");

    // the agent fixes it
    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\nexport function C({ id }: { id: string }) {\n  const [v, setV] = useState("");\n  useEffect(() => {\n    setV(id);\n  }, [id]);\n  return v;\n}\n`,
    );
    const third = hookRun(repo, file);
    expect(third.code).toBe(0);
    expect(third.out + third.err).toBe("");
  }, 60000);
});

describe("48.3 subagent links", () => {
  const check = (repo: string) => {
    const r = Bun.spawnSync(
      ["bun", "src/claude/check-subagent-links.ts"],
      { cwd: repo, stdout: "pipe", stderr: "pipe" },
    );
    return { code: r.exitCode, text: r.stdout.toString() + r.stderr.toString() };
  };
  test("link, copy, restore, remove, dev-only plain file", () => {
    const repo = fresh();
    const dir = join(repo, ".claude", "agents");
    const shipped = readdirSync(join(repo, "src", "agent", "subagents")).filter(
      (n) => n.endsWith(".md"),
    );
    expect(shipped.length).toBeGreaterThan(1);
    for (const n of shipped) expect(lstatSync(join(dir, n)).isSymbolicLink()).toBe(true);
    expect(check(repo).code).toBe(0);

    const name = shipped[0] as string;
    const target = readlinkSync(join(dir, name));
    const source = join(repo, "src", "agent", "subagents", name);
    unlinkSync(join(dir, name));
    copyFileSync(source, join(dir, name));
    const copied = check(repo);
    expect(copied.code).not.toBe(0);
    expect(copied.text).toContain(name.replace(/\.md$/, ""));
    expect(copied.text).toMatch(/not a link|copy/);

    unlinkSync(join(dir, name));
    symlinkSync(target, join(dir, name));
    expect(check(repo).code).toBe(0);

    unlinkSync(join(dir, name));
    const gone = check(repo);
    expect(gone.code).not.toBe(0);
    expect(gone.text).toContain(name.replace(/\.md$/, ""));
    expect(gone.text).toMatch(/no link/);

    symlinkSync(target, join(dir, name));
    writeFileSync(join(dir, "dev-only.md"), "---\nname: dev-only\n---\nx\n");
    expect(check(repo).code).toBe(0);
    expect(realpathSync(join(dir, name))).toBe(realpathSync(source));
  }, 60000);
});

describe("48.4 shared settings", () => {
  test("allow list: every make target and werk, nothing that writes outside or reaches the network", () => {
    expect(allow).toContain("Bash(make:*)");
    expect(allow.some((r) => r.startsWith("Bash(werk"))).toBe(true);
    const banned =
      /\b(curl|wget|ssh|scp|git push|git clone|npm|pnpm|pip|rm|mv|cp|chmod|sudo|brew|gh|bunx?\s+(install|add|x))\b/;
    for (const rule of allow) {
      expect(rule.startsWith("Bash(")).toBe(true);
      expect(banned.test(rule)).toBe(false);
      expect(rule).not.toMatch(/\.\.\/|~|\/(etc|usr|tmp|Users|home)/);
    }
    expect(Object.keys(settings.permissions)).not.toContain("additionalDirectories");
  });
  test("no skill, no MCP server entry", () => {
    expect(existsSync(join(CHECKOUT, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(CHECKOUT, ".mcp.json"))).toBe(false);
    expect(settings.mcpServers).toBeUndefined();
    expect(settings.enabledMcpjsonServers).toBeUndefined();
    const find = Bun.spawnSync(
      ["find", ".", "-name", "SKILL.md", "-not", "-path", "./node_modules/*", "-not", "-path", "./.git/*"],
      { cwd: CHECKOUT, stdout: "pipe" },
    );
    expect(find.stdout.toString().trim()).toBe("");
    const agentsText = readFileSync(join(CHECKOUT, "AGENTS.md"), "utf8");
    expect(agentsText.length).toBeGreaterThan(0);
  });
  test("a personal settings file is ignored by git and not listed as new", () => {
    const repo = fresh();
    const git = (...a: string[]) =>
      Bun.spawnSync(["git", ...a], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Bash(git:*)"] } }),
    );
    expect(git("status", "--porcelain").stdout.toString().trim()).toBe("");
    expect(git("check-ignore", ".claude/settings.local.json").exitCode).toBe(0);
  });
});
