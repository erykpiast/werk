// The reader of a conversation's chat log (#werk-excerpt-chatlog) and the quote match over it
// (#werk-excerpt-once, #werk-excerpt-pointer). The file holds one JSON line per message; every
// line counts for the message position, and only a spoken line can hold a quote.
import { dirname, join } from "node:path";

/** The kinds of a chat log line. Only a spoken line is text that someone said. */
const CHAT_KINDS = ["spoken", "tool_call", "tool_result", "tooling"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

/** One line of a chat log. A line that is not a message is kept with no text, so it still counts. */
export type ChatLine = { speaker: string; at: string; session: string; kind: ChatKind | "unknown"; text: string };

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** The chat log of `conversation`, in the folder of the decision log, or undefined for a bad name. */
export function chatLogPath(decisionLog: string, conversation: string): string | undefined {
  return NAME.test(conversation) ? join(dirname(decisionLog), "chats", `${conversation}.jsonl`) : undefined;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

function readLine(line: string): ChatLine {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    value = undefined;
  }
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const kind = CHAT_KINDS.find((each) => each === record.kind) ?? "unknown";
  return {
    speaker: text(record.speaker),
    at: text(record.at),
    session: text(record.session),
    kind,
    text: text(record.text),
  };
}

/** The lines of a chat log, in order. The empty end after the last newline is not a line. */
export function readChat(content: string): ChatLine[] {
  if (content === "") return [];
  const raw = content.split("\n");
  if (raw.at(-1) === "") raw.pop();
  return raw.map(readLine);
}

export type QuoteMatch =
  | { ok: true; message: number; start: number; end: number; line: ChatLine }
  | { ok: false; reason: "no match" }
  | { ok: false; reason: "messages"; messages: number[] }
  | { ok: false; reason: "matches"; message: number; count: number };

/** Every start of `quote` in `text`, overlaps included: an overlap is a second place as well. */
function starts(text: string, quote: string): number[] {
  const out: number[] = [];
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) out.push(at);
  return out;
}

/** The one place of `quote` in a spoken line, or the case that keeps it from being one. */
export function matchQuote(lines: ChatLine[], quote: string): QuoteMatch {
  const hits: { message: number; at: number[] }[] = [];
  lines.forEach((line, message) => {
    if (line.kind !== "spoken" || quote === "") return;
    const at = starts(line.text, quote);
    if (at.length > 0) hits.push({ message, at });
  });
  const [only] = hits;
  if (only === undefined) return { ok: false, reason: "no match" };
  if (hits.length > 1) return { ok: false, reason: "messages", messages: hits.map((hit) => hit.message) };
  if (only.at.length > 1) return { ok: false, reason: "matches", message: only.message, count: only.at.length };
  const start = only.at[0] as number;
  return { ok: true, message: only.message, start, end: start + quote.length, line: lines[only.message] as ChatLine };
}

/** The refusal of a quote that is not exactly one place, in words that say which case it found. */
export function describeMiss(miss: Exclude<QuoteMatch, { ok: true }>, conversation: string): string {
  switch (miss.reason) {
    case "no match":
      return `no exact match of the text in a spoken message of conversation ${conversation}`;
    case "messages":
      return `the text occurs in ${miss.messages.length} messages (${miss.messages.join(", ")}); quote more of the sentence`;
    case "matches":
      return `the text occurs ${miss.count} times in message ${miss.message}; quote more of the sentence`;
  }
}
