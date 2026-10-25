/**
 * The quote matcher: finds a text once among the spoken messages of a chat log.
 * See #werk-excerpt, #werk-excerpt-once, #werk-excerpt-pointer and #werk-excerpt-chatlog.
 */

/** A conversation name: letters, digits, dots, dashes and underscores, never a leading dot. */
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function isConversationName(name: string): boolean {
  return NAME.test(name);
}

/** One spoken message, with its place among all the lines of the chat log. */
export type Spoken = {
  position: number;
  speaker: string;
  at: string;
  session: string;
  text: string;
};

/** The spoken messages of a chat log. Every line counts for the position; only a spoken line is returned. */
export function spokenMessages(log: string): Spoken[] {
  const lines = log.split("\n");
  // The newline that ends the last line does not start another line.
  if (lines[lines.length - 1] === "") lines.pop();
  const spoken: Spoken[] = [];
  lines.forEach((raw, position) => {
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof line !== "object" || line === null || Array.isArray(line))
      return;
    const fields = line as Record<string, unknown>;
    if (fields.kind !== "spoken") return;
    const text = (key: string) =>
      typeof fields[key] === "string" ? (fields[key] as string) : "";
    spoken.push({
      position,
      speaker: text("speaker"),
      at: text("at"),
      session: text("session"),
      text: text("text"),
    });
  });
  return spoken;
}

/** Every start of `words` in `text`, counting each place where it begins, even inside another match. */
function occurrences(text: string, words: string): number[] {
  const starts: number[] = [];
  for (
    let at = text.indexOf(words);
    at !== -1;
    at = text.indexOf(words, at + 1)
  ) {
    starts.push(at);
  }
  return starts;
}

export type QuoteMatch =
  | { ok: true; message: Spoken; start: number; end: number }
  | { ok: false; reason: string };

/** The one occurrence of `words`, or the reason there is not exactly one. */
export function matchQuote(
  messages: readonly Spoken[],
  words: string,
): QuoteMatch {
  if (words === "") return { ok: false, reason: "the text to quote is empty" };
  const hits = messages
    .map((message) => ({ message, starts: occurrences(message.text, words) }))
    .filter(({ starts }) => starts.length > 0);
  if (hits.length === 0) {
    return { ok: false, reason: "no match in a spoken message" };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      reason: `a match in ${hits.length} messages; quote more of the sentence`,
    };
  }
  const [{ message, starts }] = hits as [(typeof hits)[number]];
  if (starts.length > 1) {
    return {
      ok: false,
      reason: `${starts.length} matches in one message; quote more of the sentence`,
    };
  }
  const start = starts[0] as number;
  return { ok: true, message, start, end: start + words.length };
}

/** The parts of the pointer that the matched message lacks, in the order the pointer names them. */
export function missingParts(message: Spoken): string[] {
  const parts: [string, string][] = [
    ["session", message.session],
    ["speaker", message.speaker],
    ["time", message.at],
  ];
  return parts.filter(([, value]) => value === "").map(([name]) => name);
}
