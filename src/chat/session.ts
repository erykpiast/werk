/**
 * The conversation of one project: one long-lived agent child, the turns that wait for it, and the
 * parts of each reply, sent on the live channel with the name of the turn they belong to
 * (#werk-onechat, #werk-chat-turn-id, #werk-progress).
 */
import { buildLaunchOptions } from "../agent/launch-options.ts";
import type { FoldedMap } from "../map/fold.ts";
import { buildRuleTitles } from "./build-rules.ts";
import { cardLine } from "./card-line.ts";
import {
  clearSessionId,
  readSessionId,
  readSettings,
  writeSessionId,
  writeSettings,
} from "./chat-state-store.ts";
import { chatArgs } from "./child-args.ts";
import { usageTokens, windowFromResult, windowOf } from "./context-fill.ts";
import { onCrash } from "./crash-rules.ts";
import { imageHeader } from "./image-rules.ts";
import { choiceOf, DEFAULT_PICK, type ModelPick } from "./model-pick.ts";
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

/** The model, the advisor and the context fill that the header shows (#werk-model-persist). */
export type ChatSettings = ModelPick & { used: number; window: number };

/** What a page receives on the live channel. A turn event names its turn. */
export type ChatEvent =
  | { name: "model"; data: ChatSettings }
  | { name: "cleared"; data: Record<string, never> }
  | { name: "background"; data: { count: number } }
  | { name: "dead"; data: { error: string | null } }
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
  /** The name of a conversation other than the main one. Its saved state sits in files of its own. */
  name?: string;
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
  /** The model, advisor and context fill now. They are saved, so a rebuilt session reads them back. */
  settings(): ChatSettings;
  /** Switches the model. Refused while a turn is open: the model takes effect only at spawn. */
  setModel(pick: ModelPick): Promise<Refusal>;
  /** Drops the session and the transcript and restarts the child. The map is untouched. */
  clear(): Promise<Refusal>;
  /** The count of background tasks: the length of the last full list the agent sent (#werk-mc-live-bgcount). */
  background(): number;
  /** The error of a child that exited without werk stopping it, until the next child starts (#werk-mc-live-dead). */
  dead(): string | null;
  /** The command names that the most recent agent named when it started, or none before a first start. */
  commands(): string[];
  /** Ends the child. Every open turn ends with the exit. */
  stop(): Promise<void>;
};

type Refusal = { ok: true } | { ok: false; reason: string };

const HISTORY_LIMIT = 5000;
const STDERR_LIMIT = 50_000;
const BUSY = "a turn is running, so the model and the context stay as they are";

type Child = Bun.Subprocess<"pipe", "pipe", "pipe">;

