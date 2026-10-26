import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { BrowserServer } from "../../e2e/support/server.ts";

export const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";

export const jsonl = (...events: unknown[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

/** A process that lives until the test kills it: the builder session. */
export function builder(): ChildProcess {
  return spawn("sleep", ["300"], { stdio: "ignore" });
}

export const column = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });
export const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

/**
 * Board log with tickets in blocked, ready, building, merging and done.
 * r/02 has two unfinished blockers (r/06, r/08), r/03 has three red passes.
 */
export function seed(app: BrowserServer, pid: number, streamEvents = 3) {
  const werk = join(app.dir, ".werk");
  mkdirSync(join(werk, "tickets", "r"), { recursive: true });
  writeFileSync(
    join(werk, "tickets", "r", "03.md"),
    "title: Build it\ncites: root\nblocked_by: \nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n",
  );
  const events: unknown[] = [
    {
      at: "2026-10-25T10:00:00.000Z",
      event: { type: "system", subtype: "init" },
    },
  ];
  for (let i = 0; i < streamEvents; i++) {
    events.push({
      at: `2026-10-25T10:00:${String(i + 1).padStart(2, "0")}.000Z`,
      event: {
        type: "assistant",
        message: { content: [{ type: "text", text: `Step number ${i}` }] },
      },
    });
  }
  writeFileSync(join(werk, "s1.jsonl"), jsonl(...events));
  writeFileSync(
    join(werk, "board.jsonl"),
    jsonl(
      { type: "ticket.planned", id: "r/01", title: "Done ticket" },
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
      {
        type: "ticket.planned",
        id: "r/02",
        title: LONG,
        blocked_by: ["r/06", "r/08"],
      },
      { type: "ticket.planned", id: "r/03", title: "Build it" },
      { type: "ticket.moved", id: "r/03", to: "building" },
      { type: "build.started", id: "r/03", session: "s1", pid, log: "s1.jsonl" },
      { type: "ticket.pass", id: "r/03", n: 1, result: "red" },
      { type: "ticket.pass", id: "r/03", n: 2, result: "red" },
      { type: "ticket.pass", id: "r/03", n: 3, result: "red" },
      {
        type: "ticket.planned",
        id: "r/04",
        title: "Blocked ticket",
        reason: "a cited card is stale",
      },
      { type: "ticket.planned", id: "r/05", title: "Merging ticket" },
      { type: "ticket.moved", id: "r/05", to: "building" },
      { type: "ticket.moved", id: "r/05", to: "merging", actor: "loop" },
      { type: "ticket.planned", id: "r/06", title: "Open blocker" },
      { type: "ticket.planned", id: "r/08", title: "Second blocker" },
      // A building ticket with no session at all.
      { type: "ticket.planned", id: "r/07", title: "Building without process" },
      { type: "ticket.moved", id: "r/07", to: "building" },
    ),
  );
}
