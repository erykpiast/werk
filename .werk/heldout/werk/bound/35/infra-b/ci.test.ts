import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..");
const text = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
// biome-ignore lint/suspicious/noExplicitAny: a parsed workflow file
const wf: any = (Bun as any).YAML.parse(text);
const jobs = Object.values(wf.jobs) as any[];
const steps: any[] = jobs.flatMap((j) => j.steps);
const runs = steps.map((s) => s.run).filter(Boolean) as string[];
const on = wf.on ?? wf[true as unknown as string];

describe("50 CI workflow (declared structure; GitHub itself is not reachable)", () => {
  test("50.1 push to main runs lint, typecheck, test, coverage, e2e as separate steps, builds and starts the executable", () => {
    expect(on.push.branches).toContain("main");
    const idx = (c: string) => runs.indexOf(c);
    const order = ["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"].map(idx);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const s of steps) expect(s["continue-on-error"]).toBeUndefined();
    // clean machine: checkout only, no cache restoring node_modules, install of the lock comes from make
    expect(text).not.toMatch(/actions\/cache|cache:/);
    const mk = readFileSync(join(REPO, "Makefile"), "utf8");
    expect(mk).toContain("bun install --frozen-lockfile");
    expect(mk).toMatch(/^smoke:.*\n\tbun run smoke/m);
    const smoke = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts.smoke;
    expect(smoke).toContain("release/build.ts");
    expect(smoke).toContain("--current");
    expect(smoke).toContain("release/smoke.ts");
  });

  test("50.1 a clean tree installs the locked packages first (make -n on a tree with no node_modules)", () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "heldout-ci-"));
    try {
      for (const f of ["Makefile", "package.json", "bun.lock", ".bun-version"]) {
        writeFileSync(join(dir, f), readFileSync(join(REPO, f)));
      }
      const r = Bun.spawnSync(["make", "-n", "lint"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      const out = r.stdout.toString();
      expect(out.indexOf("bun install --frozen-lockfile")).toBeGreaterThan(-1);
      expect(out.indexOf("bun install --frozen-lockfile")).toBeLessThan(out.indexOf("bun run lint"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("50.2 a pull request gets the same job, with the build and the start", () => {
    expect(on).toHaveProperty("pull_request");
    // one job serves both triggers, so the pull request runs every step of a push
    expect(jobs.length).toBe(1);
    expect(runs).toContain("make smoke");
    // "merge only on green" needs a required status check in the repository settings, which is not a file of the repo.
    expect(Object.keys(wf.jobs)).toEqual(["check"]);
  });

  test("50.3 each check is its own named-by-command step, so a red run names the failing step; the job has no cancel or undo", () => {
    for (const c of ["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]) {
      expect(runs.filter((r) => r === c).length).toBe(1);
    }
    expect(text).not.toMatch(/revert|git push|reset --hard/);
  });

  test("50.4 the run installs the pinned Bun before any check", () => {
    const pinned = readFileSync(join(REPO, ".bun-version"), "utf8").trim();
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    const setup = steps.findIndex((s) => String(s.uses ?? "").startsWith("oven-sh/setup-bun"));
    const firstCheck = steps.findIndex((s) => s.run);
    expect(setup).toBeGreaterThan(-1);
    expect(setup).toBeLessThan(firstCheck);
    expect(steps[setup].with["bun-version-file"]).toBe(".bun-version");
    expect(steps[setup].with["bun-version"]).toBeUndefined();
  });

  test("50.5 an executable that does not serve the map fails the start step", async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "heldout-smoke-"));
    try {
      const fake = join(dir, "fake-werk");
      writeFileSync(
        fake,
        `#!/usr/bin/env bun\nconst s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });\nconsole.log("werk: serving on http://127.0.0.1:" + s.port);\nawait new Promise(() => {});\n`,
      );
      chmodSync(fake, 0o755);
      const p = Bun.spawn(["bun", join(REPO, "src/release/smoke.ts"), fake], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      const code = await p.exited;
      const err = await new Response(p.stderr).text();
      expect(code).not.toBe(0);
      expect(err).toContain("500");
      // and the smoke step is the last step of the job, with nothing after it that could mask the failure
      expect(runs[runs.length - 1]).toBe("make smoke");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
