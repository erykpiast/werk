import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserServer } from "../../e2e/support/server.ts";

export const jsonl = (...events: unknown[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

/** Appends events to the map log of the project. */
export function mapEvents(app: BrowserServer, ...events: unknown[]) {
  appendFileSync(join(app.dir, ".werk", "log.jsonl"), jsonl(...events));
}

/** Appends events to the board log of the project. */
export function boardEvents(app: BrowserServer, ...events: unknown[]) {
  appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl(...events));
}

/** A real card: proposed under a parent, then accepted. */
export const card = (
  id: string,
  title: string,
  parent = "root",
  status: "open" | "proto" = "open",
) => [
  { type: "node.proposed", id, kind: "card", title, status, parent },
  { type: "node.accepted", id, actor: "you" },
];

/** Moves a real open card to decided, waiving the facts. */
export const decide = (id: string) => [
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];

export function writeTicketFile(
  app: BrowserServer,
  group: string,
  number: string,
  title: string,
  body: string,
) {
  const dir = join(app.dir, ".werk", "tickets", group);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${number}.md`),
    `title: ${title}\ncites: root\nblocked_by: \nstories: 77\ntouches: board view\n\n## What to build\n\n${body}\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- \`make test\`\n`,
  );
}
