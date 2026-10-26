import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type W = Project & {
  log(): Record<string, unknown>[];
  seed(type: string, payload: object): void;
  card(id: string, title: string, parent?: string, extra?: object): void;
  decided(id: string, title: string, parent?: string, extra?: object): void;
  ok(...args: string[]): Promise<string>;
  chat(name: string, lines: object[]): void;
};

export function world(): W {
  const p = freshProject();
  const file = join(p.dir, ".werk", "log.jsonl");
  const log = () =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  const seed = (type: string, payload: object) =>
    appendFileSync(file, `${JSON.stringify({ seq: log().length + 1, at: "t", actor: "you", type, payload })}\n`);
  const card = (id: string, title: string, parent?: string, extra: object = {}) =>
    seed("node.added", { id, kind: "card", title, ...(parent ? { parent } : {}), ...extra });
  const decided = (id: string, title: string, parent?: string, extra: object = {}) => {
    card(id, title, parent, extra);
    seed("node.decided", { id });
  };
  const ok = async (...args: string[]) => {
    const r = await p.werk(args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
    return r.out;
  };
  const chat = (name: string, lines: object[]) => {
    mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
    writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  };
  return Object.assign(p, { log, seed, card, decided, ok, chat });
}