export function createSession(deps: SessionDeps): ChatSession {
  let queue: Queue = emptyQueue;
  let announced: string | null = null;
  let child: Child | null = null;
  let reply = initialReply;
  let startedAt = 0;
  let stderrText = "";
  /** What the child of this launch reported before it reached its session, and whether it did. */
  let initSeen = false;
  let earlyError = "";
  /** True from stop() until the next launch: an exit then is not a crash to retry. */
  let stopped = false;
  /** The retries that the waiting message used. One is allowed (#werk-crashmsg). */
  let attempts = 0;
  const saved = readSettings(deps.logPath, deps.name);
  let pick: ModelPick = saved
    ? { model: saved.model, advisor: saved.advisor }
    : DEFAULT_PICK;
  let used = saved?.used ?? 0;
  let window = saved?.window ?? windowOf(choiceOf(pick).model);
  let sessionId = readSessionId(deps.logPath, deps.name);
  let pumping: Promise<void> = Promise.resolve();
  const kept: ChatEvent[] = [];
  /** The asks that wait for the person, by the id of the control request. */
  const asks = new Map<string, Ask>();
  let commandNames: string[] = [];
  let tasks = 0;
  let deadError: string | null = null;

  const emit = (event: ChatEvent) => {
    if (
      event.name !== "delta" &&
      event.name !== "status" &&
      event.name !== "model" &&
      event.name !== "background" &&
      event.name !== "dead" &&
      event.name !== "cleared"
    ) {
      kept.push(event);
      if (kept.length > HISTORY_LIMIT) kept.shift();
    }
    deps.emit(event);
  };

  const settings = (): ChatSettings => ({ ...pick, used, window });

  const persist = () => writeSettings(deps.logPath, settings(), deps.name);

  const announceSettings = () => emit({ name: "model", data: settings() });

  const setTasks = (count: number) => {
    if (count === tasks) return;
    tasks = count;
    emit({ name: "background", data: { count } });
  };

  const setDead = (error: string | null) => {
    if (error === deadError) return;
    deadError = error;
    emit({ name: "dead", data: { error } });
  };

  /** Ends every open turn with the text of the failure. */
  const endAll = (message: string) => {
    const { queue: next, ended } = exitAll(queue);
    queue = next;
    attempts = 0;
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

  /** The agent is gone: forget what lived in it. */
  const forgetChild = () => {
    child = null;
    reply = initialReply;
    announced = null;
    for (const id of asks.keys()) emit({ name: "ask-done", data: { id } });
    asks.clear();
    setTasks(0);
  };

  /**
   * An exit of the agent. The waiting message replays into a new session when the stored one is
   * dead, and retries once for any other failure a retry can fix. Otherwise the turns end with the
   * whole error (#werk-resume, #werk-crashmsg, #werk-fullerr).
   */
  const handleExit = (message: string) => {
    forgetChild();
    const active = queue.active;
    if (stopped) return endAll(message);
    if (active === null) {
      endAll(message);
      return setDead(message);
    }
    const action = onCrash(message, {
      hasSession: sessionId !== null,
      retried: attempts > 0,
    });
    if (action.kind === "report") {
      endAll(action.message);
      return setDead(action.message);
    }
    if (action.kind === "replay") {
      sessionId = null;
      clearSessionId(deps.logPath, deps.name);
      attempts = 0;
    } else {
      attempts += 1;
    }
    dispatch(active, true);
  };

  const launch = (): Child => {
    const map = deps.readMap();
    const options = buildLaunchOptions({
      role: "chat",
      chatModel: choiceOf(pick),
      werk: deps.werk,
      projectIsWerk: deps.projectIsWerk,
      buildRuleTitles: buildRuleTitles(map),
    });
    const spawned = Bun.spawn(
      [
        "claude",
        ...chatArgs(options, allowFlags(readAllow(deps.logPath)), sessionId),
      ],
      {
        cwd: deps.folder,
        env: { ...deps.env, WERK_LOG: deps.logPath, ...options.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    ) as Child;
    stderrText = "";
    initSeen = false;
    earlyError = "";
    stopped = false;
    setDead(null);
    pumping = pump(spawned);
    return spawned;
  };

  /**
   * Reads the lines that are about the session and not about the reply. Returns true for a line the
   * reply stream must not see: a result before the session starts is the child's failure to start,
   * not a finished turn (#werk-resume).
   */
  const noteSession = (event: unknown): boolean => {
    if (typeof event !== "object" || event === null) return false;
    const e = event as Record<string, unknown>;
    if (e.type === "system" && e.subtype === "init") {
      initSeen = true;
      if (typeof e.session_id === "string" && e.session_id !== sessionId) {
        sessionId = e.session_id;
        writeSessionId(deps.logPath, sessionId, deps.name);
      }
      return true;
    }
    if (e.type === "system" && e.subtype === "background_tasks") {
      if (Array.isArray(e.tasks)) setTasks(e.tasks.length);
      return true;
    }
    if (e.type === "result" && !initSeen) {
      earlyError = resultText(e);
      return true;
    }
    if (e.type === "assistant" && e.parent_tool_use_id == null) {
      const message = e.message as { usage?: unknown } | undefined;
      const tokens = usageTokens(message?.usage);
      if (tokens > 0 && tokens !== used) {
        used = tokens;
        announceSettings();
      }
    } else if (e.type === "result") {
      const reported = windowFromResult(e.modelUsage, choiceOf(pick).model);
      if (reported !== null && reported !== window) {
        window = reported;
        announceSettings();
      }
    }
    return false;
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
    if (noteSession(event)) return;
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
        attempts = 0;
        persist();
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
    const written = [earlyError, stderrText.trim()].filter((t) => t !== "");
    handleExit(
      written.length > 0
        ? written.join("\n")
        : `the agent exited with code ${code}`,
    );
  };

  /** Stops the child on purpose and starts it again with the current settings. */
  const restart = async () => {
    const old = child;
    if (old === null) return;
    forgetChild();
    const done = pumping;
    old.kill();
    await done;
    child = launch();
  };

  const idle = () => queue.active === null && queue.waiting.length === 0;

  /** Writes the turn to the agent, with the opening lines of the open card. */
  const dispatch = (sent: Sent, replay = false) => {
    try {
      child ??= launch();
      const opening = cardLine(deps.readMap(), sent.card, announced);
      announced = opening.announced;
      const content = [opening.text, imageHeader(sent.images ?? []), sent.text]
        .filter((part) => part !== "")
        .join("\n\n");
      if (!replay) startedAt = Date.now();
      child.stdin.write(
        `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`,
      );
      child.stdin.flush();
      if (!replay) emit({ name: "turn-start", data: { turn: sent.turn } });
    } catch (error) {
      const failed = child;
      forgetChild();
      endAll(`werk: the agent could not run: ${String(error)}`);
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
    history: () => [
      ...kept,
      ...(tasks > 0
        ? [{ name: "background" as const, data: { count: tasks } }]
        : []),
      ...(deadError !== null
        ? [{ name: "dead" as const, data: { error: deadError } }]
        : []),
    ],
    background: () => tasks,
    dead: () => deadError,
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
    settings,
    async setModel(next) {
      if (!idle()) return { ok: false, reason: BUSY };
      if (next.model === pick.model && next.advisor === pick.advisor) {
        return { ok: true };
      }
      pick = next;
      window = windowOf(choiceOf(pick).model);
      persist();
      announceSettings();
      await restart();
      return { ok: true };
    },
    async clear() {
      if (!idle()) return { ok: false, reason: BUSY };
      sessionId = null;
      clearSessionId(deps.logPath, deps.name);
      used = 0;
      window = windowOf(choiceOf(pick).model);
      persist();
      kept.length = 0;
      emit({ name: "cleared", data: {} });
      announceSettings();
      await restart();
      return { ok: true };
    },
    async stop() {
      stopped = true;
      const running = child;
      if (!running) return;
      running.kill();
      // The pump ends the open turns once the output has been read to its end.
      await pumping;
    },
  };
}

/** The words an error result carries: its list of errors, or its result text. */
function resultText(result: Record<string, unknown>): string {
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    return result.errors.map(String).join("\n");
  }
  return typeof result.result === "string" ? result.result : "";
}
