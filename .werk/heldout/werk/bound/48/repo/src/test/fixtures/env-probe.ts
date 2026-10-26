// Run by the environment test as a test file of its own: a child that it starts with no explicit
// environment prints what that child sees.
import { test } from "bun:test";

test("probe", () => {
  const child = Bun.spawnSync(["sh", "-c", 'command -v claude; echo "WERK_LOG=$WERK_LOG"'], { stdout: "pipe" });
  console.log(`PROBE ${child.stdout.toString().replaceAll("\n", " ")}`);
});
