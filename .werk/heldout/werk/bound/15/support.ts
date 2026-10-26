/** Shared helpers of the held-out tests: one fresh project per test, driven by the real command line. */
import { join } from "node:path";
import { readMap } from "../src/map/log-store.ts";
import { type Project, useProject } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export type Result = { code: number; stdout: string; stderr: string };

/** A fresh project for each test, and a `werk` that runs the command line in it. */
export function useWerk(): {
  project: () => Project;
  werk: (...args: string[]) => Promise<Result>;
  map: () => ReturnType<typeof readMap>["map"];
} {
  const project = useProject();
  return {
    project,
    werk: (...args) => project().run(["bun", CLI, ...args]),
    map: () => readMap(project().logPath).map,
  };
}

type Werk = (...args: string[]) => Promise<Result>;

async function ok(werk: Werk, ...args: string[]): Promise<void> {
  const result = await werk(...args);
  if (result.code !== 0) {
    throw new Error(`setup: werk ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/** A real card: proposed, then accepted by the person. */
export async function addCard(
  werk: Werk,
  id: string,
  opts: { parent?: string; status?: "open" | "proto" } = {},
): Promise<void> {
  await ok(
    werk,
    "add",
    id,
    "--title",
    `Title of ${id}`,
    "--why",
    `Why ${id}`,
    ...(opts.parent ? ["--parent", opts.parent] : []),
    ...(opts.status ? ["--status", opts.status] : []),
  );
  await ok(werk, "accept", id, "--actor", "you");
}

/** Fills the four facts of the contract and decides the card. The card has no parent yet. */
export async function decide(werk: Werk, id: string): Promise<void> {
  await ok(werk, "edit", id, "--who", "me", "--no-basis", "held-out setup");
  await ok(werk, "kill", id, "--revisit");
  await ok(werk, "status", id, "decided");
}

/** A decided real card. It links to its parent afterwards, so the parent need not be decided. */
export async function decidedCard(
  werk: Werk,
  id: string,
  parent?: string,
): Promise<void> {
  await addCard(werk, id);
  await decide(werk, id);
  if (parent) await ok(werk, "link", id, parent, "--type", "refines");
}

/** A decided ghost: proposed and decided, never accepted. It links to its parent afterwards. */
export async function decidedGhost(
  werk: Werk,
  id: string,
  parent: string,
): Promise<void> {
  await ok(werk, "add", id, "--title", `Title of ${id}`, "--why", `Why ${id}`);
  await decide(werk, id);
  await ok(werk, "link", id, parent, "--type", "refines");
}

export { ok };
