// `werk ticket-check` runs every ticket check on a folder of tickets and prints one line per
// failure; the exit code is the verdict (#werk-ticket-check-verb-form, #st-ticket-checks-run).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerVerb } from "../cli/registry.ts";
import { USAGE_ERROR } from "../cli/start.ts";
import { formatProblems } from "../map/show.ts";
import { logPath, readMap } from "../map/store.ts";
import { decidedCardsUnder } from "../tickets/cards.ts";
import { checkTickets } from "../tickets/check.ts";
import { formatReport } from "../tickets/report.ts";
import { specStories } from "../tickets/spec.ts";

const USAGE = "Usage: werk ticket-check <folder> --root <card-id> --spec <file>\n";

registerVerb({
  name: "ticket-check",
  help: "Check a folder of tickets: the own checks on each ticket, then the set checks. Exit 0 pass, 1 fail, 2 malformed call.",
  positionals: [{ name: "folder", value: "text" }],
  flags: [
    { name: "root", value: "id", help: "The card whose decided subtree the tickets must cite" },
    { name: "spec", value: "text", help: "The spec whose User stories the tickets must deliver" },
  ],
  run: ({ positionals, flags }, io) => {
    const malformed = (message: string, usage = false) => {
      io.err(`werk ticket-check: ${message}\n${usage ? USAGE : ""}`);
      return USAGE_ERROR;
    };
    const folder = positionals[0] as string;
    const root = flags.root;
    const spec = flags.spec;
    if (typeof root !== "string") return malformed("--root is required", true);
    if (typeof spec !== "string") return malformed("--spec is required", true);
    if (!existsSync(folder) || !statSync(folder).isDirectory()) return malformed(`no folder "${folder}"`);
    if (!existsSync(spec) || !statSync(spec).isFile()) return malformed(`no spec file "${spec}"`);
    const stories = specStories(readFileSync(spec, "utf8"));
    if (stories === undefined) return malformed(`the spec "${spec}" has no User stories heading`);
    const map = readMap("ticket-check", logPath());
    io.err(formatProblems(map.problems));
    if (!map.nodes.has(root)) return malformed(`no node "${root}"`);
    const files = readdirSync(folder)
      .filter((name) => name.endsWith(".md") && statSync(join(folder, name)).isFile())
      .sort()
      .map((file) => ({ file, text: readFileSync(join(folder, file), "utf8") }));
    const result = checkTickets(files, decidedCardsUnder(map, root), stories);
    io.out(formatReport(result.failures, result.counts));
    return result.failures.length === 0 ? 0 : 1;
  },
});
