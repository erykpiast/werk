// Helper: the release build, run in a copy of the checkout, with the default output folder as `make release-build` uses.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { copyRepo } from "./c-repo-copy.ts";

export const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

export function releaseBuild() {
  const { root, repo } = copyRepo();
  // `make release-build` runs exactly this command.
  const built = spawnSync("bun", ["src/release/build.ts"], {
    cwd: repo,
    encoding: "utf8",
  });
  return {
    root,
    repo,
    out: join(repo, "dist", "release"),
    code: built.status,
    stdout: built.stdout,
    stderr: built.stderr,
    exeFor: (platform = `${process.platform}-${process.arch}`) =>
      join(repo, "dist", "release", `werk-${platform}`),
  };
}
