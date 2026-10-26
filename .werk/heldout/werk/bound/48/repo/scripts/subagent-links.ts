// The check that werk's repository links each shipped subagent instead of copying it
// (#werk-cc-subagents). Every definition in the shipped folder must appear in the Claude Code
// agents folder as a link to that file, so werk's own agents run the prompt that users get.
// A test runs it on this repository, so the unit tests fail when a link is missing or a copy.
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

export const SHIPPED_DIR = "src/agent/subagents";
export const AGENTS_DIR = ".claude/agents";

/** One line per shipped subagent that the agents folder does not link, in name order. */
export function checkSubagentLinks(root: string): string[] {
  const shipped = readdirSync(join(root, SHIPPED_DIR))
    .filter((name) => name.endsWith(".md"))
    .sort();
  return shipped.flatMap((name) => {
    const target = join(root, SHIPPED_DIR, name);
    const link = join(root, AGENTS_DIR, name);
    const linkPath = relative(root, link);
    if (!existsSync(link) && !isLink(link)) return [`${linkPath}: missing; link it to ${SHIPPED_DIR}/${name}`];
    if (!isLink(link)) return [`${linkPath}: a copy, not a link; replace it with a link to ${SHIPPED_DIR}/${name}`];
    if (!existsSync(link) || realpathSync(link) !== realpathSync(target)) {
      return [`${linkPath}: links elsewhere; link it to ${SHIPPED_DIR}/${name}`];
    }
    return [];
  });
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
