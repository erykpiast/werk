/**
 * The conversation of one project: one long-lived agent child, the turns that wait for it, and the
 * parts of each reply, sent on the live channel with the name of the turn they belong to
 * (#werk-onechat, #werk-chat-turn-id, #werk-progress).
 */
import { buildLaunchOptions, OPUS, SONNET } from "../agent/launch-options.ts";
import type { FoldedMap } from "../map/fold.ts";
import { buildRuleTitles } from "./build-rules.ts";
import { cardLine } from "./card-line.ts";
import { chatArgs } from "./child-args.ts";
import { imageHeader } from "./image-rules.ts";
import {
  type Answer,
  type Ask,
  allowFlags,
  callLabel,
  parseAsk,
  type Question,
  reply as replyTo,
  suggestionLabels,
} from "./permission.ts";
import { appendAsk, keepAllow, readAllow } from "./permission-store.ts";
import { feed, initialReply, type Part } from "./reply-stream.ts";
import { commandsOf } from "./start-line.ts";
import {
  emptyQueue,
  enqueue,
  exitAll,
  finish,
  holds,
  type Queue,
  type Sent,
} from "./turn-queue.ts";

/** What a page receives on the live channel. Every event names its turn. */
export type ChatEvent =
  | { name: "sent"; data: { turn: string; text: string } }
  | { name: "turn-start"; data: { turn: string } }
  | { name: "delta"; data: Part & { type: "delta"; turn: string } }
  | { name: "chat"; data: Part & { type: "chat"; turn: string } }
  | { name: "status"; data: Part & { type: "status"; turn: string } }
  | { name: "ask"; data: AskData }
  | { name: "ask-done"; data: { id: string } }
  | {
      name: "turn-end";
      data: {
        turn: string;
        durationMs: number | null;
        costUsd: number | null;
        error: boolean;
        /** Set when the agent exited before it ended the turn, with what it wrote on its error output. */
        exited?: string;
      };
    };

/** A question that waits for the person, as a page receives it. */
export type AskData = {
  turn: string;
  id: string;
  tool: string;
  input: unknown;
  reason: string | null;
  /** The rules Always allow would store, or null when the CLI attached no suggestion. */
  suggestion: string | null;
  questions: Question[] | null;
};

export type SessionDeps = {
  folder: string;
  logPath: string;
  /** The environment of the server. The child gets a copy with the role and the map's log added. */
  env: Record<string, string | undefined>;
  /** The command that runs werk, as the agent instructions name it. */
  werk: string;
  projectIsWerk: boolean;
  readMap: () => FoldedMap;
  emit: (event: ChatEvent) => void;
};

export type ChatSession = {
  /** Takes a turn. A turn name that is already open is refused. */
  send(sent: Sent): "accepted" | "duplicate";
  /** The names of the turns that are sent and not yet ended. */
  running(): string[];
  /** The events a page that joins late replays, in order. Streamed tokens and statuses are not kept. */
  history(): ChatEvent[];
  /** Answers an open ask. An id that is not open, or an answer the ask cannot take, gives a reason. */
  answer(
    id: string,
    answer: Answer,
  ): { ok: true } | { ok: false; reason: string };
  /** The command names that the most recent agent named when it started, or none before a first start. */
  commands(): string[];
  /** Ends the child. Every open turn ends with the exit. */
  stop(): Promise<void>;
};

const HISTORY_LIMIT = 5000;
const STDERR_LIMIT = 4000;

type Child = Bun.Subprocess<"pipe", "pipe", "pipe">;

