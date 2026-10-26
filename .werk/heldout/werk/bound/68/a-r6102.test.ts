import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout } from "./a-repo-copy.ts";

test("61.2 help lists every verb, and a new verb module appears with no other edit", () => {
  const c = cloneCheckout();
  try {
    const verbsIn = (out: string) => [...out.matchAll(/^ {2}([a-z-]+)(?: |$)/gm)].map((m) => m[1]);
    const h1 = c.sh(["bun", "src/cli.ts", "help"]);
    expect(h1.code).toBe(0);
    const before = verbsIn(h1.out);
    const files = c.sh(["ls", "src/verbs"]).out.split("\n").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts");
    for (const f of files) expect(before).toContain(f.replace(/\.ts$/, ""));
    expect(before).toContain("help");
    writeFileSync(
      join(c.dir, "src/verbs/ping.ts"),
      `import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Print pong.",\n  run: (_args, io) => {\n    io.out("pong");\n    return 0;\n  },\n});\n`,
    );
    const h2 = c.sh(["bun", "src/cli.ts", "help"]);
    console.log("help after:", h2.code, verbsIn(h2.out).join(","));
    const after = verbsIn(h2.out);
    expect(after).toContain("ping");
    for (const v of before) expect(after).toContain(v);
    expect(c.sh(["git", "status", "--porcelain"]).out.trim()).toBe("?? src/verbs/ping.ts");
  } finally {
    c.remove();
  }
}, 300_000);
