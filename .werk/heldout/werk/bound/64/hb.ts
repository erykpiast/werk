/** A project ready for `werk build r/01`, like the merge loop leaves it. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import type { LaunchRecord, MessageRecord } from "../src/fake-agent/launch-log.ts";
import { readPipeline } from "../src/pipeline/log-store.ts";
import { CLI, type Project, realDecided } from "./h.ts";

export const MAKEFILE = "check:\n\t@test -f ok.txt\n";

export const ticketText = (
  cites: string[] = ["top"],
  criteria: string[] = ["ok.txt exists"],
) => `title: Make the check pass
cites: ${cites.join(", ")}
blocked_by:
stories: 1
touches: checks

## What to build

Make ok.txt exist.

## Acceptance criteria

${criteria.map((c) => `- [ ] ${c}`).join("\n")}

## Checks

- \`make check\`
`;

export const writeLines = (path: string, events: unknown[]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};

export function ctx(p: Project) {
  const boardPath = join(p.dir, ".werk", "board.jsonl");
  const pipelinePath = join(p.dir, ".werk", "pipeline.jsonl");
  const board = () => readBoard(boardPath);
  const ticket = (id = "r/01") => board().tickets.get(id);
  const launches = () => p.launches().filter((r): r is LaunchRecord => r.kind === "launch");
  const launched = (role: string) => launches().filter((l) => l.role === role);
  const messages = (role = "builder") =>
    p.launches().filter((r): r is MessageRecord => r.kind === "message" && r.role === role);
  const pipeline = () => [...readPipeline(pipelinePath).builds.values()][0];
  const transcriptOf = (pass: number) => {
    const file = pipeline()?.passes[pass]?.transcript;
    return readFileSync(join(dirname(pipelinePath), file ?? "none"), "utf8");
  };
  async function seed(opts: { cards?: { id: string; title: string }[]; ticket?: string; extraBoard?: unknown[] } = {}) {
    writeFileSync(join(p.dir, "Makefile"), MAKEFILE);
    await p.run(["git", "add", "-A"]);
    await p.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
    const cards = opts.cards ?? [{ id: "top", title: "Seat price" }];
    writeLines(
      p.logPath,
      cards.flatMap((c) => realDecided(c.id, { title: c.title, why: "Because." })),
    );
    writeLines(boardPath, [
      { type: "ticket.planned", id: "r/01", title: "Make the check pass" },
      ...(opts.extraBoard ?? []),
    ]);
    const file = join(p.dir, ".werk", "tickets", "r", "01.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, opts.ticket ?? ticketText(cards.map((c) => c.id)));
  }
  const buildArgs = (...extra: string[]) => ["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra];
  const build = (...extra: string[]) => p.run(buildArgs(...extra));
  return { boardPath, pipelinePath, board, ticket, launches, launched, messages, pipeline, transcriptOf, seed, build, buildArgs };
}
export const edit = (path: string, content: string) => ({ edit: path, content });
