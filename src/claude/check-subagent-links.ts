/**
 * Fails when a shipped subagent has no link in the repository's subagent
 * folder, or when the file under its name is not a link. See #werk-cc-subagents.
 *
 * Usage: bun src/claude/check-subagent-links.ts [repository root]
 */
import { lstat, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SHIPPED_SUBAGENTS } from "../agent/subagents";
import { type Entry, subagentLinkFailures } from "./subagent-links";

export async function readEntries(
  root: string,
): Promise<Record<string, Entry>> {
  const entries: Record<string, Entry> = {};
  for (const name of Object.keys(SHIPPED_SUBAGENTS)) {
    const path = join(root, ".claude/agents", `${name}.md`);
    const stat = await lstat(path).catch(() => undefined);
    if (!stat) entries[name] = "missing";
    else if (!stat.isSymbolicLink()) entries[name] = "file";
    else {
      // A link must reach the one definition, not some other file.
      const target = resolve(
        join(root, ".claude/agents"),
        await readlink(path),
      );
      const source = resolve(root, "src/agent/subagents", `${name}.md`);
      entries[name] = target === source ? "link" : "file";
    }
  }
  return entries;
}

if (import.meta.main) {
  const root = resolve(process.argv[2] ?? join(import.meta.dir, "../.."));
  const failures = subagentLinkFailures(await readEntries(root));
  for (const line of failures) console.error(`werk: ${line}`);
  process.exit(failures.length > 0 ? 1 : 0);
}
