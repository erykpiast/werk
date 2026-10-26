import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "../src/map/log-store.ts";
import { shapeRead } from "../src/serve/read-api.ts";
import type { Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");
export const AT = "2026-10-10T09:00:00.000Z";

export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

export const seed = (p: Project, events: unknown[]) =>
  writeFileSync(
    p.logPath,
    `${events
      .flat()
      .map((e) => JSON.stringify(e))
      .join("\n")}\n`,
  );

export const appendRaw = (p: Project, line: string) =>
  appendFileSync(p.logPath, `${line}\n`);

export const logText = (p: Project) => readFileSync(p.logPath, "utf8");

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
export const reopen = (id: string, reason: string) => ({
  type: "node.reopened",
  id,
  reason,
  at: AT,
});

/** The map as the log folds it, and its problems. */
export const mapOf = (p: Project) => readMap(p.logPath).map;
export const viewIds = (p: Project) => shapeRead(mapOf(p)).nodes.map((n) => n.id);
export const viewEdges = (p: Project) => shapeRead(mapOf(p)).edges;
