import { afterEach, beforeEach } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
export const YOU = ["--actor", "you"];

export function harness() {
  let p: Project | undefined;
  beforeEach(() => {
    p = createProject();
  });
  afterEach(async () => {
    await p?.dispose();
  });
  return {
    project: () => p as Project,
    werk: (...args: string[]) => (p as Project).run(["bun", CLI, ...args]),
  };
}

export const proposed = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed", id, kind: "card", title: `Title ${id}`, status: "open", ...extra,
});
export const accepted = (id: string) => ({ type: "node.accepted", id, actor: "you" });
export const real = (id: string, extra: Record<string, unknown> = {}) => [proposed(id, extra), accepted(id)];
export const decide = (id: string) => [
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
export const decidedCard = (id: string, extra: Record<string, unknown> = {}) => [...real(id, extra), ...decide(id)];
export const link = (from: string, to: string, type = "depends_on") => ({
  type: "edge.added", from, to, link: type, why: `${from} takes ${to}`,
});

export function writeLog(p: Project, ...events: unknown[]) {
  mkdirSync(dirname(p.logPath), { recursive: true });
  writeFileSync(p.logPath, events.flat().map((e) => (typeof e === "string" ? e : JSON.stringify(e)) + "\n").join(""));
}
export const logLines = (p: Project) =>
  readFileSync(p.logPath, "utf8").split("\n").filter((l) => l !== "");
export { appendFileSync };
