import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");
export const werk = (p: Project, ...args: string[]) => p.run(["bun", CLI, ...args]);
export const boardPath = (p: Project) => join(p.dir, ".werk", "board.jsonl");
export const seedBoard = (p: Project, ...events: unknown[]) => {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(p), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
export const boardText = (p: Project) => (existsSync(boardPath(p)) ? readFileSync(boardPath(p), "utf8") : "");
export const boardEvents = (p: Project) =>
  boardText(p).split("\n").filter(Boolean).map((l) => JSON.parse(l));
export const write = (p: Project, path: string, text: string) => {
  mkdirSync(join(p.dir, path, ".."), { recursive: true });
  writeFileSync(join(p.dir, path), text);
};
/** Writes raw map events straight to the map log. */
export const seedMap = (p: Project, ...events: unknown[]) => {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  appendFileSync(p.logPath, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
export const card = (id: string, parent?: string, decided = true) => [
  { type: "node.proposed", id, kind: "card", title: `Title ${id}`, status: "open", why: "w", ...(parent ? { parent } : {}) },
  { type: "node.accepted", id, actor: "you" },
  ...(decided
    ? [
        { type: "node.edited", id, who: "me", noBasis: "t", unchallenged: "t" },
        { type: "criterion.added", id, form: "revisit" },
        { type: "node.decided", id },
      ]
    : []),
];
export const ghostDecided = (id: string, parent: string) => ({
  type: "node.proposed", id, kind: "card", title: `Title ${id}`, status: "decided", why: "w", parent,
});
/** A root that is open again after its children were decided. */
export const reopenRoot = { type: "node.reopened", id: "root", at: "2026-10-10T09:00:00.000Z" };
