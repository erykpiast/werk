import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "bun:test";
import { createProject, type Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

export type Werk = {
  project: Project;
  run: (...args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Runs a command and throws when it exits non-zero. */
  ok: (...args: string[]) => Promise<string>;
  write: (path: string, text: string) => void;
  events: () => Record<string, unknown>[];
};

/** A fresh project for each test, and a runner for the werk command line in it. */
export function useWerk(): () => Werk {
  let project: Project | undefined;
  beforeEach(() => {
    project = createProject();
  });
  afterEach(async () => {
    await project?.dispose();
    project = undefined;
  });
  return () => {
    const p = project as Project;
    const run: Werk["run"] = (...args) => p.run(["bun", CLI, ...args]);
    return {
      project: p,
      run,
      ok: async (...args) => {
        const r = await run(...args);
        if (r.code !== 0)
          throw new Error(`werk ${args.join(" ")} exit ${r.code}: ${r.stderr}${r.stdout}`);
        return r.stdout;
      },
      write: (path, text) => {
        mkdirSync(dirname(join(p.dir, path)), { recursive: true });
        writeFileSync(join(p.dir, path), text);
      },
      events: () => p.events() as Record<string, unknown>[],
    };
  };
}

/**
 * Adds a card through the command line, with the facts a decision needs, and decides it.
 * With `decided: false` the card is only added and accepted. A ghost stays a ghost.
 */
export async function makeCard(
  w: Werk,
  id: string,
  opts: { parent?: string; decided?: boolean; ghost?: boolean; title?: string; why?: string; body?: string } = {},
): Promise<void> {
  const args = ["add", id, "--title", opts.title ?? `Title of ${id}`, "--why", opts.why ?? `why ${id}`];
  if (opts.body) args.push("--body", opts.body);
  // A card decided under a parent that is not decided waits on that parent for its basis.
  // So a decided card is added alone and linked under its parent after the decision.
  const lateParent = opts.decided && opts.parent;
  if (opts.parent && !lateParent) args.push("--parent", opts.parent);
  await w.ok(...args);
  if (opts.decided) {
    await w.ok("edit", id, "--who", "me", "--no-basis", "waived");
    await w.ok("kill", id, "--revisit");
  }
  if (!opts.ghost) await w.ok("accept", id, "--actor", "you");
  if (opts.decided) await w.ok("status", id, "decided");
  if (lateParent) await w.ok("link", id, lateParent, "--type", "refines");
}
