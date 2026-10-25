/**
 * The state of the chat pane: the turns, each with its message and the parts of its reply. A part
 * goes under the turn it names, whatever else was sent since (#werk-chat-turn-id). A finished block
 * takes the place of the block it streamed as, by the id they share (#werk-progress). A run of tool
 * calls shows as one group (#werk-tool-collapse).
 */

export type Item = {
  id: string;
  kind: "text" | "thinking" | "tool_use";
  /** The words of a text or thinking block. */
  text: string;
  streaming: boolean;
  name?: string;
  toolUseId?: string;
  /** The input of a tool call: the streamed JSON text, then the parsed input when the call is finished. */
  input?: unknown;
  result?: { text: string; isError: boolean } | null;
};

export type TurnEnd = {
  durationMs: number | null;
  costUsd: number | null;
  error: boolean;
  /** Why the agent exited before it ended the turn. */
  exited?: string;
};

export type Turn = {
  name: string;
  /** The message of the person. Null for a turn that another page sent. */
  text: string | null;
  /** True from the send until the turn starts: "waits for the reply above". */
  waiting: boolean;
  items: Item[];
  status: {
    state: "thinking" | "running";
    tool: string | null;
    tokens: number;
  } | null;
  startedAt: number | null;
  end: TurnEnd | null;
};

/** What the person picked for one question of a form. */
export type Selection = { labels: string[]; other: string };

/** A question that waits for the person, with whether its answer is on the way. */
export type PendingAsk = {
  id: string;
  turn: string;
  tool: string;
  input: unknown;
  reason: string | null;
  suggestion: string | null;
  questions:
    | {
        question: string;
        header: string | null;
        multiSelect: boolean;
        options: { label: string; description: string }[];
      }[]
    | null;
  sending: boolean;
};

/** The model, the advisor and the context fill that the header shows (#werk-model-persist). */
export type ModelSettings = {
  model: "sonnet" | "opus";
  advisor: "opus" | null;
  used: number;
  window: number;
};

export type ChatState = {
  turns: Turn[];
  /** Null until the server has said what it saved. */
  settings: ModelSettings | null;
  /** The open asks, oldest first. */
  asks: PendingAsk[];
  /** The picks of each open question form, kept here so a redraw never clears them (#werk-mc-askqa). */
  selections: Record<string, Selection[]>;
  /** The background tasks of the agent: the length of its last full list (#werk-mc-live-bgcount). */
  background: number;
  /** The error of an agent that exited without werk stopping it, or null (#werk-mc-live-dead). */
  dead: string | null;
};

export const emptyChat: ChatState = {
  turns: [],
  settings: null,
  asks: [],
  selections: {},
  background: 0,
  dead: null,
};

export type Action =
  | { type: "model"; settings: ModelSettings }
  | { type: "cleared" }
  | { type: "background"; count: number }
  | { type: "dead"; error: string | null }
  | { type: "sent"; turn: string; text: string }
  | { type: "turn-start"; turn: string; at: number }
  | {
      type: "delta";
      turn: string;
      id: string;
      kind: Item["kind"];
      name?: string;
      toolUseId?: string;
      text: string;
    }
  | {
      type: "chat";
      turn: string;
      id: string;
      block:
        | { kind: "text" | "thinking"; text: string }
        | { kind: "tool_use"; name: string; input: unknown; toolUseId: string }
        | {
            kind: "tool_result";
            toolUseId: string;
            text: string;
            isError: boolean;
          };
    }
  | {
      type: "status";
      turn: string;
      state: "thinking" | "running";
      tool: string | null;
      tokens: number;
    }
  | ({ type: "turn-end"; turn: string } & TurnEnd)
  | { type: "ask"; ask: Omit<PendingAsk, "sending"> }
  | { type: "ask-done"; id: string }
  | { type: "ask-sending"; id: string; sending: boolean }
  | { type: "pick"; id: string; question: number; selection: Selection };

const isOpen = (turn: Turn) => turn.end === null;

