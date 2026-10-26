// Held-out helpers: a fresh project, a seeded real card, log reads, and an attempt to open the map.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const events = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { seq: number; actor: string; type: string; payload: Record<string, unknown> });

/** A project whose log holds the given real cards, as a person's accepted map would. */
export function mapWith(cards: { id: string; title: string; status?: string; kind?: string; parent?: string }[]) {
  const p = freshProject();
  cards.forEach((c, i) => {
    const ev = {
      seq: i + 1,
      at: "t",
      actor: "you",
      type: "node.added",
      payload: { kind: "card", ...c },
    };
    appendFileSync(logOf(p), `${JSON.stringify(ev)}\n`);
  });
  return p;
}

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

/**
 * The person opens the map: start werk's map server the way `make dev` does (`werk serve`)
 * and wait for it to stay up. Throws with what the command printed when it ends instead.
 */
export async function openMap(p: Project): Promise<void> {
  const proc = p.start([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "serve"]);
  const ended = await Promise.race([proc.exited, Bun.sleep(5000).then(() => undefined)]);
  if (ended !== undefined) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`the map did not open: werk serve exited ${ended}: ${err.split("\n")[0]}`);
  }
}
