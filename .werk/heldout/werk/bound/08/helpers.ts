import { join } from "node:path";
import type { Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export function werk(project: Project, ...args: string[]) {
  return project.run(["bun", CLI, ...args]);
}

/** Runs a werk command and throws when it does not exit 0, so a setup error is loud. */
export async function must(project: Project, ...args: string[]) {
  const r = await werk(project, ...args);
  if (r.code !== 0) {
    throw new Error(`setup: werk ${args.join(" ")} -> ${r.code}: ${r.stderr}`);
  }
  return r;
}

/** Adds a card as a ghost and accepts it as the person. */
export async function realCard(
  project: Project,
  id: string,
  parent?: string,
  title = id,
) {
  await must(
    project,
    "add",
    id,
    "--title",
    title,
    "--why",
    `why ${id}`,
    ...(parent ? ["--parent", parent] : []),
  );
  await must(project, "accept", id, "--actor", "you");
}

/** Takes a real card to decided through the four facts. */
export async function decide(project: Project, id: string) {
  await must(project, "edit", id, "--who", "me");
  await must(project, "edit", id, "--no-basis", "test");
  await must(project, "kill", id, "--revisit");
  await must(project, "status", id, "decided");
}

export function logTypes(project: Project): string[] {
  return (project.events() as { type: string }[]).map((e) => e.type);
}
