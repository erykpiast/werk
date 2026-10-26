import { expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  lstatSync,
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

const ROOT = join(import.meta.dir, "..");
const settings = () =>
  JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

function copyOfRepo(): { dir: string; done: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "heldout-48-")));
  const r = Bun.spawnSync([
    "rsync",
    "-a",
    "--exclude",
    ".git",
    "--exclude",
    ".werk-heldout",
    `${ROOT}/`,
    `${dir}/`,
  ]);
  expect(r.exitCode).toBe(0);
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir });
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("48.1 make targets run freely, accept, remove and restore ask", () => {
  const { permissions } = settings();
  // The rules of one scope merge with the personal scope; Claude Code checks deny, then ask, then allow.
  const personal = {
    permissions: { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"] },
  };
  const allow: string[] = [...permissions.allow, ...personal.permissions.allow];
  const ask: string[] = permissions.ask ?? [];
  const decide = (command: string) => {
    const match = (rule: string) => {
      const m = /^Bash\((.*?)(:\*)?\)$/.exec(rule);
      if (!m) return false;
      return m[2] ? command.startsWith(m[1] as string) : command === m[1];
    };
    if ((permissions.deny ?? []).some(match)) return "deny";
    if (ask.some(match)) return "ask";
    if (allow.some(match)) return "allow";
    return "ask-default";
  };
  expect(decide("make lint")).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} login --actor you`)).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} login --actor you`)).toBe("ask");
  }
  expect(decide("werk show login")).toBe("allow");
});

test("48.2 the edit hook repairs an unused import and reports a missing hook dependency", () => {
  const { dir, done } = copyOfRepo();
  try {
    const hook = settings().hooks.PostToolUse[0];
    expect(hook.matcher).toContain("Edit");
    const command: string = hook.hooks[0].command;
    const file = join(dir, "client", "app", "probe.tsx");
    const run = () =>
      Bun.spawnSync(["sh", "-c", command], {
        cwd: dir,
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        stdin: new TextEncoder().encode(
          JSON.stringify({
            tool_name: "Edit",
            tool_input: { file_path: file },
          }),
        ),
      });
    writeFileSync(
      file,
      `import { useEffect, useState } from "react";
import { clsx } from "clsx";

export function Probe() {
      const [n, setN] = useState(0);
  return <button type="button" onClick={() => setN(n + 1)}>{n}</button>;
}
`,
    );
    // The first edit adds an unused import and has wrong indentation.
    const first = run();
    const out1 = first.stdout.toString() + first.stderr.toString();
    expect(first.exitCode, out1).toBe(0);
    expect(out1).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("clsx");
    expect(fixed).not.toContain("useEffect");
    expect(fixed).toContain("\n  const [n, setN] = useState(0);");
    // The next edit adds a hook with a missing dependency.
    writeFileSync(
      file,
      `import { useEffect, useState } from "react";

export function Probe() {
  const [n, setN] = useState(0);
  useEffect(() => {
    console.log(n);
  }, []);
  return <button type="button" onClick={() => setN(n + 1)}>{n}</button>;
}
`,
    );
    const second = run();
    const out2 = second.stdout.toString() + second.stderr.toString();
    expect(readFileSync(file, "utf8")).toContain("useEffect");
    expect(out2).toMatch(/useExhaustiveDependencies|dependency/i);
    expect(second.exitCode).toBe(2);
    // The agent fixes it.
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("}, []);", "}, [n]);"),
    );
    const third = run();
    expect(third.stdout.toString() + third.stderr.toString()).toBe("");
    expect(third.exitCode).toBe(0);
  } finally {
    done();
  }
});

test("48.3 a copied subagent fails the check and a restored link passes it", () => {
  const { dir, done } = copyOfRepo();
  try {
    const check = () =>
      Bun.spawnSync(["bun", "src/claude/check-subagent-links.ts"], {
        cwd: dir,
      });
    const text = (r: ReturnType<typeof check>) =>
      r.stdout.toString() + r.stderr.toString();
    expect(check().exitCode).toBe(0);
    const link = join(dir, ".claude", "agents", "prototyper.md");
    const target = readlinkSync(link);
    const source = join(dir, "src", "agent", "subagents", "prototyper.md");
    unlinkSync(link);
    copyFileSync(source, link);
    const copied = check();
    expect(copied.exitCode).not.toBe(0);
    expect(text(copied)).toContain("prototyper");
    expect(text(copied)).toMatch(/copy|not a link/);
    unlinkSync(link);
    symlinkSync(target, link);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(check().exitCode).toBe(0);
    unlinkSync(link);
    const gone = check();
    expect(gone.exitCode).not.toBe(0);
    expect(text(gone)).toContain("prototyper");
    expect(text(gone)).toMatch(/no link/);
    symlinkSync(target, link);
    // A subagent that only werk's own development uses stays a plain file.
    writeFileSync(
      join(dir, ".claude", "agents", "dev-only.md"),
      "---\nname: dev-only\n---\nOnly for werk's development.\n",
    );
    const withDev = check();
    expect(withDev.exitCode).toBe(0);
    expect(text(withDev)).not.toContain("dev-only");
  } finally {
    done();
  }
});

test("48.4 the shared settings are small, safe and have no skills or servers", () => {
  const s = settings();
  const allow: string[] = s.permissions.allow;
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((a) => /^Bash\(werk:\*\)$/.test(a))).toBe(true);
  for (const rule of allow) {
    expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
    expect(rule).not.toMatch(/curl|wget|ssh|scp|rm |sudo|git push|npm|gh /);
  }
  expect(existsSync(join(ROOT, ".claude", "skills"))).toBe(false);
  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(JSON.stringify(s)).not.toMatch(/mcp/i);
  const tracked = Bun.spawnSync(["git", "ls-files"], {
    cwd: ROOT,
  }).stdout.toString();
  expect(tracked).not.toMatch(/SKILL\.md|\.claude\/skills|\.mcp\.json/);
  const ignored = Bun.spawnSync(
    ["git", "check-ignore", "-q", ".claude/settings.local.json"],
    { cwd: ROOT },
  );
  expect(ignored.exitCode).toBe(0);
});
