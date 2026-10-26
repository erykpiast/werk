import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export function setup() {
  let project: Project | undefined;
  return {
    make() {
      project = createProject();
      return project;
    },
    get p(): Project {
      return project as Project;
    },
    async done() {
      await project?.dispose();
    },
    werk: (...args: string[]) =>
      (project as Project).run(["bun", CLI, ...args]),
  };
}

/** Appends raw events to the project's log, as a hand-written seed. */
export function seed(p: Project, ...events: unknown[]) {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  appendFileSync(
    p.logPath,
    events
      .map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
      .join("\n") + "\n",
  );
}

export const card = (id: string, extra: Record<string, unknown> = {}) => [
  {
    type: "node.proposed",
    id,
    kind: "card",
    title: extra.title ?? id,
    status: "open",
    why: "because",
    ...extra,
  },
  { type: "node.accepted", id, actor: "you" },
];
export { writeFileSync };

/** Makes a decided card through the command line: add, satisfy the four facts, accept, decide. */
export async function decide(
  werk: (...a: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  id: string,
  title: string,
  parent?: string,
) {
  const add = ["add", id, "--title", title, "--why", "because"];
  if (parent) add.push("--parent", parent);
  const steps = [
    add,
    ["edit", id, "--who", "you"],
    ["edit", id, "--no-basis", "root of the test"],
    ["edit", id, "--unchallenged", "test card"],
    ["kill", id, "--revisit"],
    ["accept", id, "--actor", "you"],
    ["status", id, "decided"],
  ];
  for (const a of steps) {
    const r = await werk(...a);
    if (r.code !== 0) throw new Error(`setup ${a.join(" ")}: ${r.stderr}`);
  }
}