export function createSession(deps: SessionDeps): ChatSession {
  let queue: Queue = emptyQueue;
  let announced: string | null = null;
  let child: Child | null = null;
  let reply = initialReply;
  let startedAt = 0;
  let stderrText = "";
  let pumping: Promise<void> = Promise.resolve();
  const kept: ChatEvent[] = [];
  /** The asks that wait for the person, by the id of the control request. */
  const asks = new Map<string, Ask>();
  let commandNames: string[] = [];

  const emit = (event: ChatEvent) => {
    if (event.name !== "delta" && event.name !== "status") {
      kept.push(event);
      if (kept.length > HISTORY_LIMIT) kept.shift();
    }
    deps.emit(event);
  };

  /** The turns end with the exit, and the next send starts a new child. */
  const handleExit = (message: string) => {
    child = null;
    reply = initialReply;
    announced = null;
    for (const id of asks.keys()) emit({ name: "ask-done", data: { id } });
    asks.clear();
    const { queue: next, ended } = exitAll(queue);
    queue = next;
    for (const turn of ended) {
      emit({
        name: "turn-end",
        data: {
          turn,
          durationMs: null,
          costUsd: null,
          error: true,
          exited: message,
        },
      });
    }
  };

  const launch = (): Child => {
    const map = deps.readMap();
    const options = buildLaunchOptions({
      role: "chat",
      chatModel: { model: SONNET, advisor: OPUS },
      werk: deps.werk,
      projectIsWerk: deps.projectIsWerk,
      buildRuleTitles: buildRuleTitles(map),
    });
    const spawned = Bun.spawn(
      ["claude", ...chatArgs(options, allowFlags(readAllow(deps.logPath)))],
      {
        cwd: deps.folder,
        env: { ...deps.env, WERK_LOG: deps.logPath, ...options.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    ) as Child;
    stderrText = "";
    pumping = pump(spawned);
    return spawned;
  };

  const onLine = (line: string) => {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    const named = commandsOf(event);
    if (named) commandNames = named;
    const ask = parseAsk(event);
    if (ask) {
      asks.set(ask.id, ask);
      const suggestion = suggestionLabels(ask.suggestions);
      emit({
        name: "ask",
        data: {
          turn: queue.active?.turn ?? "",
          id: ask.id,
          tool: ask.tool,
          input: ask.input,
          reason: ask.reason,
          suggestion: suggestion.length === 0 ? null : suggestion.join(", "),
          questions: ask.questions,
        },
      });
      return;
    }
    let parts: Part[];
    [reply, parts] = feed(reply, event);
    for (const part of parts) {
      const turn = queue.active?.turn;
      if (turn === undefined) return;
      if (part.type === "end") {
        emit({
          name: "turn-end",
          data: {
            turn,
            durationMs: part.durationMs ?? Date.now() - startedAt,
            costUsd: part.costUsd,
            error: part.error,
          },
        });
        const done = finish(queue);
        queue = done.queue;
        if (done.start) dispatch(done.start);
      } else if (part.type === "delta") {
        emit({ name: "delta", data: { ...part, turn } });
      } else if (part.type === "chat") {
        emit({ name: "chat", data: { ...part, turn } });
      } else {
        emit({ name: "status", data: { ...part, turn } });
      }
    }
  };

  /** Reads the child to its end, then ends the open turns. */
  const pump = async (spawned: Child) => {
    const decoder = new TextDecoder();
    const errors = (async () => {
      for await (const chunk of spawned.stderr) {
        stderrText = (stderrText + decoder.decode(chunk)).slice(-STDERR_LIMIT);
      }
    })();
    let rest = "";
    try {
      for await (const chunk of spawned.stdout) {
        rest += decoder.decode(chunk, { stream: true });
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) if (line.trim() !== "") onLine(line);
      }
      if (rest.trim() !== "") onLine(rest);
    } catch {
      // A broken pipe is the exit that follows.
    }
    await errors.catch(() => {});
    const code = await spawned.exited;
    if (child !== spawned) return;
    handleExit(
      stderrText.trim() !== ""
        ? stderrText.trim()
        : `the agent exited with code ${code}`,
    );
  };

  /** Writes the turn to the agent, with the opening lines of the open card. */
  const dispatch = (sent: Sent) => {
    try {
      child ??= launch();
      const opening = cardLine(deps.readMap(), sent.card, announced);
      announced = opening.announced;
      const content = [opening.text, imageHeader(sent.images ?? []), sent.text]
        .filter((part) => part !== "")
        .join("\n\n");
      startedAt = Date.now();
      child.stdin.write(
        `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`,
      );
      child.stdin.flush();
      emit({ name: "turn-start", data: { turn: sent.turn } });
    } catch (error) {
      const failed = child;
      handleExit(`werk: the agent could not run: ${String(error)}`);
      failed?.kill();
    }
  };

  return {
    send(sent) {
      if (holds(queue, sent.turn)) return "duplicate";
      emit({ name: "sent", data: { turn: sent.turn, text: sent.text } });
      const added = enqueue(queue, sent);
      queue = added.queue;
      if (added.start) dispatch(added.start);
      return "accepted";
    },
    running: () => [
      ...(queue.active ? [queue.active.turn] : []),
      ...queue.waiting.map((w) => w.turn),
    ],
    history: () => [...kept],
    commands: () => [...commandNames],
    answer(id, answer) {
      const ask = asks.get(id);
      if (!ask || !child) return { ok: false, reason: "no such open ask" };
      const made = replyTo(ask, answer);
      if (!made.ok) return { ok: false, reason: made.message };
      child.stdin.write(made.line);
      child.stdin.flush();
      asks.delete(id);
      appendAsk(deps.logPath, {
        at: new Date().toISOString(),
        tool: ask.tool,
        label: callLabel(ask.tool, ask.input),
        input: ask.input,
        reason: ask.reason,
        decision: made.logged,
        widened: made.widened,
      });
      if (made.logged === "always") keepAllow(deps.logPath, ask.suggestions);
      emit({ name: "ask-done", data: { id } });
      return { ok: true };
    },
    async stop() {
      const running = child;
      if (!running) return;
      running.kill();
      // The pump ends the open turns once the output has been read to its end.
      await pumping;
    },
  };
}
