// `build` runs the builder loop on one ticket in its own worktree (#werk-cli-build, #st-build-ticket).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BuildRefused, buildTicket } from "../build/loop.ts";
import { parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";

const USAGE =
  "usage: build <ticket> [--spec <file>] [--cap <n>] [--base <branch>] [--agent-ms <n>] [--check-ms <n>] [--poll-ms <n>] [--silence-ms <n>] [--flat-ms <n>] [--progress-ms <n>] [--classify-ms <n>]";

/** A flag that holds a whole number of at least one, or the default when it is absent. */
function count(
  value: string | undefined,
  fallback: number,
): number | undefined {
  if (value === undefined) return fallback;
  return /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
}

registerVerb({
  name: "build",
  summary: "Build one ticket in its own worktree with fresh passes",
  run: async ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, {
      flags: [
        "spec",
        "cap",
        "base",
        "agent-ms",
        "check-ms",
        "poll-ms",
        "silence-ms",
        "flat-ms",
        "progress-ms",
        "classify-ms",
      ],
    });
    const [ticket, ...extra] = parsed.ok ? parsed.positional : [];
    if (!parsed.ok || ticket === undefined || extra.length > 0) {
      err(
        `werk: ${parsed.ok ? "build needs one ticket" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const { flags } = parsed;
    const cap = count(flags.cap, 5);
    const agentMs = count(flags["agent-ms"], 30 * 60_000);
    const checkMs = count(flags["check-ms"], 10 * 60_000);
    const pollMs = count(flags["poll-ms"], 1000);
    // The overseer's starting values (#lp-overseer-silence, #lp-overseer-inflight, #lp-overseer-progress).
    const silenceMs = count(flags["silence-ms"], 60_000);
    const flatMs = count(flags["flat-ms"], 60_000);
    const progressMs = count(flags["progress-ms"], 5 * 60_000);
    const classifyMs = count(flags["classify-ms"], 30_000);
    if (
      cap === undefined ||
      agentMs === undefined ||
      checkMs === undefined ||
      pollMs === undefined ||
      silenceMs === undefined ||
      flatMs === undefined ||
      progressMs === undefined ||
      classifyMs === undefined
    ) {
      err(`werk: every number flag is a whole number of at least 1\n${USAGE}`);
      return 2;
    }
    let spec: string | null = null;
    if (flags.spec !== undefined) {
      try {
        spec = readFileSync(resolve(cwd, flags.spec), "utf8");
      } catch {
        err(`werk: no spec file "${flags.spec}"\n${USAGE}`);
        return 2;
      }
    }
    try {
      const result = await buildTicket({
        ticket,
        cwd,
        env,
        mainLine: flags.base ?? "main",
        cap,
        agentMs,
        checkMs,
        pollMs,
        silenceMs,
        flatMs,
        progressMs,
        classifyMs,
        spec,
        command: "claude",
      });
      out(
        `${result.outcome} after ${result.passes} pass${result.passes === 1 ? "" : "es"} on branch ${result.branch}${result.reason ? `: ${result.reason}` : ""}`,
      );
      return result.outcome === "merging" ? 0 : 1;
    } catch (error) {
      err(
        `werk: ${error instanceof BuildRefused ? "refused: " : ""}${(error as Error).message}`,
      );
      return 1;
    }
  },
});
