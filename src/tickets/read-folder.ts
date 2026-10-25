import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ticketNumber } from "./ticket-parse.ts";

/** Every ticket file of one folder, in name order, as the ticket checks read them. */
export function readTicketFiles(dir: string): { name: string; text: string }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

/** Removes every file of a ticket folder whose number is not in `keep`, so the files of tickets the board holds stay. */
export function clearTicketFolder(
  dir: string,
  keep: ReadonlySet<number>,
): void {
  for (const name of readdirSync(dir)) {
    const digits = ticketNumber(name);
    if (digits === null || !keep.has(Number(digits)))
      rmSync(join(dir, name), { recursive: true, force: true });
  }
}

/** The number at the start of each file name in a ticket folder; a missing folder has none. */
export function ticketFileNumbers(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir).flatMap((name) => ticketNumber(name) ?? [])
    : [];
}
