// The post-edit hook of the shared Claude Code settings (#werk-cc-hooks). It formats and lints
// the one file that the agent edited, applies the safe fixes, and returns the remaining errors
// to the agent on stderr with exit code 2. It never blocks the edit and runs nothing else.
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR ?? join(import.meta.dir, "..");
const biome = join(import.meta.dir, "..", "node_modules", ".bin", "biome");

const input: { tool_input?: { file_path?: unknown } } = JSON.parse((await Bun.stdin.text()) || "{}");
const filePath = input.tool_input?.file_path;
if (typeof filePath !== "string") process.exit(0);

const file = resolve(root, filePath);
const inside = relative(root, file);
if (inside.startsWith("..") || isAbsolute(inside) || !existsSync(file) || !existsSync(biome)) process.exit(0);

const run = Bun.spawnSync(
  [
    biome,
    "check",
    "--write",
    "--error-on-warnings",
    "--files-ignore-unknown=true",
    "--no-errors-on-unmatched",
    "--colors=off",
    inside,
  ],
  { cwd: root, stdout: "pipe", stderr: "pipe" },
);
if (run.exitCode === 0) process.exit(0);
process.stderr.write(`Lint errors remain in ${inside}:\n${run.stdout.toString()}${run.stderr.toString()}`);
process.exit(2);
