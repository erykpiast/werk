// Held-out step 61.2: werk help lists every registered verb, and a new verb module appears with no other edit.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, sh } from "./a-clone.ts";

function registered(dir: string): string[] {
  const verbs = join(dir, "src/verbs");
  const names: string[] = [];
  for (const f of readdirSync(verbs).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    for (const m of readFileSync(join(verbs, f), "utf8").matchAll(/registerVerb\(\{\s*name: "([^"]+)"/g)) names.push(m[1]);
  }
  return names.sort();
}

function helpVerbs(out: string): string[] {
  return [...out.matchAll(/^ {2}([a-z][a-z-]*)\b/gm)].map((m) => m[1]).sort();
}

test(
  "61.2 the help verb lists every registered verb, and a new verb module appears with no other edit",
  () => {
    const c = cloneCheckout();
    try {
      const inst = sh(c.dir, ["bun", "install", "--frozen-lockfile"]);
      expect(inst.code).toBe(0);
      const before = sh(c.dir, ["bun", "src/cli.ts", "help"]);
      expect(before.code).toBe(0);
      const verbs = registered(c.dir);
      const listed = helpVerbs(before.out);
      console.log("registered", verbs.join(" "));
      console.log("listed", listed.join(" "));
      expect(listed).toEqual(verbs);
      expect(listed).toContain("help");

      writeFileSync(
        join(c.dir, "src/verbs/ping.ts"),
        `import { registerVerb } from "../cli/registry.ts";

registerVerb({
  name: "ping",
  help: "Print pong.",
  run: (_args, io) => {
    io.out("pong\\n");
    return 0;
  },
});
`,
      );
      const after = sh(c.dir, ["bun", "src/cli.ts", "help"]);
      expect(after.code).toBe(0);
      const listedAfter = helpVerbs(after.out);
      console.log("listed after", listedAfter.join(" "));
      expect(listedAfter).toEqual([...listed, "ping"].sort());

      const status = sh(c.dir, ["git", "status", "--porcelain"]);
      console.log("git status:", JSON.stringify(status.out));
      expect(status.out.trim().split("\n")).toEqual(["?? src/verbs/ping.ts"]);
    } finally {
      c.done();
    }
  },
  600_000,
);
