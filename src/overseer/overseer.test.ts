import { beforeEach, expect, test } from "bun:test";
import {
  type Context,
  createOverseer,
  type Deps,
  type Limits,
} from "./overseer.ts";
import type { Probe } from "./process-table.ts";

const LIMITS: Limits = {
  silenceMs: 60,
  flatMs: 60,
  progressMs: 300,
  sampleMs: 10,
};

let clock: number;
let cancelled: string[];
let replies: string[];
let notes: [string, string][];
let prompts: string[];
let answers: (string | null)[];
let probes: Probe[];
let killed: number[][];

const deps = (): Deps => ({
  now: () => clock,
  cancel: (reason) => cancelled.push(reason),
  killProcesses: (pids) => killed.push(pids),
  reply: (line) => replies.push(line),
  note: (act, text) => notes.push([act, text]),
  classify: async (prompt) => {
    prompts.push(prompt);
    return answers.shift() ?? null;
  },
  probe: async () =>
    probes.shift() ?? { ok: true, processes: 0, cpuMs: 0, pids: [] },
});
const context: Context = {
  brief: "the brief",
  ticket: "the ticket",
  asks: true,
};
const make = (limits: Partial<Limits> = {}, ctx: Partial<Context> = {}) =>
  createOverseer({ ...LIMITS, ...limits }, deps(), { ...context, ...ctx });
const call = (
  id: string,
  name = "Bash",
  input: unknown = { command: "make test" },
) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const done = (id: string) => ({
  type: "user",
  message: {
    content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
  },
});
const ask = (id: string) => ({
  type: "control_request",
  request_id: id,
  request: {
    subtype: "can_use_tool",
    tool_name: "Bash",
    input: { command: "rm x" },
  },
});
const advance = async (o: ReturnType<typeof make>, ms: number, step = 10) => {
  for (let spent = 0; spent < ms; spent += step) {
    clock += step;
    await o.tick();
  }
};

beforeEach(() => {
  clock = 1000;
  cancelled = [];
  replies = [];
  notes = [];
  prompts = [];
  answers = [];
  probes = [];
  killed = [];
});

test("a slow start with no event is never silence", async () => {
  const o = make();
  await advance(o, 500);
  expect(cancelled).toEqual([]);
});

test("silence after the first event cancels the session", async () => {
  const o = make();
  o.event({ type: "system" });
  await advance(o, 100);
  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]).toContain("silent");
  expect(notes[0]?.[0]).toBe("silent");
});

test("each event and each partial message resets the silence clock", async () => {
  const o = make();
  o.event({ type: "system" });
  for (let i = 0; i < 10; i++) {
    await advance(o, 40);
    if (i % 2 === 0) o.partial();
    else o.event({ type: "assistant" });
  }
  expect(cancelled).toEqual([]);
});

test("a partial message starts the clock too, and nothing runs after stop", async () => {
  const o = make();
  o.partial();
  await advance(o, 100);
  expect(cancelled).toHaveLength(1);
  o.stop();
  o.event({ type: "x" });
  o.partial();
  await o.tick();
  expect(cancelled).toHaveLength(1);
});

test("a tool call in flight is not silence while its CPU time grows", async () => {
  const o = make();
  o.event(call("t1"));
  for (let i = 0; i < 20; i++) {
    probes.push({ ok: true, processes: 2, cpuMs: 100 * (i + 1), pids: [5, 6] });
    await advance(o, 10);
  }
  expect(cancelled).toEqual([]);
  o.event(done("t1"));
  await advance(o, 100);
  expect(cancelled[0]).toContain("silent");
});

test("flat CPU time kills the child processes and leaves the session running", async () => {
  const o = make();
  o.event(call("t1"));
  for (let i = 0; i < 20; i++)
    probes.push({ ok: true, processes: 2, cpuMs: 500, pids: [7, 8] });
  await advance(o, 100);
  expect(killed[0]).toEqual([7, 8]);
  expect(cancelled).toEqual([]);
  expect(
    notes.some(([act, text]) => act === "frozen" && text.includes("CPU time")),
  ).toBe(true);
});

test("a call with no process and a quiet stream is frozen, and an event restarts the window", async () => {
  const o = make();
  o.event(call("t1"));
  await advance(o, 40);
  o.event({ type: "assistant", message: { content: [] } });
  await advance(o, 40);
  expect(cancelled).toEqual([]);
  await advance(o, 100);
  expect(cancelled[0]).toContain("no process");
});

