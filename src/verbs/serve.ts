// `serve` starts the one map server under Bun's hot reload, or adds its folder to the server that runs
// (#werk-cli-serve, #werk-hmr, #werk-projects-one-process).
import { parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { isExecutable, selfCommand } from "../own/own.ts";
import { userHome } from "../projects/list-store.ts";
import { attachToRunning } from "../serve/attach.ts";
import { serve } from "../serve/live-server.ts";

const PARENT_ENV = "WERK_SERVE_PARENT";

/** Runs this verb again in a child that Bun hot-reloads, and returns the child's exit code. */
async function runHot(args: string[], env: Record<string, string | undefined>) {
  const [runtime = process.execPath, ...entry] = selfCommand();
  const child = Bun.spawn([runtime, "--hot", ...entry, "serve", ...args], {
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
    const home = userHome(env);
    // The child of runHot has no need to look: its parent looked first.
    if (env[PARENT_ENV] === undefined) {
      const attached = await attachToRunning({
        home,
        folder: cwd,
        env,
        out,
        err,
      });
      if (attached !== null) return attached;
    }
    const parent = Number(env[PARENT_ENV]);
    // The child of runHot carries the marker, so it never starts a child of its own. An executable
    // has no source to reload, so it serves in its own process (#werk-dist-own-list).
    if (
      !isExecutable() &&
      !process.execArgv.includes("--hot") &&
      env[PARENT_ENV] === undefined
    ) {
      return await runHot(args, env);
    }
    return await serve({
      folder: cwd,
      home,
      env,
      port,
      dev: env.WERK_DEV === "1" && !isExecutable(),
      out,
      err,
      parentPid: Number.isInteger(parent) && parent > 0 ? parent : undefined,
    });
  },
});