function newTurn(name: string, text: string | null, waiting: boolean): Turn {
  return {
    name,
    text,
    waiting,
    items: [],
    status: null,
    startedAt: null,
    end: null,
  };
}

/** Changes the turn of this name. A part for a turn the page does not know starts a new turn. */
function within(
  state: ChatState,
  name: string,
  change: (turn: Turn) => Turn,
): ChatState {
  const known = state.turns.some((t) => t.name === name);
  const turns = known
    ? state.turns
    : [...state.turns, newTurn(name, null, false)];
  return {
    ...state,
    turns: turns.map((t) => (t.name === name ? change(t) : t)),
  };
}

function upsert(items: Item[], next: Item): Item[] {
  return items.some((i) => i.id === next.id)
    ? items.map((i) => (i.id === next.id ? { ...i, ...next } : i))
    : [...items, next];
}

export function reduce(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "model":
      return { ...state, settings: action.settings };
    case "cleared":
      // Only the chat forgets. The model and the map stay.
      return {
        ...emptyChat,
        settings: state.settings,
        background: state.background,
        dead: state.dead,
      };
    case "background":
      return { ...state, background: action.count };
    case "dead":
      return { ...state, dead: action.error };
    case "ask": {
      // A replay of the history names an ask that is open already, and keeps its state.
      if (state.asks.some((a) => a.id === action.ask.id)) return state;
      return {
        ...state,
        asks: [...state.asks, { ...action.ask, sending: false }],
      };
    }
    case "ask-done": {
      const { [action.id]: _gone, ...selections } = state.selections;
      return {
        ...state,
        asks: state.asks.filter((a) => a.id !== action.id),
        selections,
      };
    }
    case "ask-sending":
      return {
        ...state,
        asks: state.asks.map((a) =>
          a.id === action.id ? { ...a, sending: action.sending } : a,
        ),
      };
    case "pick": {
      const ask = state.asks.find((a) => a.id === action.id);
      if (!ask) return state;
      const have = pickedOf(state, ask);
      const next = have.map((s, i) =>
        i === action.question ? action.selection : s,
      );
      return {
        ...state,
        selections: { ...state.selections, [action.id]: next },
      };
    }
    case "sent": {
      if (state.turns.some((t) => t.name === action.turn)) return state;
      const waiting = state.turns.some(isOpen);
      return {
        ...state,
        turns: [...state.turns, newTurn(action.turn, action.text, waiting)],
      };
    }
    case "turn-start":
      return within(state, action.turn, (t) => ({
        ...t,
        waiting: false,
        startedAt: action.at,
      }));
    case "delta":
      return within(state, action.turn, (t) => {
        const have = t.items.find((i) => i.id === action.id);
        if (have && !have.streaming) return { ...t, waiting: false };
        const item: Item =
          action.kind === "tool_use"
            ? {
                id: action.id,
                kind: "tool_use",
                text: "",
                streaming: true,
                name: action.name ?? have?.name,
                toolUseId: action.toolUseId ?? have?.toolUseId,
                input: `${typeof have?.input === "string" ? have.input : ""}${action.text}`,
                result: have?.result ?? null,
              }
            : {
                id: action.id,
                kind: action.kind,
                text: (have?.text ?? "") + action.text,
                streaming: true,
              };
        return { ...t, waiting: false, items: upsert(t.items, item) };
      });
    case "chat":
      return within(state, action.turn, (t) => {
        const { block } = action;
        if (block.kind === "tool_result") {
          const items = t.items.map((i) =>
            i.toolUseId === block.toolUseId
              ? { ...i, result: { text: block.text, isError: block.isError } }
              : i,
          );
          return { ...t, waiting: false, items };
        }
        const have = t.items.find((i) => i.id === action.id);
        const item: Item =
          block.kind === "tool_use"
            ? {
                id: action.id,
                kind: "tool_use",
                text: "",
                streaming: false,
                name: block.name,
                toolUseId: block.toolUseId,
                input: block.input,
                result: have?.result ?? null,
              }
            : {
                id: action.id,
                kind: block.kind,
                text: block.text,
                streaming: false,
              };
        return { ...t, waiting: false, items: upsert(t.items, item) };
      });
    case "status":
      return within(state, action.turn, (t) =>
        t.end === null
          ? {
              ...t,
              waiting: false,
              status: {
                state: action.state,
                tool: action.tool,
                tokens: action.tokens,
              },
            }
          : t,
      );
    case "turn-end":
      return within(state, action.turn, (t) => ({
        ...t,
        waiting: false,
        status: null,
        end: {
          durationMs: action.durationMs,
          costUsd: action.costUsd,
          error: action.error,
          exited: action.exited,
        },
      }));
  }
}