test("a failed probe cancels nothing, is recorded, and restarts the flat window", async () => {
  const o = make();
  o.event(call("t1"));
  probes.push({ ok: true, processes: 1, cpuMs: 5, pids: [5] });
  await advance(o, 10);
  for (let i = 0; i < 12; i++) probes.push({ ok: false, why: "ps is gone" });
  await advance(o, 120);
  expect(cancelled).toEqual([]);
  expect(notes.filter(([act]) => act === "probe-failed")).toHaveLength(12);
  expect(notes[0]?.[1]).toBe("ps is gone");
});

test("an ask is allowed or denied by the classifier, and the answer is logged", async () => {
  answers.push(
    '{"verdict":"allow","comment":"fits the ticket"}',
    '{"verdict":"deny","comment":"deletes work"}',
  );
  const o = make();
  o.event(ask("a1"));
  await Promise.resolve();
  await Promise.resolve();
  o.event(ask("a2"));
  await Promise.resolve();
  await Promise.resolve();
  expect(prompts[0]).toContain("the ticket");
  expect(prompts[0]).toContain("rm x");
  expect(JSON.parse(replies[0] ?? "").response.response.behavior).toBe("allow");
  const second = JSON.parse(replies[1] ?? "").response;
  expect(second.request_id).toBe("a2");
  expect(second.response.behavior).toBe("deny");
  expect(second.response.message).toContain("deletes work");
  expect(notes.map(([act]) => act)).toEqual(["ask", "ask"]);
  expect(notes[1]?.[1]).toContain("denied Bash rm x: deletes work");
});

test("a classifier with no verdict, or one that throws, denies the ask", async () => {
  answers.push("I do not know");
  const o = make();
  o.event(ask("a1"));
  await Bun.sleep(5);
  expect(JSON.parse(replies[0] ?? "").response.response.behavior).toBe("deny");
  expect(notes[0]?.[1]).toContain("no verdict");
  const failing = createOverseer(
    LIMITS,
    {
      ...deps(),
      classify: async () => {
        throw new Error("boom");
      },
    },
    context,
  );
  failing.event(ask("a2"));
  await Bun.sleep(5);
  expect(JSON.parse(replies[1] ?? "").response.response.behavior).toBe("deny");
});

test("a session that sends no asks to the classifier leaves them alone", async () => {
  const o = make({}, { asks: false });
  o.event(ask("a1"));
  await Bun.sleep(5);
  expect(prompts).toEqual([]);
  expect(replies).toEqual([]);
});

test("a looping verdict cancels with the reason; the calls are those since the last verdict", async () => {
  const o = make({ silenceMs: 10_000, flatMs: 10_000, progressMs: 100 });
  o.event(call("t1", "Bash", { command: "make test" }));
  o.event(done("t1"));
  answers.push('{"verdict":"not looping","reason":"moving"}');
  await advance(o, 100);
  expect(cancelled).toEqual([]);
  expect(notes.at(-1)).toEqual(["progress", "not looping: moving"]);
  // No new call: the classifier is skipped.
  await advance(o, 300);
  expect(prompts).toHaveLength(1);
  o.event(call("t2", "Edit", { file_path: "a.ts" }));
  o.event(done("t2"));
  answers.push('{"verdict":"looping","reason":"same edit again"}');
  await advance(o, 100);
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Edit a.ts");
  expect(prompts[1]).not.toContain("make test");
  expect(cancelled).toEqual(["the agent was looping: same edit again"]);
});

test("a progress question with no verdict counts as not looping and keeps its calls", async () => {
  const o = make({ silenceMs: 10_000, flatMs: 10_000, progressMs: 100 });
  o.event(call("t1"));
  o.event(done("t1"));
  await advance(o, 110);
  expect(cancelled).toEqual([]);
  expect(notes.at(-1)?.[1]).toContain("no verdict");
  await advance(o, 100);
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Bash make test");
});

test("a result event ends every call in flight", async () => {
  const o = make();
  o.event(call("t1"));
  o.event({ type: "result" });
  await advance(o, 100);
  expect(cancelled[0]).toContain("silent");
});
