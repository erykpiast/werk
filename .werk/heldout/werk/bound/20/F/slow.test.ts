// Held-out steps 01.1, 19.5, 61.1, 61.3, 61.4: runs slow.sh, which drives the make targets on a clone.
import { expect, test } from "bun:test";
import { join } from "node:path";

for (const step of ["01.1", "61.4", "19.5", "61.3", "61.1"]) {
  test(`${step} make targets on a clone`, () => {
    const run = Bun.spawnSync(["bash", join(import.meta.dir, "slow.sh"), step], { stdout: "pipe", stderr: "pipe" });
    const out = run.stdout.toString();
    console.log(out);
    expect(out.split("\n").filter((line) => line.startsWith("CHECK") && line.includes(" FAIL "))).toEqual([]);
  }, 1_800_000);
}
