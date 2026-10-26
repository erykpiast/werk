// Steps 61.2 (help lists every verb; a new verb module appears) and 19.5 (subagent link check).
import { expect, test } from "bun:test";
import { copyFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshClone, run, sh } from "./repo-helpers.ts";

const LONG = 1_800_000;

function registeredVerbs(dir: string): string[] {
  const r = run(
    [
      "bun",
      "-e",
      `const { registry } = await import("./src/cli/registry.ts"); await import("./src/verbs/index.ts"); console.log(JSON.stringify(registry.list().map((v) => v.name)));`,
    ],
    dir,
  );
  if (r.code !== 0) throw new Error(r.out);
  return JSON.parse(r.out.trim().split("\n").at(-1) as string);
}

function helpVerbs(out: string): string[] {
  return [...out.matchAll(/^ {2}([a-z][\w-]*)(?: |$)/gm)].map((m) => m[1] as string);
}

test(
  "61.2 help lists every registered verb, and a new ping module appears with no other edit",
  () => {
    const dir = freshClone("verbs");
    const help1 = run(["bun", "src/cli.ts", "help"], dir);
    expect(help1.code).toBe(0);
    const listed1 = helpVerbs(help1.out);
    const registered = registeredVerbs(dir);
    console.log("registered:", registered.join(","), "\nhelp:", listed1.join(","));
    expect(listed1).toContain("help");
    for (const v of registered) expect(listed1).toContain(v);

    writeFileSync(
      join(dir, "src", "verbs", "ping.ts"),
      `import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Answer pong.",\n  run: (_args, io) => {\n    io.out("pong\\n");\n    return 0;\n  },\n});\n`,
    );
    const help2 = run(["bun", "src/cli.ts", "help"], dir);
    console.log(help2.out);
    expect(help2.code).toBe(0);
    const listed2 = helpVerbs(help2.out);
    expect(listed2).toContain("ping");
    for (const v of listed1) expect(listed2).toContain(v);
    const status = sh("git status --porcelain", dir);
    console.log("git status:", status.out);
    expect(status.out.trim().split("\n")).toEqual(["?? src/verbs/ping.ts"]);
  },
  LONG,
);

test(
  "19.5 the repository checks catch a subagent copy that replaces its link",
  () => {
    const dir = freshClone("links");
    const check = () => run(["make", "test"], dir);
    const first = check();
    expect(first.code).toBe(0);
    const link = join(dir, ".claude", "agents", "test-scope.md");
    rmSync(link);
    copyFileSync(join(dir, "src", "agent", "subagents", "test-scope.md"), link);
    const broken = check();
    console.log(broken.out);
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("test-scope.md");
    rmSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const again = check();
    expect(again.code).toBe(0);
    expect(sh("git status --porcelain", dir).out.trim()).toBe("");
  },
  LONG,
);
