// Held-out step 61.2: `werk help` lists every registered verb, and a new verb module joins it with no other edit.
// The test runs on a clone of this checkout, never on the checkout itself.
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "..");
const sh = (cmd: string[], cwd: string) => {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const verbsIn = (help: string) => [...help.matchAll(/^ {2}([a-z][a-z-]*)\b/gm)].map((m) => m[1] as string);

test("61.2 help lists every registered verb, and a new ping module appears with no other edit", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-612-")));
  try {
    const dir = join(root, "werk");
    const sha = sh(["git", "rev-parse", "HEAD"], SRC).out.trim();
    expect(sh(["git", "clone", "-q", SRC, dir], root).code).toBe(0);
    expect(sh(["git", "fetch", "-q", SRC, sha], dir).code).toBe(0);
    expect(sh(["git", "checkout", "-q", sha], dir).code).toBe(0);
    // The dependencies are installed: link the checkout's installed packages (node_modules is git-ignored).
    symlinkSync(join(SRC, "node_modules"), join(dir, "node_modules"));

    const before = sh([process.execPath, "src/cli.ts", "help"], dir);
    expect(before.code).toBe(0);
    const listed = verbsIn(before.out);
    const modules = readdirSync(join(dir, "src", "verbs"))
      .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "index.ts")
      .map((n) => n.replace(/\.ts$/, ""));
    for (const m of modules) expect(listed).toContain(m);
    // remove.ts also registers restore and removed.
    expect(listed).toContain("help");
    expect(listed).toContain("restore");
    expect(listed).toContain("removed");

    writeFileSync(
      join(dir, "src", "verbs", "ping.ts"),
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
    const after = sh([process.execPath, "src/cli.ts", "help"], dir);
    expect(after.code).toBe(0);
    const now = verbsIn(after.out);
    expect(now).toContain("ping");
    for (const v of listed) expect(now).toContain(v);
    const status = sh(["git", "status", "--porcelain"], dir).out.trim();
    expect(status).toBe("?? src/verbs/ping.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
