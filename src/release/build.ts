/**
 * The release build: one executable for each of macOS and Linux on ARM and Intel, each with a
 * checksum beside it. No tag, tap or publish step runs here (#werk-dist).
 * Usage: bun src/release/build.ts [output folder] [--current]
 * --current builds only the platform of this machine.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { VERB_MODULE_NAMES } from "../own/verb-names.ts";
import { checksumLine, entrySource, type OwnList } from "./entry-source.ts";

const REPO = join(import.meta.dir, "..", "..");
const CLIENT_DIR = join(REPO, "dist", "client");
const SUBAGENTS_DIR = join(REPO, "src", "agent", "subagents");

/** Bun's compile targets. The name suffix is the platform in the file name. */
export const PLATFORMS = [
  { target: "bun-darwin-arm64", suffix: "darwin-arm64" },
  { target: "bun-darwin-x64", suffix: "darwin-x64" },
  { target: "bun-linux-arm64", suffix: "linux-arm64" },
  { target: "bun-linux-x64", suffix: "linux-x64" },
] as const;

function run(command: string[], cwd = REPO): void {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited with ${result.exitCode}`);
  }
}

/** Every file under a folder, as forward-slash paths relative to it. This is the build listing the folder, never werk. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    )
    .sort();
}

/** The platform this machine runs, which a CI run builds and starts. */
export function currentPlatform(): (typeof PLATFORMS)[number] {
  const suffix = `${process.platform}-${process.arch}`;
  const found = PLATFORMS.find((p) => p.suffix === suffix);
  if (!found) throw new Error(`werk: no executable platform for ${suffix}`);
  return found;
}

export function build(
  outDir: string,
  platforms: readonly (typeof PLATFORMS)[number][] = PLATFORMS,
): string[] {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  run(["bun", "x", "vite", "build", "--config", join(REPO, "vite.config.ts")]);

  const list: OwnList = {
    client: filesUnder(CLIENT_DIR),
    verbs: [...VERB_MODULE_NAMES],
    subagents: filesUnder(SUBAGENTS_DIR).filter((f) => f.endsWith(".md")),
  };
  // The list of werk's own files, beside the executables.
  writeFileSync(
    join(outDir, "own-files.json"),
    `${JSON.stringify(list, null, 2)}\n`,
  );
  const entry = join(outDir, "entry.ts");
  writeFileSync(
    entry,
    entrySource(list, {
      clientDir: CLIENT_DIR,
      verbsDir: join(REPO, "src", "verbs"),
      ownModule: join(REPO, "src", "own", "own.ts"),
      cliModule: join(REPO, "src", "cli.ts"),
    }),
  );

  const written: string[] = [];
  for (const { target, suffix } of platforms) {
    const file = join(outDir, `werk-${suffix}`);
    // Vite loads only in dev mode, so the executable does not carry it.
    run([
      "bun",
      "build",
      "--compile",
      `--target=${target}`,
      "--external",
      "vite",
      "--outfile",
      file,
      entry,
    ]);
    const digest = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
    writeFileSync(`${file}.sha256`, checksumLine(digest, `werk-${suffix}`));
    written.push(file);
  }
  return written;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const files = build(
    args.find((a) => !a.startsWith("--")) ?? join(REPO, "dist", "release"),
    args.includes("--current") ? [currentPlatform()] : PLATFORMS,
  );
  for (const file of files) console.log(`werk: built ${file}`);
}
