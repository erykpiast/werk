// The script that the fake agent replays, and the lines it reads and prints
// (#werk-v0-seams-fake-script, #werk-test-fake-ask-open, #werk-chat-fake-role).
import { isAbsolute, relative, resolve } from "node:path";

/** One step of a reply, played in order. */
export type Step =
  /** One line of the agent's output stream. */
  | { event: unknown }
  /** A file written inside the project (#werk-test-fake-edit-inside). */
  | { edit: { path: string; content: string } }
  /** A permission request that stays open while the next steps play. */
  | { ask: { id?: string; tool: string; input?: unknown } }
  /** A silence of this many milliseconds, plus the margin. */
  | { pause: number }
  /** An exit with this code at once: no tool result and no final result. */
  | { crash: number };

export type Reply = Step[];

/** The replies of one role and the code its process exits with. */
export type RoleScript = { replies: Reply[]; exit: number };

/** The script of one temporary project: what each role plays (#st-build-seam-role-env). */
export type Script = { roles: Record<string, RoleScript> };

/** The variable that names the folder of a project's script and launch record. */
export const FAKE_DIR_VAR = "FAKE_AGENT_DIR";
/** The variable that carries the role of an agent launch. */
export const ROLE_VAR = "WERK_ROLE";
export const SCRIPT_FILE = "script.json";
export const LAUNCHES_FILE = "launches.jsonl";

/** One line of the launch record: a launch, or a message that a launch read. */
export type LaunchEntry =
  | { kind: "launch"; pid: number; args: string[]; role: string }
  | { kind: "message"; pid: number; message: unknown };

/** The role of a chat agent. It plays one reply per message and lives until its input closes. */
export const CHAT_ROLE = "chat";

/** Added to each pause, so a test never measures a silence shorter than the script asks for. */
export const PAUSE_MARGIN_MS = 20;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseStep(step: unknown, where: string): Step {
  if (!isObject(step) || Object.keys(step).length !== 1) throw new Error(`${where}: a step has exactly one key`);
  if ("event" in step) return { event: step.event };
  if ("edit" in step) {
    const edit = step.edit;
    if (!isObject(edit) || typeof edit.path !== "string" || typeof edit.content !== "string")
      throw new Error(`${where}: an edit needs a path and a content, both text`);
    return { edit: { path: edit.path, content: edit.content } };
  }
  if ("ask" in step) {
    const ask = step.ask;
    if (!isObject(ask) || typeof ask.tool !== "string") throw new Error(`${where}: an ask needs a tool name`);
    if (ask.id !== undefined && typeof ask.id !== "string") throw new Error(`${where}: an ask id is text`);
    return { ask: { id: ask.id, tool: ask.tool, input: ask.input ?? {} } };
  }
  if ("pause" in step) {
    if (typeof step.pause !== "number" || step.pause < 0)
      throw new Error(`${where}: a pause is a number of milliseconds`);
    return { pause: step.pause };
  }
  if ("crash" in step) {
    if (!Number.isInteger(step.crash)) throw new Error(`${where}: a crash is an exit code`);
    return { crash: step.crash as number };
  }
  throw new Error(`${where}: unknown step ${Object.keys(step)[0]}`);
}

/** Read a script from its JSON text. A script with a wrong shape throws, naming the place. */
export function parseScript(text: string): Script {
  const data: unknown = JSON.parse(text);
  if (!isObject(data) || !isObject(data.roles)) throw new Error("a script has a roles object");
  const roles: Record<string, RoleScript> = {};
  for (const [role, value] of Object.entries(data.roles)) {
    if (!isObject(value) || !Array.isArray(value.replies)) throw new Error(`role ${role}: needs a list of replies`);
    const exit = value.exit ?? 0;
    if (!Number.isInteger(exit)) throw new Error(`role ${role}: the exit is an exit code`);
    const replies = value.replies.map((reply, r) => {
      if (!Array.isArray(reply)) throw new Error(`role ${role}, reply ${r + 1}: a reply is a list of steps`);
      return reply.map((step, s) => parseStep(step, `role ${role}, reply ${r + 1}, step ${s + 1}`));
    });
    roles[role] = { replies, exit: exit as number };
  }
  return { roles };
}

/** The reply at `index` for `role`, or why there is none. The fake never invents a reply. */
export function pickReply(script: Script, role: string, index: number): { reply: Reply } | { error: string } {
  const own = script.roles[role];
  if (own === undefined) return { error: `the script has no replies for the role ${role || "(none)"}` };
  const reply = own.replies[index];
  if (reply === undefined) return { error: `the script has ${own.replies.length} replies for the role ${role}` };
  return { reply };
}

/** True when `path`, read from `root`, stays inside `root`. */
export function insideProject(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(root, path));
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}

/** True when the launch reads its messages from an input stream, not from its arguments. */
export function hasInputChannel(args: string[]): boolean {
  const at = args.indexOf("--input-format");
  return at >= 0 && args[at + 1] === "stream-json";
}

/** What one line of input holds: a message, an answer to an open ask, or nothing the fake reads. */
export type Input = { kind: "message"; message: unknown } | { kind: "answer"; requestId: string } | { kind: "other" };

export function parseInput(line: string): Input {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return { kind: "other" };
  }
  if (!isObject(data)) return { kind: "other" };
  if (data.type === "user") return { kind: "message", message: data };
  if (data.type === "control_response" && isObject(data.response) && typeof data.response.request_id === "string")
    return { kind: "answer", requestId: data.response.request_id };
  return { kind: "other" };
}

/** The permission request an ask step prints. */
export function askEvent(requestId: string, tool: string, input: unknown): unknown {
  return {
    type: "control_request",
    request_id: requestId,
    request: { subtype: "can_use_tool", tool_name: tool, input, tool_use_id: `tool-${requestId}` },
  };
}

/** The final result of a turn, printed once every ask of the turn is answered or denied. */
export function resultEvent(denied: string[]): unknown {
  return { type: "result", subtype: "success", is_error: false, result: "", denied_requests: denied };
}
