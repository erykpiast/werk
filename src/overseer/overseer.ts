/**
 * The overseer of one agent session: plain code beside the session that answers its permission asks
 * and cancels it when it is silent, frozen or looping. Every limit is a parameter, and the clock, the
 * process probe and the classifier are passed in (#lp-overseer, #lp-overseer-det, #lp-overseer-mechanics,
 * #lp-overseer-asks, #lp-overseer-silence, #lp-overseer-silence-start, #lp-overseer-silence-tokens,
 * #lp-overseer-inflight, #lp-overseer-progress, #lp-overseer-psfail). Pure: it holds no live thing.
 */
import { callLabel, controlLine, parseAsk } from "../chat/permission.ts";
import type { Probe } from "./process-table.ts";
import {
  askPrompt,
  loopPrompt,
  parseAskVerdict,
  parseLoopVerdict,
} from "./verdicts.ts";

export type Limits = {
  /** No event for this long, with no tool call in flight, cancels the session. */
  silenceMs: number;
  /** A tool call in flight with no sign of work for this long is frozen. */
  flatMs: number;
  /** The time between two progress questions to a classifier. */
  progressMs: number;
  /** The time between two reads of the process table while a call is in flight. */
  sampleMs: number;
};

export type Deps = {
  now(): number;
  /** Stops the session. The reason goes to the next pass. */
  cancel(reason: string): void;
  /** Writes one line to the input of the agent. */
  reply(line: string): void;
  /** Writes one act of the overseer to the session log. */
  note(act: string, text: string): void;
  /** One classifier call. Null when it gave no answer. */
  classify(prompt: string): Promise<string | null>;
  probe(): Promise<Probe>;
};

export type Context = {
  /** The brief of the pass, for the progress question. */
  brief: string;
  /** The text of the ticket, for the permission asks. */
  ticket: string;
  /** True for a session whose asks the overseer answers. Only builder sessions send them. */
  asks: boolean;
};

export type Overseer = {
  /** One event of the stream, as parsed. */
  event(event: unknown): void;
  /** One piece of generated text. It keeps the silence clock armed and goes nowhere else. */
  partial(): void;
  /** Runs the checks that time decides. Call it often. */
  tick(): Promise<void>;
  /** Ends the watch. A verdict that arrives later is dropped. */
  stop(): void;
};

type Rec = Record<string, unknown>;

const rec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The content blocks of a message event. */
function blocksOf(event: Rec): Rec[] {
  const content = rec(event.message) ? event.message.content : undefined;
  return Array.isArray(content) ? content.filter(rec) : [];
}

export function createOverseer(
  limits: Limits,
  deps: Deps,
  context: Context,
): Overseer {
  const seconds = (ms: number) => `${ms / 1000} s`;
  let stopped = false;
  let speaking = false;
  let lastEvent = deps.now();
  const inflight = new Map<string, string>();
  let lastSample = 0;
  let lastCpu: number | null = null;
  let lastCpuChange = 0;
  const calls: string[] = [];
  let judged = 0;
  let lastProgress = deps.now();
  let judging = false;

  const cancel = (act: string, detail: string, reason: string) => {
    stopped = true;
    deps.note(act, detail);
    deps.cancel(reason);
  };

  async function classify(prompt: string): Promise<string | null> {
    try {
      return await deps.classify(prompt);
    } catch {
      return null;
    }
  }

  async function answer(ask: NonNullable<ReturnType<typeof parseAsk>>) {
    const label = callLabel(ask.tool, ask.input);
    const verdict = parseAskVerdict(
      await classify(askPrompt(ask, context.ticket)),
    );
    if (stopped) return;
    // No verdict never widens a permission.
    const allow = verdict?.allow === true;
    const comment =
      verdict === null
        ? "the classifier gave no verdict"
        : verdict.comment === ""
          ? "no comment"
          : verdict.comment;
    deps.reply(
      controlLine(
        ask.id,
        allow
          ? { behavior: "allow", updatedInput: ask.input }
          : {
              behavior: "deny",
              message: `The overseer denied this call: ${comment}`,
            },
      ),
    );
    deps.note("ask", `${allow ? "allowed" : "denied"} ${label}: ${comment}`);
  }

  async function sample() {
    const probe = await deps.probe();
    if (stopped) return;
    if (!probe.ok) {
      // A failed read says nothing about the call, so the flat window starts again.
      lastCpu = null;
      deps.note("probe-failed", probe.why);
      return;
    }
    const now = deps.now();
    if (lastCpu === null || probe.cpuMs !== lastCpu) {
      lastCpu = probe.cpuMs;
      lastCpuChange = now;
    }
    const flat = now - Math.max(lastCpuChange, lastEvent);
    if (flat < limits.flatMs) return;
    const names = [...inflight.values()].join(", ");
    const evidence =
      probe.processes === 0
        ? `the call has no process and the stream was quiet for ${seconds(limits.flatMs)}`
        : `the CPU time of its ${probe.processes} child processes stayed flat for ${seconds(limits.flatMs)}`;
    cancel(
      "frozen",
      `${names}: ${evidence}`,
      `a tool call was frozen (${names}): ${evidence}`,
    );
  }

  async function judge() {
    judging = true;
    const upto = calls.length;
    const verdict = parseLoopVerdict(
      await classify(loopPrompt(context.brief, calls.slice(judged))),
    );
    judging = false;
    if (stopped) return;
    if (verdict === null) {
      deps.note("progress", "no verdict, counted as not looping");
      return;
    }
    judged = upto;
    const reason = verdict.reason === "" ? "no reason given" : verdict.reason;
    if (!verdict.looping) {
      deps.note("progress", `not looping: ${reason}`);
      return;
    }
    cancel("looping", reason, `the agent was looping: ${reason}`);
  }

  return {
    event(event) {
      if (stopped) return;
      speaking = true;
      lastEvent = deps.now();
      if (!rec(event)) return;
      if (event.type === "result") inflight.clear();
      for (const block of blocksOf(event)) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          const name = String(block.name ?? "?");
          inflight.set(block.id, name);
          calls.push(callLabel(name, block.input));
        } else if (
          block.type === "tool_result" &&
          typeof block.tool_use_id === "string"
        ) {
          inflight.delete(block.tool_use_id);
          if (inflight.size === 0) lastCpu = null;
        }
      }
      const ask = context.asks ? parseAsk(event) : null;
      if (ask !== null) void answer(ask);
    },
    partial() {
      if (stopped) return;
      speaking = true;
      lastEvent = deps.now();
    },
    async tick() {
      if (stopped) return;
      const now = deps.now();
      if (inflight.size === 0) {
        // The clock starts at the first event, and a call in flight is no silence.
        if (speaking && now - lastEvent > limits.silenceMs) {
          const detail = `no event for ${seconds(limits.silenceMs)}`;
          cancel("silent", detail, `the agent was silent: ${detail}`);
          return;
        }
      } else if (now - lastSample >= limits.sampleMs) {
        lastSample = now;
        await sample();
        if (stopped) return;
      }
      if (now - lastProgress >= limits.progressMs) {
        lastProgress = now;
        if (!judging && calls.length > judged) await judge();
      }
    },
    stop() {
      stopped = true;
    },
  };
}
