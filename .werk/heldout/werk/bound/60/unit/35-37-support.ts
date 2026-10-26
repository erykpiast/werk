import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type {
  LaunchRecord,
  MessageRecord,
} from "../../src/fake-agent/launch-log.ts";
import type { Reply, Script } from "../../src/fake-agent/script.ts";
import { decided } from "../../src/map/mark-fixtures.ts";
import { readPipeline } from "../../src/pipeline/log-store.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { AREA_ROLES, findingsOf, gradeOf, line, withJudges } from "../../src/build/judge-fixtures.ts";

export { AREA_ROLES, findingsOf, gradeOf, line };
import type { Judging } from "../../src/build/judge-fixtures.ts";
export type { Reply, Script };

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const MAKEFILE = "check:\n\t@test -f ok.txt\n";
export const TICKET = `title: Paste a screenshot
cites: images, menu
blocked_by:
stories: 1
touches: composer

## What to build

Make ok.txt exist.

## Acceptance criteria

- [ ] ok.txt exists
- [ ] the note is written

## Checks

- \`make check\`
`;

export const edit = (path: string, content: string) => ({ edit: path, content });

/** A grade with one entry per line of the ticket; the overrides replace the default score of 4. */
export function grade(overrides: Record<string, ReturnType<typeof line>> = {}) {
  const ids = ["criterion-1", "criterion-2", "card-images", "card-menu", "scope"];
  return gradeOf(...ids.map((id) => overrides[id] ?? line(id, 4)));
}

export type Env = {
  project: Project;
  boardPath: () => string;
  pipelinePath: () => string;
  board: () => ReturnType<typeof readBoard>;
  ticket: () => ReturnType<typeof readBoard>["tickets"] extends Map<string, infer T> ? T | undefined : never;
  seed: () => Promise<void>;
  build: (...extra: string[]) => ReturnType<Project["run"]>;
  messages: (role?: string) => MessageRecord[];
  launches: (role?: string) => LaunchRecord[];
  pipelinePasses: () => ReturnType<typeof readPipeline>["builds"] extends Map<string, infer B> ? B : never;
  transcriptOf: (pass: number) => string;
  dispose: () => Promise<void>;
};

const writeLines = (path: string, events: unknown[]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};

export function makeEnv(): Env {
  const project = createProject();
  const boardPath = () => join(project.dir, ".werk", "board.jsonl");
  const pipelinePath = () => join(project.dir, ".werk", "pipeline.jsonl");
  const board = () => readBoard(boardPath());
  const env: Env = {
    project,
    boardPath,
    pipelinePath,
    board,
    ticket: () => board().tickets.get("r/01") as never,
    async seed() {
      writeFileSync(join(project.dir, "Makefile"), MAKEFILE);
      await project.run(["git", "add", "-A"]);
      await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
      writeLines(project.logPath, [
        ...decided("images", { title: "A message carries its images", why: "Because." }),
        ...decided("menu", { title: "The composer shows a menu", why: "Because." }),
      ]);
      writeLines(boardPath(), [
        { type: "ticket.planned", id: "r/01", title: "Paste a screenshot" },
      ]);
      const file = join(project.dir, ".werk", "tickets", "r", "01.md");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, TICKET);
    },
    build: (...extra) =>
      project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra]),
    messages: (role = "builder") =>
      project
        .launches()
        .filter((r): r is MessageRecord => r.kind === "message" && r.role === role),
    launches: (role) =>
      project
        .launches()
        .filter((r): r is LaunchRecord => r.kind === "launch" && (role === undefined || r.role === role)),
    pipelinePasses: () => [...readPipeline(pipelinePath()).builds.values()][0] as never,
    transcriptOf: (pass) => {
      const file = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[pass]?.transcript;
      return readFileSync(join(dirname(pipelinePath()), file ?? "none"), "utf8");
    },
    dispose: () => project.dispose(),
  };
  return env;
}

/** Like withJudges, but a grade that is not given scores every line of this ticket 4 (the stock grade omits criterion-2 and the cards). */
export function withJudgesT(builds: Reply[], judging: Judging = {}): Script {
  return withJudges(builds, {
    ...judging,
    grades: judging.grades ?? Array(8).fill(grade()),
  });
}

import { judgeRoles } from "../../src/build/judge-fixtures.ts";
/** The grader and reviewer roles for this ticket, with the grade that scores every line 4. */
export const judgeRolesT = () =>
  judgeRoles({ grades: Array(8).fill(grade()) });
