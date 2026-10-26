import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export type { Run };

export class Map_ {
  readonly p: Project = freshProject();
  async w(...args: string[]): Promise<Run> {
    return this.p.werk(args);
  }
  /** Runs a werk command and throws when it fails. */
  async ok(...args: string[]): Promise<Run> {
    const r = await this.w(...args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}${r.out}`);
    return r;
  }
  get logFile(): string {
    return join(this.p.dir, ".werk", "log.jsonl");
  }
  raw(): string {
    return readFileSync(this.logFile, "utf8");
  }
  lines(): string[] {
    return this.raw().split("\n").filter(Boolean);
  }
  events(): { seq: number; actor: string; type: string; payload: Record<string, unknown> }[] {
    return this.lines().map((l) => JSON.parse(l));
  }
  count(): number {
    return this.lines().length;
  }
  /** A real card: proposed, then accepted by the person. */
  async real(id: string, title: string, parent?: string, extra: string[] = []): Promise<void> {
    await this.ok("add", id, "--title", title, ...(parent ? ["--parent", parent] : []), ...extra);
    await this.ok("accept", id, "--actor", "you");
  }
  async ghost(id: string, title: string, parent?: string, extra: string[] = []): Promise<void> {
    await this.ok("add", id, "--title", title, ...(parent ? ["--parent", parent] : []), ...extra);
  }
  async root(): Promise<void> {
    await this.real("root", "Root");
  }
  /** Decide a card that has no other card to lean on: waive basis and option, name who, kill criterion. */
  async decideAlone(id: string): Promise<void> {
    await this.ok("edit", id, "--no-basis", "nothing to build on");
    await this.ok("edit", id, "--unchallenged", "no alternative");
    await this.ok("edit", id, "--who", "you");
    await this.ok("kill", id, "--revisit");
    await this.ok("status", id, "decided");
  }
  chat(name: string, lines: { kind: string; speaker: string; text: string; at?: string }[]): void {
    const dir = join(this.p.dir, ".werk", "chats");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${name}.jsonl`),
      `${lines.map((l) => JSON.stringify({ session: "sess1", at: "t", ...l })).join("\n")}\n`,
    );
  }
}
