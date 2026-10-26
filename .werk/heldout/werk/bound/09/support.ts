import { setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "../src/map/log-store.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export { createProject, type Project };

setDefaultTimeout(120000);

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");

export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

/** Runs a werk command that is part of a Given. A refusal is the binder's own setup error. */
export async function must(p: Project, ...args: string[]) {
  const r = await werk(p, ...args);
  if (r.code !== 0) {
    throw new Error(
      `SETUP werk ${args.join(" ")} exited ${r.code}: ${r.stderr}${r.stdout}`,
    );
  }
  return r;
}

type CardOpts = {
  title?: string;
  why?: string;
  body?: string;
  parent?: string;
  status?: "open" | "proto";
};

function addArgs(id: string, o: CardOpts) {
  const a = ["add", id, "--title", o.title ?? id];
  if (o.why !== undefined) a.push("--why", o.why);
  if (o.body !== undefined) a.push("--body", o.body);
  if (o.parent !== undefined) a.push("--parent", o.parent);
  if (o.status !== undefined) a.push("--status", o.status);
  return a;
}

/** A real (accepted) card with the given status. */
export async function real(p: Project, id: string, o: CardOpts = {}) {
  await must(p, ...addArgs(id, o));
  await must(p, "accept", id, "--actor", "you");
}

/** A real card that is decided: who me, a waived basis, a revisit criterion. No parent link. */
export async function decide(p: Project, id: string, o: CardOpts = {}) {
  await real(p, id, o);
  await must(p, "edit", id, "--who", "me");
  if (o.parent === undefined) {
    await must(p, "edit", id, "--no-basis", "heldout setup");
  }
  await must(p, "kill", id, "--revisit");
  await must(p, "status", id, "decided");
}

/** A decided card that is attached to a parent after it is decided, so the parent may stay open. */
export async function decideThenAttach(
  p: Project,
  id: string,
  parent: string,
  o: CardOpts = {},
) {
  await decide(p, id, { ...o, parent: undefined });
  await must(p, "link", id, parent, "--type", "refines", "--why", "child");
}

export function events(p: Project): Record<string, unknown>[] {
  return p.events() as Record<string, unknown>[];
}

export function appendRaw(p: Project, event: Record<string, unknown>) {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  let text = "";
  try {
    text = readFileSync(p.logPath, "utf8");
  } catch {}
  writeFileSync(p.logPath, `${text}${JSON.stringify(event)}\n`);
}

export const mapOf = (p: Project) => readMap(p.logPath).map;
