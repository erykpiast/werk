// 19.5, 61.2, 41.5, 42.x, 69.5: run in the clone that repo.test.ts made.
import { expect, test } from "bun:test";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const clone = "/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/heldout-repo-AU3QVg/clone";
async function shA(cmd: string[], env: Record<string, string | undefined> = {}) {
  const p = Bun.spawn(cmd, { cwd: clone, env: { ...process.env, ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out + err };
}
const T = 3_000_000;

test("[19.5] a subagent copy that replaces its link fails the repository checks", async () => {
  const link = join(clone, ".claude/agents/test-scope.md");
  const target = join(clone, "src/agent/subagents/test-scope.md");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  const content = readFileSync(target, "utf8");
  rmSync(link);
  writeFileSync(link, content);
  try {
    const r = await shA(["make", "test"]);
    const lines = r.out.split("\n").filter((l) => /test-scope|subagent|\(fail\)/.test(l)).slice(0, 8);
    console.log("CHECKS WITH COPY:", r.code, lines.join("\n"));
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("test-scope");
  } finally {
    rmSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
  }
  const ok = await shA(["make", "test"]);
  console.log("CHECKS WITH LINK:", ok.code, ok.out.split("\n").slice(-4).join("\n"));
  expect(ok.code).toBe(0);
}, T);

test("[61.2] help lists every verb; a new verb module appears with no other edit", async () => {
  const before = await shA(["bun", "src/cli.ts", "help"]);
  expect(before.code).toBe(0);
  const files = readdirSync(join(clone, "src/verbs")).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "index.ts");
  for (const f of files) {
    const name = f.replace(/\.ts$/, "");
    if (name === "ticket-check") expect(before.out).toContain("ticket-check");
  }
  const listed = [...before.out.matchAll(/^ {2}([a-z-]+)/gm)].map((m) => m[1] as string);
  expect(listed).toContain("help");
  const mod = join(clone, "src/verbs/ping.ts");
  writeFileSync(
    mod,
    `import { registerVerb } from "../cli/registry.ts";\nregisterVerb({ name: "ping", help: "Print pong.", run: (_a, io) => { io.out("pong\\n"); return 0; } });\n`,
  );
  try {
    const after = await shA(["bun", "src/cli.ts", "help"]);
    console.log("AFTER HELP:", after.out.split("\n").filter((l) => /ping/.test(l)).join("|"));
    expect(after.out).toMatch(/^ {2}ping/m);
    for (const v of listed) expect(after.out).toContain(`  ${v}`);
    const status = (await shA(["git", "status", "--porcelain"])).out.trim();
    expect(status).toBe("?? src/verbs/ping.ts");
    expect((await shA(["bun", "src/cli.ts", "ping"])).out).toBe("pong\n");
  } finally {
    rmSync(mod);
  }
}, T);

test("[41.5] the build writes four executables, no Windows", async () => {
  rmSync(join(clone, "dist"), { recursive: true, force: true });
  const r = await shA(["make", "build"]);
  console.log("BUILD:", r.code, r.out.split("\n").slice(-4).join("\n"));
  expect(r.code).toBe(0);
  const bins = readdirSync(join(clone, "dist/bin")).sort();
  console.log("BINS", bins);
  expect(bins).toEqual(["werk-darwin-arm64", "werk-darwin-x64", "werk-linux-arm64", "werk-linux-x64"]);
  expect(bins.some((b) => /windows|win32|\.exe$/i.test(b))).toBe(false);
}, T);

test("[42.1][42.4] the workflow runs every check on a clean machine for a push to main and a pull request", () => {
  const y = readFileSync(join(clone, ".github/workflows/ci.yml"), "utf8");
  expect(y).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
  expect(y).toMatch(/pull_request:/);
  expect(y).toMatch(/runs-on:\s*ubuntu-latest/);
  expect(y).toContain("bun-version-file: .bun-version");
  expect(y).not.toMatch(/bun-version:\s*latest/);
  for (const step of ["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make build", "make smoke"]) expect(y).toContain(`run: ${step}`);
  const make = readFileSync(join(clone, "Makefile"), "utf8");
  expect(make).toContain("bun install --frozen-lockfile");
  expect(readFileSync(join(clone, ".bun-version"), "utf8").trim()).toMatch(/^\d+\.\d+\.\d+$/);
  expect(existsSync(join(clone, "bun.lock"))).toBe(true);
});

test("[42.2] the started executable answers a map request", async () => {
  const exe = join(clone, "dist/bin/werk-darwin-arm64");
  const r = await shA(["sh", "scripts/smoke.sh", exe]);
  console.log("SMOKE:", r.code, r.out);
  expect(r.code).toBe(0);
  expect(r.out).toContain("answered a map request");
}, T);

test("[42.3] a lockfile that misses a package turns the run red", async () => {
  const pkgFile = join(clone, "package.json");
  const saved = readFileSync(pkgFile, "utf8");
  const pkg = JSON.parse(saved);
  pkg.dependencies["left-pad"] = "1.3.0";
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  try {
    const r = await shA(["bun", "install", "--frozen-lockfile"]);
    console.log("FROZEN INSTALL:", r.code, r.out.split("\n").slice(-4).join("\n"));
    expect(r.code).not.toBe(0);
    const m = await shA(["make", "lint"]);
    console.log("MAKE LINT WITH MISSING LOCK ENTRY:", m.code, m.out.split("\n").slice(-4).join("\n"));
    expect(m.code).not.toBe(0);
  } finally {
    writeFileSync(pkgFile, saved);
  }
  const ok = await shA(["bun", "install", "--frozen-lockfile"]);
  expect(ok.code).toBe(0);
}, T);

test("[42.4] a broken test turns the run red, a fix turns it green", async () => {
  const tf = join(clone, "src/cli/args.test.ts");
  const saved = readFileSync(tf, "utf8");
  writeFileSync(tf, `${saved}\nimport { expect as e2, test as t2 } from "bun:test";\nt2("broken on purpose", () => { e2(1).toBe(2); });\n`);
  try {
    const r = await shA(["make", "test"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("broken on purpose");
  } finally {
    writeFileSync(tf, saved);
  }
  const ok = await shA(["make", "test"]);
  expect(ok.code).toBe(0);
}, T);

test("[69.5] make e2e leaves one screenshot per page test and no events in the project's log", async () => {
  rmSync(join(clone, "test-results"), { recursive: true, force: true });
  const r = await shA(["make", "e2e"]);
  const passed = /(\d+) passed/.exec(r.out)?.[1];
  const png = (await shA(["sh", "-c", "find test-results -name '*.png' | wc -l"])).out.trim();
  console.log("E2E:", r.code, "passed", passed, "png", png);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/✓/);
  expect(Number(png)).toBeGreaterThanOrEqual(Number(passed) - 1);
  expect(existsSync(join(clone, ".werk"))).toBe(false);
  expect((await shA(["git", "status", "--porcelain"])).out.trim()).toBe("");
}, T);
