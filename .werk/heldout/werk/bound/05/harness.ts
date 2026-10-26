// Held-out harness: a fresh project folder with a .werk log, and werk run as a child process.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "src", "cli.ts");

export type Run = { code: number; out: string; err: string };

export function project() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-")));
  mkdirSync(join(dir, ".werk"));
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  let seq = 0;
  const env = { ...process.env } as Record<string, string>;
  delete env.WERK_LOG;
  return {
    dir,
    log,
    lines: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l)),
    /** A real card, as a person's accepted map holds it. */
    real(id: string, title: string, parent?: string) {
      seq++;
      appendFileSync(
        log,
        `${JSON.stringify({ seq, at: "t", actor: "you", type: "node.added", payload: { id, kind: "card", title, ...(parent ? { parent } : {}) } })}\n`,
      );
    },
    async werk(args: string[]): Promise<Run> {
      const proc = Bun.spawn([process.execPath, CLI, ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, out, err };
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
