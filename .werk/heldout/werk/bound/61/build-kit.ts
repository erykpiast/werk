import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import type { LaunchRecord, MessageRecord } from "../src/fake-agent/launch-log.ts";
import type { Reply } from "../src/fake-agent/script.ts";
import { open } from "../src/map/mark-fixtures.ts";
import { readPipeline } from "../src/pipeline/log-store.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { CLI } from "./cli.ts";

export { ALL_GOOD, AREA_ROLES, findingsOf, gradeOf, judgeRoles, line, result, withJudges } from "../src/build/judge-fixtures.ts";

export const MAKEFILE = "check:\n\t@test -f ok.txt\n";

export type Seed = { cards?: { id: string; title: string }[]; criteria?: string[]; makefile?: string };

export function kit() {
  const project: Project = createProject();
  const boardPath = join(project.dir, ".werk", "board.jsonl");
  const pipelinePath = join(project.dir, ".werk", "pipeline.jsonl");
  const board = () => readBoard(boardPath);
  const ticket = (id = "r/01") => board().tickets.get(id);
  const writeLines = (path: string, events: unknown[]) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  };
  const launches = () => project.launches().filter((r): r is LaunchRecord => r.kind === "launch");
  const launched = (role: string) => launches().filter((l) => l.role === role);
  const messages = (role = "builder") => project.launches().filter((r): r is MessageRecord => r.kind === "message" && r.role === role);
  const pass = (n = 0) => [...readPipeline(pipelinePath).builds.values()][0]?.passes[n];
  const transcriptOf = (n: number) => {
    const file = pass(n)?.transcript;
    return readFileSync(join(dirname(pipelinePath), file ?? "none"), "utf8");
  };
  async function seed(opts: Seed = {}) {
    const cards = opts.cards ?? [{ id: "top", title: "Seat price" }];
    const criteria = opts.criteria ?? ["ok.txt exists"];
    writeFileSync(join(project.dir, "Makefile"), opts.makefile ?? MAKEFILE);
    await project.run(["git", "add", "-A"]);
    await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
    writeLines(
      project.logPath,
      cards.flatMap((c) => [
        ...open(c.id, { title: c.title, why: "Because." }),
        { type: "node.edited", id: c.id, who: "me", noBasis: "test" },
        { type: "criterion.added", id: c.id, form: "revisit" },
        { type: "node.decided", id: c.id },
      ]),
    );
    writeLines(boardPath, [{ type: "ticket.planned", id: "r/01", title: "Paste a screenshot" }]);
    const file = join(project.dir, ".werk", "tickets", "r", "01.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `title: Paste a screenshot\ncites: ${cards.map((c) => c.id).join(", ")}\nblocked_by:\nstories: 1\ntouches: checks\n\n## What to build\n\nMake ok.txt exist.\n\n## Acceptance criteria\n\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}\n\n## Checks\n\n- \`make check\`\n`,
    );
  }
  const build = (...extra: string[]) => project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra]);
  return { project, boardPath, pipelinePath, board, ticket, writeLines, launches, launched, messages, pass, transcriptOf, seed, build };
}

export const edit = (path: string, content: string) => ({ edit: path, content });
export type { Reply };
