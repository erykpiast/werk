/**
 * The live preview of a session log: one summarised line per stream event, with its full time
 * (#vi-board-details, #vi-board-session-file-line-shape). Pure.
 */

export type LogLine = { time: string; text: string };

/** How many events the preview shows (#vi-board-session-file-line-shape). */
export const PREVIEW_EVENTS = 200;

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const oneLine = (text: string, max = 160): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function toolInput(input: unknown): string {
  if (!isRecord(input)) return "";
  for (const key of ["command", "file_path", "pattern", "path", "url"]) {
    const value = input[key];
    if (typeof value === "string") return ` ${oneLine(value, 100)}`;
  }
  return "";
}

function blockText(block: unknown): string | null {
  if (!isRecord(block)) return null;
  switch (block.type) {
    case "text":
      return typeof block.text === "string" ? oneLine(block.text) : null;
    case "thinking":
      return "thinking";
    case "tool_use":
      return `tool ${String(block.name ?? "?")}${toolInput(block.input)}`;
    case "tool_result": {
      const content = block.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((c) =>
                  isRecord(c) && typeof c.text === "string" ? c.text : "",
                )
                .join(" ")
            : "";
      return `${block.is_error === true ? "tool error" : "tool result"}${text === "" ? "" : `: ${oneLine(text, 100)}`}`;
    }
    default:
      return null;
  }
}

/** One line for one stream event, or null when the event says nothing a person reads. */
export function summariseEvent(event: unknown): string | null {
  if (!isRecord(event)) return null;
  switch (event.type) {
    case "system":
      return typeof event.subtype === "string"
        ? `system ${event.subtype}`
        : "system";
    case "assistant":
    case "user": {
      const message = event.message;
      const content = isRecord(message) ? message.content : undefined;
      const blocks =
        typeof content === "string"
          ? [{ type: "text", text: content }]
          : Array.isArray(content)
            ? content
            : [];
      const parts = blocks
        .map(blockText)
        .filter((part): part is string => part !== null);
      if (parts.length === 0) return null;
      return `${event.type === "assistant" ? "agent" : "user"}: ${parts.join(" · ")}`;
    }
    case "result":
      return `result ${String(event.subtype ?? (event.is_error === true ? "error" : "done"))}`;
    case "overseer": {
      const note = [
        event.text,
        event.message,
        event.verdict,
        event.reason,
      ].find((v): v is string => typeof v === "string");
      return `overseer${note === undefined ? "" : `: ${oneLine(note)}`}`;
    }
    case "werk_overseer": {
      const act = typeof event.act === "string" ? event.act : "act";
      return `overseer ${act}${typeof event.text === "string" ? `: ${oneLine(event.text)}` : ""}`;
    }
    default:
      return typeof event.type === "string" ? event.type : null;
  }
}

/** The full time of an event: the date and the time to the second, as written. */
export function fullTime(at: string): string {
  return at.replace("T", " ").replace(/(\.\d+)?(Z|[+-]\d\d:?\d\d)?$/, "");
}

/**
 * The last events of a session log, oldest first. A line that is not an object with a time and an
 * event is skipped.
 */
export function previewOf(text: string, limit = PREVIEW_EVENTS): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || typeof parsed.at !== "string") continue;
    if (!("event" in parsed)) continue;
    const summary = summariseEvent(parsed.event);
    if (summary === null) continue;
    lines.push({ time: fullTime(parsed.at), text: summary });
  }
  return lines.slice(-limit);
}
