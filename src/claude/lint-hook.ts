/**
 * The hook that runs after an agent writes or edits a file. It formats and
 * lints that one file, applies the safe fixes, and returns the errors that
 * remain on stderr with exit 2, which Claude Code shows to the agent. The edit
 * is already done, so nothing blocks. See #werk-cc-hooks.
 */

const SOURCE = /\.(?:[cm]?[jt]sx?|json|jsonc|css)$/;

/** The file path in the hook's input, when it names a source file. */
export function sourceFile(input: string): string | undefined {
  try {
    const path = JSON.parse(input)?.tool_input?.file_path;
    return typeof path === "string" && SOURCE.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  const file = sourceFile(await Bun.stdin.text());
  if (file) {
    const run = Bun.spawnSync(
      ["bunx", "biome", "check", "--write", "--no-errors-on-unmatched", file],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (run.exitCode !== 0) {
      console.error(`${run.stdout.toString()}${run.stderr.toString()}`);
      process.exit(2);
    }
  }
}
