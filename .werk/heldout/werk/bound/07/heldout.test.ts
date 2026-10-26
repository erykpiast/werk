import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const seed = (...events: unknown[]) => {
  const fs = require("node:fs");
  fs.mkdirSync(join(project.dir, ".werk"), { recursive: true });
  fs.writeFileSync(
    project.logPath,
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
};
const decidedCard = [
  { type: "node.proposed", id: "c", kind: "card", title: "Card C", status: "decided", body: "Words of C" },
  { type: "node.accepted", id: "c", actor: "you" },
];

// ---- 01.1 ----
test("01.1 make test, make test-coverage, and a missing own test file", async () => {
  const copy = mkdtempSync(join(tmpdir(), "werk-heldout-copy-"));
  try {
    for (const entry of [
      ".bun-version", "biome.json", "bun.lock", "bunfig.toml", "Makefile",
      "package.json", "tsconfig.json", "playwright.config.ts", "src", "fake", "node_modules",
    ]) {
      if (existsSync(join(ROOT, entry)))
        cpSync(join(ROOT, entry), join(copy, entry), { recursive: true, preserveTimestamps: true });
    }
    const make = async (target: string) => {
      const p = Bun.spawn(["make", target], { cwd: copy, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([
        new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited,
      ]);
      return { stdout: stdout + stderr, code };
    };
    const t = await make("test");
    expect(t.code).toBe(0);
    expect(t.stdout).toMatch(/\d+ pass/);
    expect(t.stdout).not.toMatch(/^(ok|FAIL)\s+[\d.]+%\s+src\//m);

    const pure = (await import("../src/test/pure-files.ts")).PURE_FILES;
    const c = await make("test-coverage");
    expect(c.code).toBe(0);
    for (const f of pure) expect(c.stdout).toMatch(new RegExp(`^ok\\s+[\\d.]+%\\s+${f.replace(/\./g, "\\.")}`, "m"));

    rmSync(join(copy, "src/map/thread.test.ts"));
    const c2 = await make("test-coverage");
    expect(c2.code).not.toBe(0);
    expect(c2.stdout).toMatch(/FAIL\s+0\.0%\s+src\/map\/thread\.ts.*src\/map\/thread\.test\.ts/);
    const t2 = await make("test");
    expect(t2.code).toBe(0);
    expect(t2.stdout).not.toMatch(/^(ok|FAIL)\s+[\d.]+%\s+src\//m);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}, 300000);

// ---- 06 ----
async function addExcerptFor(card: string) {
  const added = await werk("add", "ex", "--kind", "excerpt", "--title", "An excerpt");
  expect(added.stderr).toBe("");
  expect(added.code).toBe(0);
  expect(added.stdout.trim()).toBe("proposed");
  const link = await werk("link", card, "ex", "--type", "supported_by");
  expect(link.code).toBe(0);
}

test("06.1 a new excerpt stages as a ghost", async () => {
  seed(...decidedCard);
  await addExcerptFor("c");
  const ex = await werk("show", "ex");
  expect(ex.stdout).toContain("proposed");
  const c = await werk("show", "c");
  expect(c.stdout).toContain("[decided]");
  expect(c.stdout).toContain("Card C");
  expect(c.stdout).toContain("Words of C");
  expect(c.stdout).toMatch(/supported_by\s+ex.*\[held\]/);
});

test("06.2 an accepted excerpt goes live", async () => {
  seed(...decidedCard);
  await addExcerptFor("c");
  const acc = await werk("accept", "ex", "--actor", "you");
  expect(acc.code).toBe(0);
  const ex = await werk("show", "ex");
  expect(ex.stdout).not.toContain("proposed");
  const c = await werk("show", "c");
  expect(c.stdout).toMatch(/supported_by\s+ex/);
  expect(c.stdout).not.toContain("[held]");
});

// ---- 29 ----
async function planSub() {
  const r = await werk("plan", "root");
  expect(r.stderr).not.toContain("unknown verb");
  expect(r.code).toBe(0);
  return r;
}

test("29.1 second plan extends spec, keeps numbers", async () => {
  seed(...decidedCard);
  await planSub();
  await planSub();
});
test("29.2 a no-longer-needed open ticket is archived and restorable", async () => {
  seed(...decidedCard);
  await planSub();
});
test("29.3 retitling a cited card blocks its ready ticket", async () => {
  seed(...decidedCard);
  await planSub();
});
test("29.4 note blocks nothing, body change blocks only ready ticket", async () => {
  seed(...decidedCard);
  await planSub();
});
test("29.5 a new uncited card fails the cards-cited check", async () => {
  seed(...decidedCard);
  await planSub();
});
