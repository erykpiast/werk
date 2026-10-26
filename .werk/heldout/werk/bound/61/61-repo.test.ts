import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneHead, ROOT, sh } from "./repo.ts";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
});
const MIN = 60_000;

test("61.1 a fresh clone starts on an empty first commit and passes the five checks", async () => {
  const c = cloneHead(false);
  disposers.push(c.dispose);
  const roots = sh(c.repo, ["git", "rev-list", "--max-parents=0", "main"]).out.trim().split("\n");
  expect(roots).toHaveLength(1);
  const files = sh(c.repo, ["git", "ls-tree", "-r", "--name-only", roots[0] as string]).out.trim();
  expect(files).toBe("");
  const all = sh(c.repo, ["git", "rev-list", "main"]).out.trim().split("\n");
  for (const sha of all) expect(sh(c.repo, ["git", "merge-base", "--is-ancestor", roots[0] as string, sha]).code).toBe(0);
  expect(sh(c.repo, ["make", "install"]).code).toBe(0);
  const results: Record<string, number> = {};
  for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
    const r = sh(c.repo, ["make", target]);
    results[target] = r.code;
    if (r.code !== 0) console.log(`make ${target} failed:\n${r.out.slice(-3000)}`);
  }
  expect(results).toEqual({ test: 0, "test-coverage": 0, typecheck: 0, lint: 0, e2e: 0 });
}, 40 * MIN);

test("61.2 help lists every registered verb and a new verb module appears in it with no other edit", async () => {
  const c = cloneHead(true);
  disposers.push(c.dispose);
  const werk = (...a: string[]) => sh(c.repo, ["bun", "src/cli.ts", ...a]);
  const before = werk("help");
  expect(before.code).toBe(0);
  const names = readFileSync(join(ROOT, "src/own/verb-names.macro.ts"), "utf8") && sh(c.repo, ["ls", "src/verbs"]).out.split("\n").filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts")).map((n) => n.replace(/\.ts$/, ""));
  const listed = before.out.split("\n").map((l) => l.trim().split(/\s+/)[0]);
  for (const n of names) expect(listed).toContain(n === "ticket-check" ? "ticket-check" : n);
  expect(listed).toContain("help");
  writeFileSync(
    join(c.repo, "src/verbs/ping.ts"),
    `import { registerVerb } from "../cli/registry.ts";\nregisterVerb({ name: "ping", summary: "Answer pong", run: ({ out }) => { out("pong"); return 0; } });\n`,
  );
  const after = werk("help");
  const listed2 = after.out.split("\n").map((l) => l.trim().split(/\s+/)[0]);
  expect(listed2).toContain("ping");
  for (const n of listed) if (n) expect(listed2).toContain(n);
  expect(sh(c.repo, ["git", "status", "--porcelain"]).out.trim()).toBe("?? src/verbs/ping.ts");
}, 5 * MIN);

test("61.3 make test passes with no claude on the path and leaves the working tree clean", async () => {
  const c = cloneHead(true);
  disposers.push(c.dispose);
  const bin = mkdtempSync(join(tmpdir(), "werk-heldout-bin-"));
  symlinkSync(Bun.which("bun") as string, join(bin, "bun"));
  symlinkSync(Bun.which("bunx") as string, join(bin, "bunx"));
  symlinkSync(Bun.which("node") as string, join(bin, "node"));
  const PATH = `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`;
  expect(sh(c.repo, ["sh", "-c", "command -v claude || echo none"], { PATH }).out.trim()).toBe("none");
  const before = sh(c.repo, ["git", "status", "--porcelain"]).out;
  const r = sh(c.repo, ["make", "test"], { PATH });
  if (r.code !== 0) console.log(r.out.slice(-3000));
  expect(r.code).toBe(0);
  expect(sh(c.repo, ["git", "status", "--porcelain"]).out).toBe(before);
}, 15 * MIN);

test("61.4 the gate fails below 90% on a pure file, plain make test still passes, and restoring passes again", async () => {
  const c = cloneHead(true);
  disposers.push(c.dispose);
  const file = "src/cli/args.ts";
  expect(readFileSync(join(c.repo, "src/test/pure-files.ts"), "utf8")).toContain(file);
  const base = sh(c.repo, ["make", "test-coverage"]);
  console.log(`61.4 given: make test-coverage exit ${base.code}`);
  writeFileSync(join(c.repo, "src/cli/args.test.ts"), `import { expect, test } from "bun:test";\nimport "./args.ts";\ntest("loads", () => expect(1).toBe(1));\n`);
  expect(sh(c.repo, ["make", "test"]).code).toBe(0);
  const gate = sh(c.repo, ["make", "test-coverage"]);
  expect(gate.code).not.toBe(0);
  expect(gate.out).toMatch(/FAIL\s+\d+\.\d%\s+src\/cli\/args\.ts/);
  sh(c.repo, ["git", "checkout", "--", "src/cli/args.test.ts"]);
  expect(sh(c.repo, ["make", "test-coverage"]).code).toBe(0);
}, 40 * MIN);
