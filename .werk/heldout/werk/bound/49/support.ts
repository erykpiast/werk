import { resolve } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CLI = resolve(import.meta.dirname, "..", "src", "cli.ts");

export type W = (...args: string[]) => Promise<{
  code: number;
  stdout: string;
  stderr: string;
  all: string;
}>;

export function makeWerk(p: Project): W {
  return async (...args) => {
    const r = await p.run(["bun", CLI, ...args]);
    return { ...r, all: `${r.stdout}\n${r.stderr}` };
  };
}

/** Adds a card and accepts it as a real card (person's accept). */
export async function real(
  w: W,
  id: string,
  title: string,
  opts: { parent?: string; status?: string; why?: string; body?: string } = {},
) {
  const args = ["add", id, "--title", title];
  if (opts.parent) args.push("--parent", opts.parent);
  if (opts.status) args.push("--status", opts.status);
  if (opts.why) args.push("--why", opts.why);
  if (opts.body) args.push("--body", opts.body);
  const a = await w(...args);
  if (a.code !== 0) throw new Error(`add ${id}: ${a.all}`);
  const b = await w("accept", id, "--actor", "you");
  if (b.code !== 0) throw new Error(`accept ${id}: ${b.all}`);
}

/** Makes a real card decided through the contract. */
export async function decide(w: W, id: string) {
  for (const a of [
    ["edit", id, "--who", "you"],
    ["edit", id, "--no-basis", "test"],
    ["edit", id, "--unchallenged", "test"],
    ["kill", id, "--revisit"],
    ["status", id, "decided"],
  ]) {
    const r = await w(...a);
    if (r.code !== 0) throw new Error(`${a.join(" ")}: ${r.all}`);
  }
}

export { createProject };
