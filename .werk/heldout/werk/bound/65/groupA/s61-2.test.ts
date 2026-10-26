import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, sh } from "./clone.ts";

test("61.2 help lists every verb and a new verb module joins it", () => {
  const { dir, done } = cloneCheckout();
  try {
    expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
    const h1 = sh(dir, ["bun", "src/cli.ts", "help"]);
    expect(h1.code).toBe(0);
    const verbs = [...h1.out.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1] as string);
    console.log("verbs", verbs.join(","));
    const registered = sh(dir, ["sh", "-c", "for f in $(ls src/verbs/*.ts | grep -v test.ts); do grep -A1 'registerVerb({' $f | grep -o 'name: \"[a-z-]*\"' | sed 's/name: //;s/\"//g'; done | sort -u"]).out.trim().split("\n");
    console.log("registered in sources", registered.join(","));
    for (const v of registered) expect(verbs).toContain(v);
    expect(verbs).toContain("help");

    writeFileSync(
      join(dir, "src/verbs/ping.ts"),
      `import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Print pong.",\n  positionals: [],\n  run: (_args, io) => {\n    io.out("pong\\n");\n    return 0;\n  },\n});\n`,
    );
    const h2 = sh(dir, ["bun", "src/cli.ts", "help"]);
    console.log("help #2 exit", h2.code, h2.out.slice(0, 300));
    const verbs2 = [...h2.out.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1] as string);
    expect(verbs2).toContain("ping");
    for (const v of verbs) expect(verbs2).toContain(v);
    const st = sh(dir, ["git", "status", "--porcelain"]).out.trim();
    console.log("git status:", JSON.stringify(st));
    expect(st).toBe("?? src/verbs/ping.ts");
  } finally {
    done();
  }
}, 600_000);
