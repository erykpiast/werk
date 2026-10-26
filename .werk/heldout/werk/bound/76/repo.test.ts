import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAll } from "./exe.ts";
import { CHECKOUT, copyRepo, sh } from "./h.ts";

const LONG = 30 * 60 * 1000;

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const root = copyRepo();
    const link = join(root, ".claude/agents/test-scope.md");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    const target = join(root, "src/agent/subagents/test-scope.md");
    const content = readFileSync(target, "utf8");
    rmSync(link);
    writeFileSync(link, content);
    const bad = sh(root, ["make", "test"]);
    expect(bad.code).not.toBe(0);
    expect(bad.out + bad.err).toContain("test-scope");
    rmSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const good = sh(root, ["make", "test"]);
    expect(good.code).toBe(0);
  },
  LONG,
);

test(
  "41.5 the build produces one executable for each platform",
  () => {
    const b = buildAll();
    expect(b.make.status).toBe(0);
    const files = readdirSync(b.out).sort();
    expect(files).toEqual(["werk-darwin-arm64", "werk-darwin-x64", "werk-linux-arm64", "werk-linux-x64"]);
    expect(files.some((f) => /^werk-win|windows|\.exe$/i.test(f))).toBe(false);
    const smoke = sh(b.root, ["make", "smoke"]);
    expect(smoke.code).toBe(0);
    expect(smoke.out).toContain("answered a map request");
  },
  LONG,
);

test(
  "42.1 the CI run: pinned bun, lockfile only, every check, one built executable started once",
  () => {
    const ci = readFileSync(join(CHECKOUT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(ci).toContain("bun-version-file: .bun-version");
    expect(ci).not.toMatch(/bun-version:\s*latest/);
    const runs = [...ci.matchAll(/- run: (.+)/g)].map((m) => m[1] as string);
    for (const step of ["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]) expect(runs).toContain(step);
    expect(runs.some((r) => r.startsWith("make build") && r.includes("--target"))).toBe(true);
    const make = readFileSync(join(CHECKOUT, "Makefile"), "utf8");
    expect(make).toContain("bun install --frozen-lockfile");
    expect(readFileSync(join(CHECKOUT, ".bun-version"), "utf8").trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(join(CHECKOUT, "bun.lock"))).toBe(true);
    // the same checks, on a clean copy
    const root = copyRepo();
    for (const target of ["lint", "typecheck", "test-coverage"]) {
      const r = sh(root, ["make", target]);
      expect([target, r.code, r.code === 0 ? "" : r.out.slice(-600) + r.err.slice(-600)]).toEqual([target, 0, ""]);
    }
  },
  LONG,
);

test(
  "42.2 the started executable answers a map request",
  () => {
    const b = buildAll();
    const r = sh(b.root, ["sh", "scripts/smoke.sh", b.exe]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("smoke: the executable answered a map request");
  },
  LONG,
);

test(
  "42.3 a lockfile that misses a package turns the run red",
  () => {
    const root = copyRepo();
    // an import of a package that no lockfile lists
    writeFileSync(join(root, "src/needs-pkg.ts"), 'import leftPad from "left-pad-not-in-lock";\nexport default leftPad;\n');
    const t = sh(root, ["make", "typecheck"]);
    expect(t.code).not.toBe(0);
    // a dependency added to the package file without the lockfile
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    pkg.dependencies["left-pad-not-in-lock"] = "1.3.0";
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
    rmSync(join(root, "node_modules/.werk-installed"));
    const l = sh(root, ["make", "lint"]);
    expect(l.code).not.toBe(0);
    expect(l.out + l.err).toMatch(/lockfile/i);
  },
  LONG,
);

test(
  "42.4 a pull request gets the same run: a broken test is red, the fix is green",
  () => {
    const ci = readFileSync(join(CHECKOUT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/pull_request:/);
    const root = copyRepo();
    const file = join(root, "src/cli/card-id.test.ts");
    const original = readFileSync(file, "utf8");
    writeFileSync(file, `${original}\nimport { test as t2, expect as e2 } from "bun:test";\nt2("broken", () => e2(1).toBe(2));\n`);
    expect(sh(root, ["make", "test"]).code).not.toBe(0);
    writeFileSync(file, original);
    expect(sh(root, ["make", "test"]).code).toBe(0);
  },
  LONG,
);

test(
  "61.1 a fresh clone builds on an empty first commit and passes every check",
  () => {
    const first = sh(CHECKOUT, ["git", "rev-list", "--max-parents=0", "HEAD"]).out.trim().split("\n");
    expect(first.length).toBe(1);
    expect(sh(CHECKOUT, ["git", "ls-tree", "-r", first[0] as string]).out.trim()).toBe("");
    for (const c of sh(CHECKOUT, ["git", "rev-list", "HEAD"]).out.trim().split("\n"))
      expect(sh(CHECKOUT, ["git", "merge-base", "--is-ancestor", first[0] as string, c]).code).toBe(0);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-clone-")));
    const clone = join(dir, "werk");
    expect(sh(dir, ["git", "clone", "--quiet", CHECKOUT, clone]).code).toBe(0);
    const install = sh(clone, ["bun", "install", "--frozen-lockfile"]);
    expect(install.code).toBe(0);
    for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
      const r = sh(clone, ["make", target]);
      expect([target, r.code, r.code === 0 ? "" : (r.out + r.err).slice(-800)]).toEqual([target, 0, ""]);
    }
    rmSync(dir, { recursive: true, force: true });
  },
  LONG,
);

test(
  "69.5 make e2e runs the browser specs on a copy of the fixture, with one screenshot per test",
  () => {
    const root = copyRepo();
    const before = existsSync(join(root, ".werk"));
    const r = sh(root, ["make", "e2e"]);
    expect(r.code).toBe(0);
    const ran = Number(/(\d+) passed/.exec(r.out)?.[1] ?? 0);
    expect(ran).toBeGreaterThan(0);
    expect(/✘|failed/.test(r.out)).toBe(false);
    const pngs = (dir: string): string[] =>
      existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pngs(join(dir, e.name)) : e.name.endsWith(".png") ? [e.name] : [])) : [];
    expect(pngs(join(root, "test-results")).length).toBe(ran);
    expect(existsSync(join(root, ".werk"))).toBe(before);
    void cpSync;
  },
  LONG,
);