const noSelection: Selection = { labels: [], other: "" };

/** The picks of an ask, one entry for each of its questions. */
export function pickedOf(state: ChatState, ask: PendingAsk): Selection[] {
  const have = state.selections[ask.id] ?? [];
  return (ask.questions ?? []).map((_, i) => have[i] ?? noSelection);
}

/** What each question's answer sends: the labels picked, then the free text. Null until each has one. */
export function picksToSend(
  selections: readonly Selection[],
): string[][] | null {
  const picks = selections.map((s) => [
    ...s.labels,
    ...(s.other.trim() === "" ? [] : [s.other.trim()]),
  ]);
  return picks.length > 0 && picks.every((p) => p.length > 0) ? picks : null;
}

export type Row =
  | { type: "item"; item: Item }
  | { type: "tools"; id: string; calls: Item[] };

/** Joins each run of tool calls into one row. Any other block ends the run. */
export function rowsOf(items: readonly Item[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (item.kind !== "tool_use") {
      rows.push({ type: "item", item });
    } else if (last?.type === "tools") {
      last.calls.push(item);
    } else {
      rows.push({ type: "tools", id: item.id, calls: [item] });
    }
  }
  return rows;
}

/** A short form of what a tool call does: the first of its usual arguments that is text. */
export function briefOf(call: Item): string {
  const input = call.input;
  let value = "";
  if (typeof input === "object" && input !== null) {
    const fields = input as Record<string, unknown>;
    for (const key of [
      "command",
      "file_path",
      "pattern",
      "path",
      "url",
      "description",
    ]) {
      if (typeof fields[key] === "string") {
        value = fields[key];
        break;
      }
    }
  }
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

/** The summary line of a run of tool calls: the latest call and the count. */
export function toolSummary(calls: readonly Item[]): {
  latest: string;
  count: number;
} {
  const last = calls[calls.length - 1];
  const brief = last ? briefOf(last) : "";
  return {
    latest: `${last?.name ?? "tool"}${brief === "" ? "" : ` ${brief}`}`,
    count: calls.length,
  };
}

export type Head = {
  busy: boolean;
  /** "thinking", "running Bash", or "idle". */
  label: string;
  seconds: number | null;
  tokens: number | null;
};

/** The turn state of the header row. It reads the oldest open turn, the one the agent works on. */
export function headOf(state: ChatState, now: number): Head {
  const active = state.turns.find((t) => isOpen(t) && !t.waiting);
  if (!active)
    return { busy: false, label: "idle", seconds: null, tokens: null };
  const status = active.status;
  return {
    busy: true,
    label:
      status?.state === "running" && status.tool
        ? `running ${status.tool}`
        : "thinking",
    seconds:
      active.startedAt === null
        ? null
        : Math.max(0, Math.floor((now - active.startedAt) / 1000)),
    tokens: status?.tokens ?? null,
  };
}

/** The end line of a turn: duration and cost. */
export function endLine(end: TurnEnd): string {
  if (end.exited !== undefined) return `the agent exited: ${end.exited}`;
  const parts: string[] = [];
  if (end.durationMs !== null)
    parts.push(`${Math.round(end.durationMs / 1000)}s`);
  if (end.costUsd !== null) parts.push(`$${end.costUsd.toFixed(2)}`);
  return parts.join(" · ");
}

export function formatTokens(tokens: number): string {
  return tokens >= 1000
    ? `${(tokens / 1000).toFixed(1)}k tokens`
    : `${tokens} tokens`;
}
