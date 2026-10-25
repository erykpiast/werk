/**
 * Starts a built executable once in an empty project folder and reads the map through it. The
 * run is green only when that read answers (#werk-ci).
 * Usage: bun src/release/smoke.ts [executable]
 * With no argument it starts the executable that the smoke build wrote for this platform.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { currentPlatform } from "./build.ts";

/** Where the smoke target builds the executable of this machine's platform. */
const SMOKE_DIR = join(import.meta.dir, "..", "..", "dist", "smoke");

const READY = /serving on (http:\/\/127\.0\.0\.1:\d+)/;
const WAIT_MS = 30_000;

/** Reads the executable's output until it names its address, or the time runs out. */
async function waitForAddress(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const deadline = Date.now() + WAIT_MS;
  let seen = "";
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
    const match = READY.exec(seen);
    if (match) return match[1] as string;
  }
  throw new Error(`werk: the executable did not serve. Output:\n${seen}`);
}

/** The environment of the started executable: the caller's, minus the variables that point werk at another map. */
function cleanEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("WERK_")) env[key] = value;
  }
  return { ...env, WERK_HOME: home };
}

export async function smoke(executable: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "werk-smoke-"));
  const folder = join(root, "smoke");
  mkdirSync(folder);
  // The server requires a git repository in the project folder.
  Bun.spawnSync(["git", "init", "--quiet"], { cwd: folder });
  const child = Bun.spawn([resolve(executable), "serve", "--port", "0"], {
    cwd: folder,
    env: cleanEnv(join(root, "home")),
    stdout: "pipe",
    stderr: "inherit",
  });
  try {
    const address = await waitForAddress(child.stdout);
    const response = await fetch(
      `${address}/api/projects/${encodeURIComponent(basename(folder))}/graph?shape=1`,
    );
    if (!response.ok) {
      throw new Error(`werk: the map read answered ${response.status}`);
    }
    const shape = (await response.json()) as { nodes?: unknown };
    if (!Array.isArray(shape.nodes)) {
      throw new Error("werk: the map read has no list of nodes");
    }
    console.log(`werk: the executable served its map at ${address}`);
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await smoke(
    process.argv[2] ?? join(SMOKE_DIR, `werk-${currentPlatform().suffix}`),
  );
}
