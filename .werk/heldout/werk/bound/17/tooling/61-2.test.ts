// 61.2: The help verb lists every registered verb, and a new verb module appears in it with no other edit.
import { afterAll, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyCheckout, sh } from "./copy.ts";

const copy = copyCheckout();
afterAll(() => copy.remove());

const verbsIn = (help: string) => [...help.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1] as string);

test("61.2", () => {
  const before = sh(copy.dir, "bun src/cli.ts help");
  expect(before.code).toBe(0);
  const names = verbsIn(before.out);
  expect(names).toContain("help");
  // Every verb module of the command line names a verb in the help.
  const modules = readdirSync(join(copy.dir, "src/verbs")).filter((f) => f.endsWith(".ts") && !f.includes(".test.") && f !== "index.ts");
  for (const m of modules) expect(names).toContain(m.replace(/\.ts$/, ""));

  writeFileSync(
    join(copy.dir, "src/verbs/ping.ts"),
    `import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Print pong.",\n  run: (_args, io) => {\n    io.out("pong\\n");\n    return 0;\n  },\n});\n`,
  );
  const after = sh(copy.dir, "bun src/cli.ts help");
  console.log(after.out.slice(0, 400));
  const status = sh(copy.dir, "git status --porcelain").out.trim();
  expect(status).toBe("?? src/verbs/ping.ts");
  const afterNames = verbsIn(after.out);
  for (const n of names) expect(afterNames).toContain(n);
  expect(afterNames).toContain("ping");
}, 300_000);
