// Starts the werk server the way a person does (`make dev` runs `bun src/cli.ts serve`).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

export type Werk = { url: string; proc: ChildProcess; project: string };

export async function startWerk(): Promise<Werk> {
  const project = mkdtempSync(join(tmpdir(), "werk-heldout-proj-"));
  const proc = spawn("bun", [join(ROOT, "src/cli.ts"), "serve"], { cwd: project, env: { ...process.env, PORT: "0" } });
  let out = "";
  return await new Promise<Werk>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`werk serve printed no URL in 20s:\n${out}`)), 20_000);
    const read = (b: Buffer) => {
      out += b.toString();
      const m = out.match(/https?:\/\/[^\s]+/);
      if (m) { clearTimeout(timer); ok({ url: m[0].replace(/\/$/, ""), proc, project }); }
    };
    proc.stdout?.on("data", read);
    proc.stderr?.on("data", read);
    proc.on("exit", (code) => { clearTimeout(timer); fail(new Error(`werk serve exited with ${code}:\n${out}`)); });
  });
}

/** The person's map needs these cards. werk has no verb or API to create a card; this reports that. */
export function seedCards(_w: Werk, cards: { id: string; body?: string; summary?: string; removed?: boolean }[]): void {
  const help = spawnSync("bun", [join(ROOT, "src/cli.ts"), "help"]).stdout.toString();
  throw new Error(`no product interface to create cards ${cards.map((c) => c.id).join(", ")}; werk help lists:\n${help}`);
}
