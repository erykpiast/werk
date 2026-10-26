import { afterEach, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, install, removeClones, sh } from "./g-lib.ts";

afterEach(removeClones);

const helpVerbs = (out: string) => [...out.matchAll(/^ {2}([a-z][a-z-]*)(?=\s|$)/gm)].map((m) => m[1] as string).sort();

/** The verb names that the verb modules register, read from the source. */
function registered(dir: string): string[] {
  const verbs = join(dir, "src/verbs");
  return readdirSync(verbs)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "index.ts")
    .flatMap((name) => [...readFileSync(join(verbs, name), "utf8").matchAll(/registerVerb\(\{\s*name:\s*"([^"]+)"/g)])
    .map((m) => m[1] as string)
    .sort();
}

test("61.2", async () => {
  const dir = await cloneCheckout();
  await install(dir);
  const h1 = await sh(["bun", "src/cli.ts", "help"], dir);
  expect(h1.code, h1.all).toBe(0);
  const before = helpVerbs(h1.out);
  expect(before).toContain("help");
  expect(before).toEqual(registered(dir));

  writeFileSync(
    join(dir, "src/verbs/ping.ts"),
    'import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Print pong.",\n  run: (_args, io) => {\n    io.out("pong\\n");\n    return 0;\n  },\n});\n',
  );
  const h2 = await sh(["bun", "src/cli.ts", "help"], dir);
  expect(h2.code, h2.all).toBe(0);
  expect(helpVerbs(h2.out)).toEqual([...before, "ping"].sort());

  const status = await sh(["git", "status", "--porcelain"], dir);
  expect(status.out).toBe("?? src/verbs/ping.ts\n");
}, 600_000);
