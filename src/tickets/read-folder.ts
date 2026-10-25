import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Every ticket file of one folder, in name order, as the ticket checks read them. */
export function readTicketFiles(dir: string): { name: string; text: string }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}
