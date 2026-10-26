import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, install, make, removeClones, sh } from "./g-lib.ts";

afterEach(removeClones);

test("61.4", async () => {
  const dir = await cloneCheckout();
  await install(dir);
  const c0 = await make(dir, "test-coverage");
  expect(c0.code, c0.all).toBe(0);

  // Delete every unit test of src/cli/args.ts; the test file keeps only an import of the module.
  const file = "src/cli/args.ts";
  writeFileSync(
    join(dir, "src/cli/args.test.ts"),
    'import { expect, test } from "bun:test";\nimport * as mod from "./args.ts";\n\ntest("the module loads", () => {\n  expect(mod).toBeDefined();\n});\n',
  );
  const t = await make(dir, "test");
  expect(t.code, t.all).toBe(0);

  const c1 = await make(dir, "test-coverage");
  expect(c1.code).not.toBe(0);
  const line = c1.all.split("\n").find((each) => each.includes(file)) ?? "";
  const percent = Number(/(\d+(?:\.\d+)?)%/.exec(line)?.[1] ?? "NaN");
  expect(percent).toBeLessThan(90);

  const restore = await sh(["git", "checkout", "--", "src/cli/args.test.ts"], dir);
  expect(restore.code).toBe(0);
  const c2 = await make(dir, "test-coverage");
  expect(c2.code, c2.all).toBe(0);
}, 900_000);
