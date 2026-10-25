/**
 * One classifier call: a short agent run with no tools and a time limit, for a question that needs
 * judgement (#lp-overseer-det). A run that fails or times out gives no answer.
 */
import type { LaunchOptions } from "../agent/launch-options.ts";
import { runProcess } from "../build/run-process.ts";
import { headlessArgs } from "../plan/agent-args.ts";
import { resultText } from "./verdicts.ts";

export type ClassifierSetup = {
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
  /** The launch options of the classifier role. */
  launch: LaunchOptions;
  timeoutMs: number;
};

export function classifier(setup: ClassifierSetup) {
  return async (prompt: string): Promise<string | null> => {
    const run = await runProcess({
      argv: [
        setup.command,
        ...headlessArgs({ options: setup.launch, tools: [], allow: [] }),
      ],
      cwd: setup.cwd,
      env: { ...setup.env, ...setup.launch.env },
      stdin: prompt,
      timeoutMs: setup.timeoutMs,
    });
    if (run.exitCode !== 0) return null;
    return resultText(run.stdout);
  };
}
