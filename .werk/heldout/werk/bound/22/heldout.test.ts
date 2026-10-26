import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withProject } from "../src/test-env/project.ts";

const repo = join(import.meta.dir, "..");

function sh(cwd: string, cmd: string[]) {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, CI: "true" } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

describe("01.1", () => {
  test("test, coverage, and coverage with a deleted own test file", () => {
    const root = mkdtempSync(join(tmpdir(), "heldout-01-"));
    const copy = join(root, "werk");
    try {
      cpSync(repo, copy, {
        recursive: true,
        filter: (s) => !s.includes("/.git/") && !s.endsWith("/.werk-heldout") && !s.endsWith("/coverage"),
      });
      const t = sh(copy, ["make", "test"]);
      expect(t.code).toBe(0);
      expect(t.out).toContain(" 0 fail");
      expect(t.out).not.toMatch(/% src\/|ok\s+\d+\.\d%/);

      const c = sh(copy, ["make", "test-coverage"]);
      if (c.code !== 0) console.log(c.out.slice(-2500));
      expect(c.code).toBe(0);
      const { PURE_FILES } = require(join(copy, "src/test/pure-files.ts"));
      for (const f of PURE_FILES) {
        expect(c.out).toMatch(new RegExp(`ok\\s+\\d+(\\.\\d+)?%\\s+${f.replace(/\./g, "\\.")}`));
      }

      const victim = "src/toolchain.test.ts";
      expect(PURE_FILES).toContain("src/toolchain.ts");
      rmSync(join(copy, victim));
      expect(existsSync(join(copy, victim))).toBe(false);
      const c2 = sh(copy, ["make", "test-coverage"]);
      expect(c2.code).not.toBe(0);
      expect(c2.out).toMatch(/0(\.0)?%\s+src\/toolchain\.ts/);
      expect(c2.out).toContain(victim);

      const t2 = sh(copy, ["make", "test"]);
      expect(t2.code).toBe(0);
      expect(t2.out).not.toMatch(/missing test file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240000);
});

const cli = (p: { dir: string }) => [process.execPath, join(repo, "src/cli.ts")];

describe("06.1", () => {
  test("an agent adds an excerpt for a decided card: output says proposed, ghost, pending link", async () => {
    await withProject({}, async (p) => {
      const base = cli(p);
      // a decided card: the status verb does not exist yet in this checkout, so write the event directly
      await Bun.write(
        p.logPath,
        `${JSON.stringify({ type: "node.proposed", id: "c1", kind: "card", title: "Card", status: "decided", why: "w", body: "b" })}\n`,
      );
      const r = await p.run([...base, "excerpt", "e1", "--for", "c1", "--text", "quote"]);
      expect(r.stdout).toContain("proposed");
      expect(r.stdout).not.toContain("added");
      expect(r.code).toBe(0);
      const e = await p.run([...base, "show", "e1"]);
      expect(e.stdout).toContain("proposed");
      const c = await p.run([...base, "show", "c1"]);
      expect(c.stdout).toContain("[held]");
      expect(c.stdout).toContain("[decided]");
    });
  });
});

describe("06.2", () => {
  test("accepting an excerpt ghost makes it real and its link live", async () => {
    await withProject({}, async (p) => {
      const base = cli(p);
      await Bun.write(
        p.logPath,
        `${JSON.stringify({ type: "node.proposed", id: "c1", kind: "card", title: "Card", status: "decided" })}\n`,
      );
      const r = await p.run([...base, "excerpt", "e1", "--for", "c1", "--text", "quote"]);
      expect(r.stdout).toContain("proposed");
      const a = await p.run([...base, "accept", "e1"]);
      expect(a.code).toBe(0);
      const c = await p.run([...base, "show", "c1"]);
      expect(c.stdout).toContain("supported_by");
      expect(c.stdout).not.toContain("[held]");
      expect(c.stdout).not.toContain("[proposed]");
    });
  });
});
