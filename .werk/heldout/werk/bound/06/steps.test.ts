import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/test-env/project.ts";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "src", "cli.ts");

async function sh(cwd: string, cmd: string[]) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "" } });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, code };
}

test("01.1 make test / make test-coverage / deleted own test", async () => {
  const copy = mkdtempSync(join(tmpdir(), "heldout-01-"));
  try {
    for (const f of ["Makefile", "package.json", "bun.lock", "bunfig.toml", ".bun-version", "tsconfig.json", "biome.json"])
      cpSync(join(ROOT, f), join(copy, f), { preserveTimestamps: true });
    for (const d of ["src", "fake"]) cpSync(join(ROOT, d), join(copy, d), { recursive: true });
    symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
    await sh(copy, ["git", "init", "-q"]);

    const t = await sh(copy, ["make", "test"]);
    expect(t.code).toBe(0);
    expect(t.stdout + t.stderr).toMatch(/\d+ pass/);
    expect(t.stdout + t.stderr).not.toMatch(/ok\s+\d+\.\d%/);

    const pure = (await Bun.file(join(copy, "src/test/pure-files.ts")).text()).match(/"src\/[^"]+"/g)!.map((s) => s.slice(1, -1));
    const c = await sh(copy, ["make", "test-coverage"]);
    expect(c.code).toBe(0);
    for (const f of pure) expect(c.stdout + c.stderr).toMatch(new RegExp(`\\d+\\.\\d%\\s+${f.replace(/[.]/g, "\\.")}`));

    const victim = "src/toolchain.ts";
    rmSync(join(copy, "src/toolchain.test.ts"));
    expect(existsSync(join(copy, "src/toolchain.test.ts"))).toBe(false);
    const c2 = await sh(copy, ["make", "test-coverage"]);
    expect(c2.stdout + c2.stderr).toMatch(/0(\.0)?%\s+src\/toolchain\.ts/);
    expect(c2.code).not.toBe(0);
    expect(c2.stdout + c2.stderr).toContain("src/toolchain.test.ts");
    const t2 = await sh(copy, ["make", "test"]);
    expect(t2.code).toBe(0);
    void victim;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}, 180000);

const decidedSeed = JSON.stringify({ type: "node.proposed", id: "card1", kind: "card", title: "Decided card", status: "decided", body: "words" });

test("06.1 excerpt stages as ghost", async () => {
  const project = createProject();
  try {
    const w = (...a: string[]) => project.run(["bun", CLI, ...a]);
    await Bun.write(project.logPath, `${decidedSeed}\n`);
    const help = await w("help");
    expect(help.stdout).toMatch(/excerpt/);
    const r = await w("excerpt", "ex1", "--supports", "card1");
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("proposed");
    const ex = await w("show", "ex1");
    expect(ex.stdout).toContain("proposed");
    const card = await w("show", "card1");
    expect(card.stdout).toContain("[held]");
    expect(card.stdout).toContain("[decided]");
    expect(card.stdout).toContain("words");
  } finally {
    await project.dispose();
  }
});

test("06.2 accepted excerpt goes live", async () => {
  const project = createProject();
  try {
    const w = (...a: string[]) => project.run(["bun", CLI, ...a]);
    await Bun.write(
      project.logPath,
      `${decidedSeed}\n${JSON.stringify({ type: "node.proposed", id: "ex1", kind: "source", title: "Quote", status: "open" })}\n${JSON.stringify({ type: "edge.added", from: "card1", to: "ex1", link: "supported_by" })}\n`,
    );
    const help = await w("help");
    expect(help.stdout).toMatch(/accept|ok/);
    const r = await w("accept", "ex1");
    expect(r.code).toBe(0);
    const ex = await w("show", "ex1");
    expect(ex.stdout).not.toContain("proposed");
    const card = await w("show", "card1");
    expect(card.stdout).toContain("supported_by");
    expect(card.stdout).not.toContain("[held]");
  } finally {
    await project.dispose();
  }
});
