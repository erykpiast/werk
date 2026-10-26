import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");
export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

type Ev = Record<string, unknown>;
/** Writes events straight to the log: the fixture for a state the command line cannot reach yet. */
export function seed(p: Project, events: Ev[]): void {
  mkdirSync(dirname(p.logPath), { recursive: true });
  for (const e of events) appendFileSync(p.logPath, `${JSON.stringify(e)}\n`);
}
/** A real card: proposed, then accepted by the person. */
export const card = (
  id: string,
  title: string,
  status: "open" | "proto" | "decided",
  extra: Ev = {},
): Ev[] => [
  { type: "node.proposed", id, kind: "card", title, status, ...extra },
  { type: "node.accepted", id, actor: "you" },
];

export async function until<T>(
  read: () => T | undefined | Promise<T | undefined>,
  ms = 10000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await (async () => read())().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(50);
  }
}
