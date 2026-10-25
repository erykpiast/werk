/**
 * The pure side of an approval ask: reading the CLI's control request, writing the answer, and
 * turning the CLI's own suggestions into labels and launch flags. werk keeps no classifier and no
 * rule matcher; a suggestion is stored and passed on as the CLI sent it (#werk-perm-native,
 * #werk-approve, #werk-mc-askqa).
 */

/** One permission update, as the CLI sent it. */
export type Update = Record<string, unknown>;

export type Question = {
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: { label: string; description: string }[];
};

export type Ask = {
  id: string;
  tool: string;
  input: unknown;
  /** The CLI's reason, as it sent it. Null when it sent none. */
  reason: string | null;
  suggestions: Update[];
  /** The questions of a question tool call. Null for any other call. */
  questions: Question[] | null;
};

/** What the person chose. */
export type Answer =
  | { decision: "allow" | "always" | "deny" | "decline" }
  | { decision: "answer"; picks: string[][] };

/** The decision that the ask log records (#werk-approve-log). */
export type Logged = "allow" | "always" | "deny";

export const QUESTION_TOOL = "AskUserQuestion";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

function questionsOf(input: unknown): Question[] | null {
  const list = isObject(input) ? input.questions : null;
  if (!Array.isArray(list)) return null;
  const questions: Question[] = [];
  for (const raw of list) {
    if (!isObject(raw) || text(raw.question) === "") return null;
    const options = (Array.isArray(raw.options) ? raw.options : [])
      .filter(isObject)
      .map((o) => ({ label: text(o.label), description: text(o.description) }))
      .filter((o) => o.label !== "");
    questions.push({
      question: text(raw.question),
      header: text(raw.header) === "" ? null : text(raw.header),
      multiSelect: raw.multiSelect === true,
      options,
    });
  }
  return questions.length === 0 ? null : questions;
}

function reasonOf(request: Json): string | null {
  const reason = request.decision_reason;
  if (typeof reason === "string") return reason === "" ? null : reason;
  return isObject(reason) ? JSON.stringify(reason) : null;
}

/** Reads one line of the child's output. Returns null unless it is a can_use_tool request. */
export function parseAsk(event: unknown): Ask | null {
  if (!isObject(event) || event.type !== "control_request") return null;
  const request = event.request;
  if (
    !isObject(request) ||
    request.subtype !== "can_use_tool" ||
    typeof event.request_id !== "string"
  ) {
    return null;
  }
  const tool = text(request.tool_name);
  return {
    id: event.request_id,
    tool,
    input: request.input ?? {},
    reason: reasonOf(request),
    suggestions: Array.isArray(request.permission_suggestions)
      ? request.permission_suggestions.filter(isObject)
      : [],
    questions: tool === QUESTION_TOOL ? questionsOf(request.input) : null,
  };
}

function ruleText(rule: unknown): string | null {
  if (!isObject(rule) || text(rule.toolName) === "") return null;
  const content = text(rule.ruleContent);
  return content === "" ? text(rule.toolName) : `${rule.toolName}(${content})`;
}

function directories(update: Update): string[] {
  return Array.isArray(update.directories)
    ? update.directories.filter((d): d is string => typeof d === "string")
    : [];
}

/** The rules and directories that the updates would allow, each as one short text. */
export function suggestionLabels(updates: readonly Update[]): string[] {
  return updates.flatMap((update) => {
    if (update.type === "addRules") {
      const rules = Array.isArray(update.rules) ? update.rules : [];
      return rules.flatMap((r) => ruleText(r) ?? []);
    }
    if (update.type === "addDirectories") return directories(update);
    return [text(update.type) || "update"];
  });
}

