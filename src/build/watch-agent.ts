/**
 * The overseer of one builder session, joined to its live child: it reads the stream line by line,
 * writes the stream and each overseer act to the session log, and ends the input once the agent has
 * its result (#lp-overseer-mechanics, #lp-overseer-silence-tokens).
 */
import { appendFileSync } from "node:fs";
import {
  type Context,
  createOverseer,
  type Limits,
} from "../overseer/overseer.ts";
import { probeChildren } from "../overseer/probe.ts";
import type { ProcessControl } from "./run-process.ts";

export type WatchSetup = {
  limits: Limits;
  context: Context;
  /** The session log. */
  transcript: string;
  classify: (prompt: string) => Promise<string | null>;
};

export function watchAgent(setup: WatchSetup) {
  const { transcript } = setup;
  let control: ProcessControl | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending = "";
  const overseer = createOverseer(
    setup.limits,
    {
      now: Date.now,
      cancel: (reason) => control?.stop(reason),
      killProcesses: (pids) => {
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // The process is already gone.
          }
        }
      },
      reply: (line) => control?.write(line),
      note: (act, text) =>
        appendFileSync(
          transcript,
          `${JSON.stringify({ at: new Date().toISOString(), event: { type: "werk_overseer", act, text } })}\n`,
        ),
      classify: setup.classify,
      probe: () =>
        control === null
          ? Promise.resolve({ ok: false, why: "the agent has not started" })
          : probeChildren(control.pid),
    },
    setup.context,
  );

  const take = (line: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Text that is not an event stays in the log and is no sign of life.
    }
    const type = (parsed as { type?: unknown } | null)?.type;
    // A partial message only keeps the silence clock armed. It is not logged.
    if (type === "stream_event") return overseer.partial();
    appendFileSync(transcript, `${line}\n`);
    if (parsed === undefined) return;
    overseer.event(parsed);
    if (type === "result") control?.close();
  };

  // The tick is a fraction of the shortest limit, so a limit of milliseconds is still read in time.
  const { silenceMs, flatMs, sampleMs } = setup.limits;
  const tickMs = Math.max(
    10,
    Math.min(250, Math.floor(Math.min(silenceMs, flatMs, sampleMs) / 4)),
  );
  return {
    control(handle: ProcessControl) {
      control = handle;
      timer = setInterval(() => void overseer.tick(), tickMs);
    },
    onStdout(chunk: string) {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() as string;
      for (const line of lines) if (line.trim() !== "") take(line);
    },
    end() {
      if (pending.trim() !== "") take(pending);
      pending = "";
      clearInterval(timer);
      overseer.stop();
    },
  };
}
