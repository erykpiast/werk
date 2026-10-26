import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { CHECKOUT, copyRepo, sh } from "./h.ts";

const LONG = 20 * 60 * 1000;
const pureFiles = (root: string) =>
  readFileSync(join(root, "pure-files.txt"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));

test(
  "01.1 make test, make test-coverage, and a missing own test file",
  () => {
    const root = copyRepo();
    const t = sh(root, ["make", "test"]);
    expect(t.code).toBe(0);
    expect(t.out + t.err).not.toMatch(/under 90% of lines/);
    expect(t.out + t.err).not.toMatch(/coverage gate/i);
    const c = sh(root, ["make", "test-coverage"]);
    expect(c.code).toBe(0);
    const files = pureFiles(root);
    for (const f of files) expect(c.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${f.replace(/[.]/g, "\\.")}`));
    // delete the own test file of one listed pure file
    const target = "src/cli/card-id.ts";
    expect(files).toContain(target);
    rmSync(join(root, "src/cli/card-id.test.ts"));
    const c2 = sh(root, ["make", "test-coverage"]);
    expect(c2.code).not.toBe(0);
    expect(c2.out + c2.err).toMatch(/0\.00%\s+src\/cli\/card-id\.ts/);
    expect(c2.out + c2.err).toContain("src/cli/card-id.test.ts");
    const t2 = sh(root, ["make", "test"]);
    expect(t2.code).toBe(0);
  },
  LONG,
);

test(
  "61.3 tests pass with no claude program on PATH, and the tree stays clean",
  () => {
    const bunDir = join(process.env.HOME ?? "", ".bun", "bin");
    // node stays reachable (vite and biome need it); the claude program does not.
    const nodeDir = mkdtempSync(join(tmpdir(), "werk-heldout-node-"));
    symlinkSync(Bun.which("node") as string, join(nodeDir, "node"));
    const path = [nodeDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin", bunDir].join(":");
    expect(sh(CHECKOUT, ["sh", "-c", "command -v claude || true"], { PATH: path }).out.trim()).toBe("");
    const before = sh(CHECKOUT, ["git", "status", "--porcelain"]).out;
    const r = sh(CHECKOUT, ["make", "test"], { PATH: path });
    expect(r.code).toBe(0);
    expect(sh(CHECKOUT, ["git", "status", "--porcelain"]).out).toBe(before);
  },
  LONG,
);

test(
  "61.4 the coverage gate fails below 90% on a pure file and passes again",
  () => {
    const root = copyRepo();
    expect(sh(root, ["make", "test-coverage"]).code).toBe(0);
    const testFile = join(root, "src/cli/card-id.test.ts");
    const original = readFileSync(testFile, "utf8");
    writeFileSync(
      testFile,
      `import { expect, test } from "bun:test";\nimport "./card-id.ts";\ntest("loads", () => expect(1).toBe(1));\n`,
    );
    expect(sh(root, ["make", "test"]).code).toBe(0);
    const c = sh(root, ["make", "test-coverage"]);
    expect(c.code).not.toBe(0);
    const out = c.out + c.err;
    expect(out).toMatch(/src\/cli\/card-id\.ts/);
    expect(out).toMatch(/\d+\.\d+%/);
    writeFileSync(testFile, original);
    expect(sh(root, ["make", "test-coverage"]).code).toBe(0);
  },
  LONG,
);

test(
  "61.2 help lists every registered verb, and a new verb module appears with no other edit",
  async () => {
    const root = copyRepo();
    const names = (out: string) => [...out.matchAll(/^ {2}([a-z][a-z-]*)(?: |$)/gm)].map((m) => m[1] as string);
    const run = () => sh(root, ["bun", "src/cli.ts", "help"]);
    const h1 = run();
    expect(h1.code).toBe(0);
    const before = names(h1.out);
    const src = readdirSync(join(root, "src/verbs"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts")
      .map((f) => readFileSync(join(root, "src/verbs", f), "utf8"))
      .join("\n");
    const mods = [...src.matchAll(/registerVerb\(\{\s*name: "([a-z-]+)"/g)].map((m) => m[1] as string);
    expect(mods.length).toBeGreaterThan(20);
    for (const m of mods) expect(before).toContain(m);
    expect(before).toContain("help");
    const clean = sh(root, ["git", "status", "--porcelain"]).out;
    expect(clean).toBe("");
    writeFileSync(
      join(root, "src/verbs/ping.ts"),
      `import { registerVerb } from "../cli/registry.ts";\nregisterVerb({ name: "ping", help: "Answer pong.", run: (_a, io) => { io.out("pong\\n"); return 0; } });\n`,
    );
    const h2 = run();
    const after = names(h2.out);
    expect(after).toContain("ping");
    for (const n of before) expect(after).toContain(n);
    expect(sh(root, ["git", "status", "--porcelain"]).out.trim()).toBe("?? src/verbs/ping.ts");
    expect(existsSync(join(root, "src/verbs/ping.ts"))).toBe(true);
  },
  LONG,
);
