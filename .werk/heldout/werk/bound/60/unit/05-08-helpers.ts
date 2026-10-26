import { join } from "node:path";
import type { Project } from "../../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

export const werkIn = (project: Project) => (...args: string[]) =>
  project.run(["bun", CLI, ...args]);

type Werk = ReturnType<typeof werkIn>;

/** Adds a card, accepts it as the person, and decides it with the waivers. */
export async function decided(
  werk: Werk,
  id: string,
  title: string,
  parent?: string,
) {
  const add = ["add", id, "--title", title, "--why", `why ${id}`];
  if (parent) add.push("--parent", parent);
  const steps = [
    add,
    ["accept", id, "--actor", "you"],
    ["edit", id, "--who", "me", "--no-basis", "test root"],
    ["kill", id, "--revisit"],
    ["status", id, "decided"],
  ];
  for (const step of steps) {
    const r = await werk(...step);
    if (r.code !== 0)
      throw new Error(`setup ${step.join(" ")} failed: ${r.stderr}`);
  }
}

/** A real, open card. */
export async function real(
  werk: Werk,
  id: string,
  title: string,
  parent?: string,
) {
  const add = ["add", id, "--title", title, "--why", `why ${id}`];
  if (parent) add.push("--parent", parent);
  for (const step of [add, ["accept", id, "--actor", "you"]]) {
    const r = await werk(...step);
    if (r.code !== 0)
      throw new Error(`setup ${step.join(" ")} failed: ${r.stderr}`);
  }
}
