// `ticket-check` judges a folder of tickets with one verdict (#werk-ticket-check-verb-form).
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { logPathFor, readMap } from "../map/log-store.ts";
import { checkTickets, formatVerdict } from "../tickets/check-folder.ts";
import { decidedUnder } from "../tickets/decided-cards.ts";
import { readTicketFiles } from "../tickets/read-folder.ts";
import { storiesOf } from "../tickets/spec-stories.ts";

const USAGE = "usage: ticket-check <folder> --root <card-id> --spec <file>";

registerVerb({
  name: "ticket-check",
  summary: "Check a folder of tickets: one line per failure, exit 0, 1 or 2",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, {
      flags: ["root", "spec"],
      idFlags: ["root"],
    });
    const [folder, ...extra] = parsed.ok ? parsed.positional : [];
    const root = parsed.ok ? parsed.flags.root : undefined;
    const spec = parsed.ok ? parsed.flags.spec : undefined;
    if (
      !parsed.ok ||
      folder === undefined ||
      extra.length > 0 ||
      !root ||
      !spec
    ) {
      err(
        `werk: ${parsed.ok ? "ticket-check needs a folder, --root and --spec" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const dir = resolve(cwd, folder);
    const specPath = resolve(cwd, spec);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      err(`werk: no folder "${folder}"\n${USAGE}`);
      return 2;
    }
    if (!existsSync(specPath) || !statSync(specPath).isFile()) {
      err(`werk: no spec file "${spec}"\n${USAGE}`);
      return 2;
    }
    const stories = storiesOf(readFileSync(specPath, "utf8"));
    if (stories === null) {
      err(`werk: the spec "${spec}" has no "User stories" heading`);
      return 2;
    }
    const { map } = readMap(logPathFor(cwd, env));
    if (!map.nodes.has(cardId(root))) {
      err(`werk: unknown root card "${root}"`);
      return 2;
    }
    const files = readTicketFiles(dir);
    const verdict = checkTickets(
      files,
      decidedUnder(map, cardId(root)),
      stories,
    );
    for (const line of formatVerdict(verdict)) out(line);
    return verdict.failures.length === 0 ? 0 : 1;
  },
});
