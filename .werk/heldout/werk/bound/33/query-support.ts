import { afterEach, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export function useWerk() {
  let project: Project | undefined;
  beforeEach(() => {
    project = createProject();
  });
  afterEach(async () => {
    await project?.dispose();
  });
  const p = () => project as Project;
  return {
    p,
    werk: (...args: string[]) => p().run(["bun", CLI, ...args]),
    seed(events: unknown[]) {
      mkdirSync(dirname(p().logPath), { recursive: true });
      writeFileSync(
        p().logPath,
        events.map((e) => `${JSON.stringify(e)}\n`).join(""),
      );
    },
    write(path: string, text: string) {
      mkdirSync(dirname(join(p().dir, path)), { recursive: true });
      writeFileSync(join(p().dir, path), text);
    },
  };
}

export const ghost = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});
export const open = (id: string, extra: Record<string, unknown> = {}) => [
  ghost(id, extra),
  { type: "node.accepted", id, actor: "you" },
];
export const decided = (id: string, extra: Record<string, unknown> = {}) => [
  ...open(id, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
export const link = (from: string, to: string, type = "depends_on", why = "because") => ({
  type: "edge.added",
  from,
  to,
  link: type,
  why,
});
