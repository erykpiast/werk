// `serve` starts the map server under Bun's hot reload (#werk-cli-serve, #werk-hmr).
import { join } from "node:path";
import { parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { logPathFor } from "../map/log-store.ts";
import { serve } from "../serve/live-server.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
const PARENT_ENV = "WERK_SERVE_PARENT";

/** Runs this verb again in a child that Bun hot-reloads, and returns the child's exit code. */
async function runHot(args: string[], env: Record<string, string | undefined>) {
  const child = Bun.spawn([process.execPath, "--hot", CLI, "serve", ...args], {
    env: { ...env, [PARENT_ENV]: String(process.pid) },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  return await child.exited;
}

registerVerb({
  name: "serve",
  summary: "Start the map server for this project",
  run: async ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["port"] });
    const port = Number(parsed.ok ? (parsed.flags.port ?? "4000") : Number.NaN);
    if (!parsed.ok || !Number.isInteger(port) || port < 0 || port > 65535) {
      err(
        `werk: ${parsed.ok ? "bad --port" : parsed.error}\nusage: serve [--port 4000]`,
      );
      return 2;
    }
    const parent = Number(env[PARENT_ENV]);
    // The child of runHot carries the marker, so it never starts a child of its own.
    if (!process.execArgv.includes("--hot") && env[PARENT_ENV] === undefined) {
      return await runHot(args, env);
    }
    return await serve({
      logPath: logPathFor(cwd, env),
      port,
      dev: env.WERK_DEV === "1",
      out,
      err,
      parentPid: Number.isInteger(parent) && parent > 0 ? parent : undefined,
    });
  },
});
