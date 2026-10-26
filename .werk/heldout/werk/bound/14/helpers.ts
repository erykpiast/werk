import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");
export { createProject };
export type { Project };

export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

export const url = (port: number, path: string) =>
  `http://127.0.0.1:${port}${path}`;

export async function until<T>(
  read: () => T | undefined | Promise<T | undefined>,
  ms = 15000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await (async () => read())().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(100);
  }
}

/** Port and pid that the running server wrote to its lock. */
export function holder(dir: string) {
  return until(() => {
    const lock = JSON.parse(
      readFileSync(join(dir, ".werk", "serve.lock"), "utf8"),
    );
    return lock.port > 0 ? (lock as { pid: number; port: number }) : undefined;
  });
}

/** A decided card "root": the log holds a proposed decided card and the person's accept. */
export function seedDecided(p: Project, id = "root", title = "Root") {
  const { appendFileSync, mkdirSync } = require("node:fs");
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  appendFileSync(
    p.logPath,
    `${JSON.stringify({ type: "node.proposed", id, kind: "card", title, status: "decided" })}\n${JSON.stringify({ type: "node.accepted", id, actor: "you" })}\n`,
  );
}
