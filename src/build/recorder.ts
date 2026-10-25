/** Writes the steps of one build to the pipeline log, with their time and cost (#ms-store, #ms-cost). */

import type { Cause, Result, Step } from "../pipeline/fold.ts";
import { appendPipelineEvent } from "../pipeline/log-store.ts";
import { type Cost, NO_COST } from "./stream-cost.ts";

export type EndInfo = {
  cost?: Cost;
  gate?: string;
  cause?: Cause;
  reason?: string;
  /** The detail file of the step, relative to the folder of the log (#ms-store-files). */
  file?: string;
};

export type Recorder = {
  /** Writes the start of a step. The returned function writes its end. */
  start(
    pass: number,
    step: Step,
    name: string,
  ): (result: Result, info?: EndInfo) => void;
};

export function createRecorder(
  logPath: string,
  build: string,
  ticket: string,
): Recorder {
  const write = (event: Record<string, unknown>) => {
    const result = appendPipelineEvent(logPath, event);
    if (!result.ok) throw new Error(`pipeline log: ${result.detail}`);
  };
  return {
    start(pass, step, name) {
      const id = `${build}:p${pass}:${name}`;
      const began = performance.now();
      const base = { id, build, ticket, pass, step };
      write({
        type: "step.started",
        ...base,
        at: new Date().toISOString(),
      });
      return (result, info = {}) =>
        write({
          type: "step.ended",
          ...base,
          at: new Date().toISOString(),
          result,
          ms: Math.round(performance.now() - began),
          cost: info.cost ?? NO_COST,
          ...(info.gate === undefined ? {} : { gate: info.gate }),
          ...(info.cause === undefined ? {} : { cause: info.cause }),
          ...(info.reason === undefined ? {} : { reason: info.reason }),
          ...(info.file === undefined ? {} : { file: info.file }),
        });
    },
  };
}
