/**
 * Turns the lines of the agent's output into the parts of a reply: finished blocks, tokens that
 * stream, a status, and the end line (#werk-progress). A finished block takes the place of the
 * block it streamed as, by the order of the blocks of its message and not by the array index
 * (#werk-blockid).
 */

export type Block =
  | { kind: "text" | "thinking"; text: string }
  | { kind: "tool_use"; name: string; input: unknown; toolUseId: string }
  | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean };

type StreamKind = "text" | "thinking" | "tool_use";

export type Part =
  | {
      type: "delta";
      id: string;
      kind: StreamKind;
      name?: string;
      toolUseId?: string;
      text: string;
    }
  | { type: "chat"; id: string; block: Block }
  | {
      type: "status";
      state: "thinking" | "running";
      tool: string | null;
      tokens: number;
    }
  | {
      type: "end";
      durationMs: number | null;
      costUsd: number | null;
      error: boolean;
    };

type Opened = { index: number; kind: StreamKind; claimed: boolean };

export type ReplyState = {
  messageId: string | null;
  /** The blocks that the current message opened while it streamed, in order. */
  opened: Opened[];
  /** The count of messages seen, for a message that carries no id. */
  messages: number;
  /** Output tokens of the messages of this reply that finished. */
  tokensDone: number;
  /** Output tokens of the message that streams now. */
  tokensNow: number;
};

export const initialReply: ReplyState = {
  messageId: null,
  opened: [],
  messages: 0,
  tokensDone: 0,
  tokensNow: 0,
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function kindOf(type: unknown): StreamKind | null {
  return type === "text" || type === "thinking" || type === "tool_use"
    ? type
    : null;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isObject(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

function status(state: ReplyState, tool: string | null): Part {
  return {
    type: "status",
    state: tool === null ? "thinking" : "running",
    tool,
    tokens: state.tokensDone + state.tokensNow,
  };
}

/** Starts a message when its id differs from the current one. */
function enter(state: ReplyState, id: unknown): ReplyState {
  const named = typeof id === "string" ? id : null;
  if (
    state.messageId !== null &&
    (named === null || named === state.messageId)
  ) {
    return state;
  }
  const messages = state.messages + 1;
  return {
    ...state,
    messageId: named ?? `m${messages}`,
    opened: [],
    messages,
    tokensDone: state.tokensDone + state.tokensNow,
    tokensNow: 0,
  };
}

function streamEvent(state: ReplyState, event: Json): [ReplyState, Part[]] {
  switch (event.type) {
    case "message_start": {
      const message = isObject(event.message) ? event.message : {};
      return [enter({ ...state, messageId: null }, message.id), []];
    }
    case "content_block_start": {
      const block = isObject(event.content_block) ? event.content_block : {};
      const kind = kindOf(block.type);
      if (kind === null || typeof event.index !== "number") return [state, []];
      const next = enter(state, null);
      const opened = [
        ...next.opened,
        { index: event.index, kind, claimed: false },
      ];
      const tool = kind === "tool_use" ? String(block.name ?? "") : null;
      const delta: Part = {
        type: "delta",
        id: `${next.messageId}:${event.index}`,
        kind,
        text: "",
        ...(tool === null
          ? {}
          : { name: tool, toolUseId: String(block.id ?? "") }),
      };
      return [{ ...next, opened }, [delta, status(next, tool)]];
    }
    case "content_block_delta": {
      const delta = isObject(event.delta) ? event.delta : {};
      const opened = state.opened.find((o) => o.index === event.index);
      if (!opened) return [state, []];
      const text =
        delta.type === "text_delta"
          ? delta.text
          : delta.type === "thinking_delta"
            ? delta.thinking
            : delta.type === "input_json_delta"
              ? delta.partial_json
              : null;
      if (typeof text !== "string" || text === "") return [state, []];
      return [
        state,
        [
          {
            type: "delta",
            id: `${state.messageId}:${opened.index}`,
            kind: opened.kind,
            text,
          },
        ],
      ];
    }
    case "message_delta": {
      const usage = isObject(event.usage) ? event.usage : {};
      if (typeof usage.output_tokens !== "number") return [state, []];
      const next = { ...state, tokensNow: usage.output_tokens };
      return [next, [status(next, null)]];
    }
    default:
      return [state, []];
  }
}

function finishedBlock(block: Json): Block | null {
  if (block.type === "text" || block.type === "thinking") {
    const text = block.type === "text" ? block.text : block.thinking;
    return { kind: block.type, text: typeof text === "string" ? text : "" };
  }
  if (block.type === "tool_use") {
    return {
      kind: "tool_use",
      name: String(block.name ?? ""),
      input: block.input ?? {},
      toolUseId: String(block.id ?? ""),
    };
  }
  return null;
}

function assistantEvent(state: ReplyState, event: Json): [ReplyState, Part[]] {
  const message = isObject(event.message) ? event.message : {};
  let next = enter(state, message.id);
  const content = Array.isArray(message.content) ? message.content : [];
  const parts: Part[] = [];
  for (const raw of content) {
    const block = isObject(raw) ? finishedBlock(raw) : null;
    const kind = block === null ? null : kindOf(block.kind);
    if (block === null || kind === null) continue;
    // Each event holds one block at array index 0, so the block claims the first
    // unclaimed block of its own kind that the stream opened.
    const open = next.opened.find((o) => !o.claimed && o.kind === kind);
    const index =
      open?.index ?? Math.max(-1, ...next.opened.map((o) => o.index)) + 1;
    next = {
      ...next,
      opened: open
        ? next.opened.map((o) => (o === open ? { ...o, claimed: true } : o))
        : [...next.opened, { index, kind, claimed: true }],
    };
    parts.push({ type: "chat", id: `${next.messageId}:${index}`, block });
  }
  return [next, parts];
}

function userEvent(state: ReplyState, event: Json): [ReplyState, Part[]] {
  const message = isObject(event.message) ? event.message : {};
  const content = Array.isArray(message.content) ? message.content : [];
  const parts: Part[] = [];
  for (const raw of content) {
    if (!isObject(raw) || raw.type !== "tool_result") continue;
    const toolUseId = String(raw.tool_use_id ?? "");
    parts.push({
      type: "chat",
      id: `result:${toolUseId}`,
      block: {
        kind: "tool_result",
        toolUseId,
        text: textOf(raw.content),
        isError: raw.is_error === true,
      },
    });
  }
  if (parts.length > 0) parts.push(status(state, null));
  return [state, parts];
}

/** Takes one line of the agent's output and returns the next state and the parts it makes. */
export function feed(state: ReplyState, event: unknown): [ReplyState, Part[]] {
  if (!isObject(event)) return [state, []];
  switch (event.type) {
    case "stream_event":
      return isObject(event.event)
        ? streamEvent(state, event.event)
        : [state, []];
    case "assistant":
      return assistantEvent(state, event);
    case "user":
      return userEvent(state, event);
    case "result":
      return [
        initialReply,
        [
          {
            type: "end",
            durationMs:
              typeof event.duration_ms === "number" ? event.duration_ms : null,
            costUsd:
              typeof event.total_cost_usd === "number"
                ? event.total_cost_usd
                : null,
            error: event.is_error === true,
          },
        ],
      ];
    default:
      return [state, []];
  }
}
