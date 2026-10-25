/**
 * The page's chat: the state that the live channel's chat parts build, and the send of a message.
 * The page never writes to the map. A message goes to the server with the server token, and the
 * agent's turn writes (#werk-chat).
 */
import { type Action, type ChatState, emptyChat, reduce } from "./chat-log";
import { apiOf } from "./project-route";

/** The events of the live channel that the chat reads. */
export const CHAT_EVENTS = [
  "sent",
  "turn-start",
  "delta",
  "chat",
  "status",
  "turn-end",
] as const;

export type ChatDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  token: string;
  /** The card the map shows now, or null before it shows one. */
  card: () => string | null;
  now: () => number;
  /** A name no other turn of the conversation has. */
  newTurn: () => string;
};

export type ChatStore = {
  get(): ChatState;
  subscribe(listener: () => void): () => void;
  /** Applies one event of the live channel, with its data as the channel sent it. */
  receive(type: string, data: string): void;
  /** Reads the events that the server kept, for a page that joins late. */
  load(): Promise<void>;
  send(text: string): Promise<void>;
};

export function createChatStore(deps: ChatDeps, project: string): ChatStore {
  let state: ChatState = emptyChat;
  const listeners = new Set<() => void>();

  const apply = (action: Action) => {
    state = reduce(state, action);
    for (const listener of listeners) listener();
  };

  const receive: ChatStore["receive"] = (type, data) => {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof body.turn !== "string") return;
    switch (type) {
      case "sent":
        apply({ type: "sent", turn: body.turn, text: String(body.text ?? "") });
        break;
      case "turn-start":
        apply({ type: "turn-start", turn: body.turn, at: deps.now() });
        break;
      case "turn-end":
        apply({ ...body, type: "turn-end" } as unknown as Action);
        break;
      case "delta":
      case "chat":
      case "status":
        apply({ ...body, type } as unknown as Action);
        break;
    }
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    receive,
    async load() {
      const res = await deps.fetch(apiOf(project, "/chat"));
      if (!res.ok) return;
      const { events } = (await res.json()) as {
        events: { name: string; data: unknown }[];
      };
      for (const event of events)
        receive(event.name, JSON.stringify(event.data));
    },
    async send(text) {
      const turn = deps.newTurn();
      apply({ type: "sent", turn, text });
      let problem: string | null = null;
      try {
        const res = await deps.fetch(apiOf(project, "/chat"), {
          method: "POST",
          headers: {
            "x-werk-token": deps.token,
            "content-type": "application/json",
          },
          body: JSON.stringify({ text, card: deps.card(), turn }),
        });
        if (!res.ok) {
          const refusal = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          problem = refusal.message ?? `the server answered ${res.status}`;
        }
      } catch (error) {
        problem = String(error);
      }
      if (problem !== null) {
        apply({
          type: "turn-end",
          turn,
          durationMs: null,
          costUsd: null,
          error: true,
          exited: `the message was not sent: ${problem}`,
        });
      }
    },
  };
}
