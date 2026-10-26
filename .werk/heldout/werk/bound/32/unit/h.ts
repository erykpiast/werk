import { join } from "node:path";
import { type RunResult, useProject } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

/** A fresh project per test, and a `werk` function that runs the command line in it. */
export function werkHarness() {
  const project = useProject();
  const werk = (...args: string[]): Promise<RunResult> =>
    project().run(["bun", CLI, ...args]);
  const must = async (...args: string[]) => {
    const r = await werk(...args);
    if (r.code !== 0)
      throw new Error(`setup failed: werk ${args.join(" ")}\n${r.stderr}`);
    return r;
  };
  /** A real, accepted, decided card (who me, no option needed). */
  const decide = async (
    id: string,
    opts: { title?: string; parent?: string; body?: string; why?: string } = {},
  ) => {
    const a = ["add", id, "--title", opts.title ?? id];
    if (opts.parent) a.push("--parent", opts.parent);
    if (opts.body) a.push("--body", opts.body);
    if (opts.why) a.push("--why", opts.why);
    await must(...a);
    await must("accept", id, "--actor", "you");
    await must("edit", id, "--who", "me", "--no-basis", "root of test");
    await must("kill", id, "--revisit");
    await must("status", id, "decided");
  };
  /** A real accepted card that stays open. */
  const real = async (
    id: string,
    opts: { title?: string; parent?: string; body?: string; why?: string } = {},
  ) => {
    const a = ["add", id, "--title", opts.title ?? id];
    if (opts.parent) a.push("--parent", opts.parent);
    if (opts.body) a.push("--body", opts.body);
    if (opts.why) a.push("--why", opts.why);
    await must(...a);
    await must("accept", id, "--actor", "you");
  };
  return { project, werk, must, decide, real };
}
