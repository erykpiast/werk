// Helpers for the executable steps: build in a temporary copy of the checkout, never in the checkout.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, SCRIPT_FILE } from "../src/test/fake-script.ts";
export const CHECKOUT = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
export const FAKE_BIN = join(CHECKOUT, "src", "test", "fake-bin");
export const PLATFORM = `${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
export const COPY = "/tmp/infra/copy";

/** Make a copy of the tracked and untracked-but-not-ignored files of the checkout, install and build there. */
export function builtCopy(): string {
  const exe = join(COPY, "dist", "bin", `werk-${PLATFORM}`);
  if (existsSync(exe)) return exe;
  mkdirSync(COPY, { recursive: true });
  const files = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: CHECKOUT, encoding: "utf8" })
    .stdout.split("\n")
    .filter((f) => f !== "" && !f.startsWith(".werk-heldout/"));
  for (const f of files) cpSync(join(CHECKOUT, f), join(COPY, f), { recursive: true, verbatimSymlinks: true });
  spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: COPY });
  const built = spawnSync("make", ["build"], { cwd: COPY, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`make build failed: ${built.stdout}${built.stderr}`);
  return exe;
}

export type Running = {
  dir: string;
  url: string;
  fake: string;
  proc: ChildProcess;
  env: Record<string, string>;
  exe: string;
};

export function fixtureCopy(root: string): string {
  const dir = join(root, "project");
  cpSync(join(CHECKOUT, "e2e", "fixtures", "project"), dir, { recursive: true });
  return dir;
}

/** Start `exe serve` alone: an empty bin folder holds only the executable. */
export async function startExe(script: object = { roles: {} }): Promise<{ w: Running; root: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-infra-")));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const exe = join(bin, "werk");
  cpSync(builtCopy(), exe);
  const dir = fixtureCopy(root);
  const fake = join(root, "fake");
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake } as Record<string, string>;
  const proc = spawn(exe, ["serve", "--port", "0"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const m = /http:\/\/\S+/.exec(out);
      if (m) resolve(m[0].replace(/\/map$/, ""));
    });
    proc.once("exit", (code) => reject(new Error(`exe exited ${code}: ${err}`)));
  });
  return { w: { dir, url, fake, proc, env, exe }, root };
}
export { readFileSync, symlinkSync };
