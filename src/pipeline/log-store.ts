/** Reads and appends the pipeline log of one project, beside the map log (#ms-store). */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseLog } from "../map/fold.ts";
import { logPathFor as mapLogPath } from "../map/log-store.ts";
import { checkPipelineEvent, foldPipeline, type Pipeline } from "./fold.ts";

type Env = Record<string, string | undefined>;

const LOG_NAME = "pipeline.jsonl";
const FILES_DIR = "pipeline-files";

/** The pipeline log that sits in the folder of a map log. */
export function pipelineLogBeside(mapLog: string): string {
  return join(dirname(mapLog), LOG_NAME);
}

/** The pipeline log of the project. */
export function pipelineLogPathFor(cwd: string, env: Env): string {
  return pipelineLogBeside(mapLogPath(cwd, env));
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function readPipeline(path: string): Pipeline {
  return foldPipeline(parseLog(readText(path)));
}

export type PipelineAppendResult = { ok: true } | { ok: false; detail: string };

/** Checks the event, then appends it. A refused event leaves the log as it was. */
export function appendPipelineEvent(
  path: string,
  event: unknown,
): PipelineAppendResult {
  const detail = checkPipelineEvent(event);
  if (detail !== null) return { ok: false, detail };
  const text = readText(path);
  const lead = text === "" || text.endsWith("\n") ? "" : "\n";
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${lead}${JSON.stringify(event)}\n`);
  return { ok: true };
}

/**
 * Writes one detail file beside the log: a transcript or the full output of a check.
 * The folder holds its own ignore rule, so git never tracks it, in any project (#ms-store-git).
 * Returns the name that the step's ended event holds, relative to the folder of the log (#ms-store-files).
 */
export function writeDetailFile(
  path: string,
  stepId: string,
  extension: string,
  text: string,
): string {
  const dir = join(dirname(path), FILES_DIR);
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  const safe = stepId.replace(/[^A-Za-z0-9._-]/g, "_");
  const name = `${FILES_DIR}/${safe}.${extension}`;
  writeFileSync(join(dirname(path), name), text);
  return name;
}
