// Held-out step 69.5: `make e2e` on a clone of the checkout leaves one screenshot per test and no new event in the person's log.
// Run with: bun test ./.werk-heldout/G/make-e2e.hb.ts
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKOUT } from "./g-helpers.ts";

function pngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".png"));
}

test(
  "69.5 make e2e runs every spec against a real server and leaves one screenshot per test",
  () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g-clone-")));
    try {
      const clone = join(root, "werk");
      const cloned = Bun.spawnSync(["git", "clone", "--quiet", CHECKOUT, clone]);
      expect(cloned.exitCode).toBe(0);
      expect(existsSync(join(clone, "e2e"))).toBe(true);
      expect(existsSync(join(clone, ".werk-heldout"))).toBe(false);
      // The project the person works in: a log of its own.
      mkdirSync(join(clone, ".werk"));
      const log = join(clone, ".werk", "log.jsonl");
      const events = `${JSON.stringify({ seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "root", kind: "card", title: "Mine" } })}\n`;
      writeFileSync(log, events);

      const run = Bun.spawnSync(["make", "e2e"], { cwd: clone, stdout: "pipe", stderr: "pipe" });
      const out = run.stdout.toString() + run.stderr.toString();
      writeFileSync(join(CHECKOUT, ".werk-heldout", "G", "make-e2e.out.txt"), out);
      expect(readFileSync(log, "utf8")).toBe(events);
      expect(run.exitCode).toBe(0);
      const results = out.split("\n").filter((l) => /^\s+(✓|✘|-)\s+\d+ \[/.test(l));
      const ran = results.filter((l) => /^\s+(✓|✘)/.test(l));
      expect(ran.length).toBeGreaterThan(0);
      expect(out).toMatch(/\d+ passed/);
      // Every test run writes its screenshot into the run's output folder.
      const shots = pngs(join(clone, "test-results"));
      const folders = new Set(shots.map((s) => s.split("/")[0]));
      const all = readdirSync(join(clone, "test-results"));
      console.log("folders without png:", all.filter((f) => !folders.has(f)));
      expect(folders.size).toBe(ran.length);
      console.log(`ran ${ran.length}, pass ${results.filter((l) => l.includes("✓")).length}, png folders ${folders.size}, exit ${run.exitCode}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  { timeout: 600_000 },
);
