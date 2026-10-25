import { readFileSync } from "node:fs";
import { resolveEdit, writeEdit } from "./edit.ts";
import { appendRecord, countLaunches, logPathFor } from "./launch-log.ts";
import { LineReader } from "./lines.ts";
import {
  isChatRole,
  type Pick,
  parseScript,
  pickReply,
  type Reply,
  type Script,
} from "./script.ts";

/** The variable that holds the path of the script of the temporary project. */
export const SCRIPT_VAR = "WERK_FAKE_SCRIPT";
/** The variable that holds the role name of the launch. */
export const ROLE_VAR = "WERK_AGENT_ROLE";

/** Added to each scripted pause, so a test never measures a silence shorter than the script asks for. */
const PAUSE_MARGIN_MS = 20;

export type RunContext = {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  /** The input channel. Null when the launch has none. */
  input: ReadableStream<Uint8Array> | null;
  out: (line: string) => void;
  err: (line: string) => void;
};

const EXIT_NO_SCRIPT = 2;
const EXIT_BAD_REPLY = 1;

function isControlResponse(line: string): boolean {
  try {
    return JSON.parse(line)?.type === "control_response";
  } catch {
    return false;
  }
}

function answerOf(line: string): { id: string; allow: boolean } | null {
  try {
    const response = JSON.parse(line)?.response;
    if (typeof response?.request_id !== "string") return null;
    return {
      id: response.request_id,
      allow: response.response?.behavior === "allow",
    };
  } catch {
    return null;
  }
}

/** The text of one user message line. */
function messageText(line: string): string {
  try {
    const content = JSON.parse(line)?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("");
    }
  } catch {
    // A line that is not JSON is taken as plain text.
  }
  return line;
}

function toolResult(id: string, allowed: boolean): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: allowed ? "allowed" : "denied",
          is_error: !allowed,
        },
      ],
    },
  });
}

/** Plays one reply. Returns a crash code, or null when the reply ended with its final result. */
async function playReply(
  ctx: RunContext,
  reader: LineReader,
  reply: Reply,
): Promise<number | null> {
  const open = new Set<string>();
  // A scripted result line is the end of the reply, with the duration and cost the script gives it.
  let ended = false;
  for (const step of reply) {
    if ("event" in step) {
      if (step.event.type === "result") ended = true;
      ctx.out(JSON.stringify(step.event));
    } else if ("edit" in step) {
      const target = resolveEdit(ctx.cwd, step.edit);
      if (target) writeEdit(target, step.content);
    } else if ("pause" in step) {
      await new Promise((done) =>
        setTimeout(done, step.pause + PAUSE_MARGIN_MS),
      );
    } else if ("ask" in step) {
      open.add(step.ask.id);
      ctx.out(
        JSON.stringify({
          type: "control_request",
          request_id: step.ask.id,
          request: {
            subtype: "can_use_tool",
            tool_name: step.ask.tool,
            input: step.ask.input ?? {},
          },
        }),
      );
    } else {
      return step.crash;
    }
  }
  while (open.size > 0) {
    const line = await reader.nextWhere(isControlResponse);
    if (line === null) break;
    const answer = answerOf(line);
    if (answer && open.delete(answer.id))
      ctx.out(toolResult(answer.id, answer.allow));
  }
  // The input is closed: each ask that is still open is denied.
  for (const id of open) ctx.out(toolResult(id, false));
  if (!ended) {
    ctx.out(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
      }),
    );
  }
  return null;
}

/** The first path of the reply that leads outside the folder, or null. */
function escapingEdit(cwd: string, reply: Reply): string | null {
  for (const step of reply) {
    if ("edit" in step && resolveEdit(cwd, step.edit) === null)
      return step.edit;
  }
  return null;
}

/**
 * Plays one scripted reply and returns the failure text for a reply that
 * cannot play, before any step of it ran.
 */
async function turn(
  ctx: RunContext,
  reader: LineReader,
  picked: Pick,
): Promise<number | string> {
  if ("error" in picked) return picked.error;
  const bad = escapingEdit(ctx.cwd, picked.reply);
  if (bad !== null)
    return `fake agent: edit path ${bad} leads outside ${ctx.cwd}`;
  const crash = await playReply(ctx, reader, picked.reply);
  return crash ?? picked.exit;
}

/** Runs one launch of the fake agent. Returns the exit code. */
export async function run(ctx: RunContext): Promise<number> {
  const scriptPath = ctx.env[SCRIPT_VAR];
  const role = ctx.env[ROLE_VAR];
  if (!scriptPath) {
    ctx.err(`fake agent: no script installed (${SCRIPT_VAR} is not set)`);
    return EXIT_NO_SCRIPT;
  }
  if (!role) {
    ctx.err(`fake agent: the launch has no role (${ROLE_VAR} is not set)`);
    return EXIT_NO_SCRIPT;
  }
  let script: Script;
  try {
    script = parseScript(readFileSync(scriptPath, "utf8"));
  } catch (error) {
    ctx.err(
      `fake agent: cannot use the script ${scriptPath}: ${(error as Error).message}`,
    );
    return EXIT_NO_SCRIPT;
  }

  const log = logPathFor(scriptPath);
  appendRecord(log, { kind: "launch", role, args: ctx.argv, cwd: ctx.cwd });
  const reader = new LineReader(ctx.input);
  const fail = (text: string) => {
    ctx.err(text);
    return EXIT_BAD_REPLY;
  };

  if (isChatRole(role)) {
    const exit = script.roles[role]?.exit ?? 0;
    for (let n = 0; ; n++) {
      const line = await reader.nextWhere((l) => !isControlResponse(l));
      if (line === null) return exit;
      appendRecord(log, { kind: "message", role, text: messageText(line) });
      const result = await turn(ctx, reader, pickReply(script, role, n));
      if (typeof result === "string") return fail(result);
      if (result !== exit) return result;
    }
  }

  const picked = pickReply(script, role, countLaunches(log, role) - 1);
  const first =
    "error" in picked
      ? null
      : await reader.nextWhere((l) => !isControlResponse(l));
  if (first !== null)
    appendRecord(log, { kind: "message", role, text: messageText(first) });
  const result = await turn(ctx, reader, picked);
  return typeof result === "string" ? fail(result) : result;
}
