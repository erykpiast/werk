// Step 61.2: werk help names every registered verb, and a new verb module appears with no other edit.
import { afterAll, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, removeCopies, sh } from "./a-helpers.ts";

afterAll(removeCopies);

const helpVerbs = (out: string) => [...out.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1]);

test("61.2 help lists every verb, and a ping module joins it", () => {
  const dir = cloneCheckout();
  expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
  const before = sh(dir, ["bun", "src/cli.ts", "help"]);
  expect(before.code).toBe(0);
  const named = helpVerbs(before.out);
  const registered = readdirSync(join(dir, "src/verbs"))
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "index.ts")
    .flatMap((n) => {
      const text = Bun.file(join(dir, "src/verbs", n)).text();
      return [text];
    });
  expect(registered.length).toBeGreaterThan(0);
  // Every verb registered in the verb modules is named in help.
  const sources = readdirSync(join(dir, "src/verbs"))
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((n) => require("node:fs").readFileSync(join(dir, "src/verbs", n), "utf8") as string)
    .join("\n");
  const registeredNames = [...sources.matchAll(/registerVerb\(\{\s*name:\s*"([a-z-]+)"/g)].map((m) => m[1]);
  console.log("registered:", registeredNames.join(" "), "\nhelp:", named.join(" "));
  expect(registeredNames.length).toBeGreaterThan(5);
  for (const verb of registeredNames) expect(named).toContain(verb);
  expect(named).toContain("help");

  writeFileSync(
    join(dir, "src/verbs/ping.ts"),
    `import { registerVerb } from "../cli/registry.ts";

registerVerb({
  name: "ping",
  help: "Answer pong.",
  run: (_args, io) => {
    io.out("pong\\n");
    return 0;
  },
});
`,
  );
  const after = sh(dir, ["bun", "src/cli.ts", "help"]);
  expect(after.code).toBe(0);
  const namedAfter = helpVerbs(after.out);
  expect(namedAfter).toContain("ping");
  for (const verb of named) expect(namedAfter).toContain(verb);
  const status = sh(dir, ["git", "status", "--porcelain"]).out.trim();
  console.log("git status:", JSON.stringify(status));
  expect(status).toBe("?? src/verbs/ping.ts");
});
