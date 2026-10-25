/**
 * The questions the overseer puts to a classifier agent and the reading of its answers
 * (#lp-overseer-asks, #lp-overseer-progress). A reply that does not read is no verdict. Pure.
 */
import { callLabel } from "../chat/permission.ts";

export type AskVerdict = { allow: boolean; comment: string };
export type LoopVerdict = { looping: boolean; reason: string };

const obj = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The first JSON object in a text: from its first brace to its last. */
function jsonOf(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  if (from < 0 || to <= from) return null;
  try {
    const value: unknown = JSON.parse(text.slice(from, to + 1));
    return obj(value) ? value : null;
  } catch {
    return null;
  }
}

const textOf = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export function parseAskVerdict(text: string | null): AskVerdict | null {
  const data = jsonOf(text);
  if (data === null) return null;
  const verdict = textOf(data.verdict).toLowerCase();
  if (verdict !== "allow" && verdict !== "deny") return null;
  return { allow: verdict === "allow", comment: textOf(data.comment) };
}

export function parseLoopVerdict(text: string | null): LoopVerdict | null {
  const data = jsonOf(text);
  if (data === null) return null;
  const verdict = textOf(data.verdict).toLowerCase();
  if (verdict !== "looping" && verdict !== "not looping") return null;
  return { looping: verdict === "looping", reason: textOf(data.reason) };
}

/** The text of the last result event in a stream of lines, or null. */
export function resultText(stream: string): string | null {
  const lines = stream.split("\n").reverse();
  for (const line of lines) {
    if (!line.includes('"result"')) continue;
    try {
      const event: unknown = JSON.parse(line);
      if (obj(event) && event.type === "result") {
        return typeof event.result === "string" ? event.result : null;
      }
    } catch {
      // A line that is not JSON is not a result.
    }
  }
  return null;
}

export function askPrompt(
  ask: { tool: string; input: unknown },
  ticket: string,
): string {
  return [
    `Classify one permission ask. Tool: ${ask.tool}.`,
    "A builder agent asks to run a tool call while it builds the ticket below. Say whether the call makes sense for that ticket. Deny a call that looks wrong: it reaches outside the project, destroys work, leaks a secret, or has nothing to do with the ticket.",
    `Call: ${callLabel(ask.tool, ask.input)}`,
    `Input: ${JSON.stringify(ask.input)}`,
    `## Ticket\n\n${ticket.trim()}`,
    'Answer with one JSON object and nothing else: {"verdict":"allow"|"deny","comment":"one sentence that says why"}.',
  ].join("\n");
}

export function loopPrompt(brief: string, calls: readonly string[]): string {
  return [
    "Classify the progress of one agent. Say whether the agent is looping.",
    "An agent loops when it repeats the same tool call, or the same failing check, and makes no progress. Work that moves forward in small steps is not a loop.",
    `## Brief\n\n${brief.trim()}`,
    `## Tool calls since the last verdict\n\n${calls.map((call) => `- ${call}`).join("\n")}`,
    'Answer with one JSON object and nothing else: {"verdict":"looping"|"not looping","reason":"one or two sentences"}.',
  ].join("\n");
}