/** The launch flags that stored updates give the next child: allowed tools and added directories. */
export function allowFlags(updates: readonly Update[]): {
  tools: string[];
  dirs: string[];
} {
  const tools: string[] = [];
  const dirs: string[] = [];
  for (const update of updates) {
    if (update.type === "addDirectories") dirs.push(...directories(update));
    if (update.type === "addRules" && update.behavior === "allow") {
      const rules = Array.isArray(update.rules) ? update.rules : [];
      for (const rule of rules) {
        const named = ruleText(rule);
        if (named !== null) tools.push(named);
      }
    }
  }
  return { tools: [...new Set(tools)], dirs: [...new Set(dirs)] };
}

/** The text a question answer gives the model: one line per question. */
export function answerText(
  questions: readonly Question[],
  picks: readonly (readonly string[])[],
): string {
  return questions
    .map((q, i) => `For "${q.question}": ${(picks[i] ?? []).join(", ")}`)
    .join("\n");
}

/** True when each question has at least one pick. */
export function picksFit(
  questions: readonly Question[],
  picks: unknown,
): picks is string[][] {
  return (
    Array.isArray(picks) &&
    picks.length === questions.length &&
    picks.every(
      (p) =>
        Array.isArray(p) &&
        p.length > 0 &&
        p.every((x) => typeof x === "string" && x.trim() !== ""),
    )
  );
}

/** The short text that names a call in the ask log. */
export function callLabel(tool: string, input: unknown): string {
  let value = "";
  if (isObject(input)) {
    for (const key of ["command", "file_path", "pattern", "path", "url"]) {
      if (typeof input[key] === "string") {
        value = input[key];
        break;
      }
    }
    if (value === "") value = JSON.stringify(input);
  }
  const flat = value.replace(/\s+/g, " ").trim();
  const brief = flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
  return brief === "" ? tool : `${tool} ${brief}`;
}

export type Reply =
  | { ok: true; line: string; logged: Logged; widened: string[] }
  | { ok: false; message: string };

export function controlLine(request: string, response: Json): string {
  return `${JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: request, response },
  })}\n`;
}

/**
 * The control_response for an answer. An allow returns the call as it came, so a call is never
 * edited. A question answer travels as the message of a refusal, and the log records it as an
 * allow because a picked answer is a normal reply (#werk-mc-askqa).
 */
export function reply(ask: Ask, answer: Answer): Reply {
  switch (answer.decision) {
    case "allow":
      if (ask.questions !== null) {
        return { ok: false, message: "a question is answered with its picks" };
      }
      return {
        ok: true,
        line: controlLine(ask.id, {
          behavior: "allow",
          updatedInput: ask.input,
        }),
        logged: "allow",
        widened: [],
      };
    case "always": {
      const widened = suggestionLabels(ask.suggestions);
      if (widened.length === 0) {
        return { ok: false, message: "the call has no suggestion to allow" };
      }
      return {
        ok: true,
        line: controlLine(ask.id, {
          behavior: "allow",
          updatedInput: ask.input,
          updatedPermissions: ask.suggestions,
        }),
        logged: "always",
        widened,
      };
    }
    case "deny":
    case "decline":
      return {
        ok: true,
        line: controlLine(ask.id, {
          behavior: "deny",
          message:
            answer.decision === "deny"
              ? "The person denied this tool call."
              : "The person declined to answer the question.",
        }),
        logged: "deny",
        widened: [],
      };
    case "answer": {
      if (ask.questions === null || !picksFit(ask.questions, answer.picks)) {
        return { ok: false, message: "pick an answer for each question" };
      }
      return {
        ok: true,
        line: controlLine(ask.id, {
          behavior: "deny",
          message: answerText(ask.questions, answer.picks),
        }),
        logged: "allow",
        widened: [],
      };
    }
  }
}

/** Reads the body of an answer request. Returns null for a body that names no answer. */
export function parseAnswer(body: unknown): Answer | null {
  if (!isObject(body)) return null;
  const { decision } = body;
  if (
    decision === "allow" ||
    decision === "always" ||
    decision === "deny" ||
    decision === "decline"
  ) {
    return { decision };
  }
  if (decision === "answer" && Array.isArray(body.picks)) {
    return { decision, picks: body.picks as string[][] };
  }
  return null;
}
