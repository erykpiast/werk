// Named behaviours of the subagent link check (#werk-cc-subagents). Each case runs on its own
// temporary copy of the two folders (#werk-test-store); one case runs on this repository.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENTS_DIR, checkSubagentLinks, SHIPPED_DIR } from "./subagent-links.ts";

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository that ships `names` and links each of them. */
function repo(...names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "werk-links-"));
  roots.push(root);
  mkdirSync(join(root, SHIPPED_DIR), { recursive: true });
  mkdirSync(join(root, AGENTS_DIR), { recursive: true });
  for (const name of names) {
    writeFileSync(join(root, SHIPPED_DIR, name), `---\nname: ${name}\n---\n`);
    symlinkSync(join("..", "..", SHIPPED_DIR, name), join(root, AGENTS_DIR, name));
  }
  return root;
}

test("this repository links every shipped subagent", () => {
  expect(checkSubagentLinks(join(import.meta.dir, ".."))).toEqual([]);
});

test("a repository that links every shipped subagent passes, beside a plain file of its own", () => {
  const root = repo("a.md", "b.md");
  writeFileSync(join(root, AGENTS_DIR, "own.md"), "only werk's development uses this one");
  expect(checkSubagentLinks(root)).toEqual([]);
});

test("the check fails when a shipped subagent's link is replaced by a copy", () => {
  const root = repo("a.md");
  rmSync(join(root, AGENTS_DIR, "a.md"));
  writeFileSync(join(root, AGENTS_DIR, "a.md"), `---\nname: a.md\n---\n`);
  expect(checkSubagentLinks(root)).toEqual([
    `${AGENTS_DIR}/a.md: a copy, not a link; replace it with a link to ${SHIPPED_DIR}/a.md`,
  ]);
});

test("the check fails when a shipped subagent has no link", () => {
  const root = repo("a.md");
  rmSync(join(root, AGENTS_DIR, "a.md"));
  expect(checkSubagentLinks(root)).toEqual([`${AGENTS_DIR}/a.md: missing; link it to ${SHIPPED_DIR}/a.md`]);
});

test("the check fails when the link points at another file or at nothing", () => {
  const root = repo("a.md", "b.md");
  rmSync(join(root, AGENTS_DIR, "a.md"));
  symlinkSync(join("..", "..", SHIPPED_DIR, "b.md"), join(root, AGENTS_DIR, "a.md"));
  rmSync(join(root, AGENTS_DIR, "b.md"));
  symlinkSync("nowhere.md", join(root, AGENTS_DIR, "b.md"));
  expect(checkSubagentLinks(root)).toEqual([
    `${AGENTS_DIR}/a.md: links elsewhere; link it to ${SHIPPED_DIR}/a.md`,
    `${AGENTS_DIR}/b.md: links elsewhere; link it to ${SHIPPED_DIR}/b.md`,
  ]);
});

test("only definition files in the shipped folder count", () => {
  const root = repo("a.md");
  writeFileSync(join(root, SHIPPED_DIR, "notes.txt"), "not a subagent");
  expect(checkSubagentLinks(root)).toEqual([]);
});
