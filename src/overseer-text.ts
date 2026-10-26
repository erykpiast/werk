/**
 * The pure half of the overseer: reading `ps` output, and what its two classifiers are asked.
 * Split from overseer.ts so the 90% line gate can hold it without holding the child process —
 * see #werk-test-scope-src0-pure-scope.
 */

/** What the operating system shows of the processes under one agent. */
export type ProcessSample = {
  /** CPU time of every descendant process, summed. */
  cpuMs: number
  /** The descendant processes: the running tool call's process tree. */
  pids: number[]
  /** Set when the probe could not read the process table. The sample is then unknown, not
   *  empty: no evidence either way (#lp-overseer-psfail). */
  error?: string
}

/** "[[dd-]hh:]mm:ss[.cc]", the TIME column of ps on macOS and Linux, in milliseconds. */
export function parseCpuTime(text: string): number {
  const [days, rest] = text.includes('-') ? text.split('-') : ['0', text]
  const parts = rest.split(':').map(Number)
  let sec = 0
  for (const p of parts) sec = sec * 60 + p
  return Math.round((Number(days) * 86_400 + sec) * 1000)
}

/** The descendants of `root` in `ps -A -o pid=,ppid=,time=` output, with their CPU time. */
export function descendants(psOutput: string, root: number): ProcessSample {
  const rows = psOutput
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((r) => r.length >= 3)
    .map(([pid, ppid, time]) => ({ pid: Number(pid), ppid: Number(ppid), cpuMs: parseCpuTime(time) }))
  const children = new Map<number, typeof rows>()
  for (const r of rows) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r])
  const out: ProcessSample = { cpuMs: 0, pids: [] }
  const queue = [root]
  while (queue.length) {
    for (const c of children.get(queue.shift()!) ?? []) {
      out.pids.push(c.pid)
      out.cpuMs += c.cpuMs
      queue.push(c.pid)
    }
  }
  return out
}

export function askPrompt(o: { brief: string; tool: string; input: unknown }): string {
  return `You are the permission classifier of a build loop. You run headless: you may not ask a question.

A builder agent is working on the ticket below with no person watching. It asked to make a tool call that its allowed tools do not cover. Decide whether the call makes sense for this ticket.

Allow it when the call is a normal step toward the ticket. Deny it when something looks wrong: it reaches outside the project, deletes or rewrites what the ticket does not touch, sends data out, or has nothing to do with the ticket. When you deny, the comment tells the builder why, and the builder continues without the call.

Answer with only a JSON object:

{"allow": true | false, "comment": "<one or two sentences: why>"}

## The ticket

${o.brief}

## The call

Tool: ${o.tool}

\`\`\`json
${JSON.stringify(o.input, null, 2).slice(0, 4000)}
\`\`\``
}

/** #lp-overseer / #lp-overseer-progress: the classifier watches every running agent session,
 *  so the prompt names which one. A `pass-N` session, or none, is the builder. */
function whoWorks(session?: string): string {
  if (!session || /^pass-\d+$/.test(session)) return 'A builder agent is working on the ticket below.'
  return `An agent of the "${session}" step is checking a builder's work on the ticket below.`
}

export function progressPrompt(o: { brief: string; calls: string[]; session?: string }): string {
  return `You are the progress classifier of a build loop. You run headless: you may not ask a question.

${whoWorks(o.session)} Here are the tool calls it made since the last check. Say whether it is looping: repeating the same calls, or the same failing check, without moving forward. Trying something new after a failure is not looping.

Answer with only a JSON object:

{"looping": true | false, "reason": "<one or two sentences>"}

## The ticket

${o.brief}

## Tool calls since the last check

${o.calls.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
}

/** One line per tool call, for the progress classifier. */
export function describeToolUse(c: { name?: string; input?: unknown }): string {
  return `${c.name ?? '?'} ${JSON.stringify(c.input ?? {}).slice(0, 300)}`
}

/** #lp-overseer-inflight: what the agent reads on the result of a call the overseer killed. */
export function frozenNote(o: { tool: string; evidence: { cpuMs: number; flatMs: number; pids: number[]; runningMs: number } }): string {
  const s = (ms: number) => `${Math.round(ms / 100) / 10}s`
  const e = o.evidence
  return `The werk overseer cancelled this ${o.tool} call because it was frozen. Evidence: the call ran for ${s(e.runningMs)}; its processes (pid ${e.pids.join(', ')}) used no new CPU time for ${s(e.flatMs)} (total ${s(e.cpuMs)}). A frozen call waits on something that never answers: a promise that never resolves, or a host that does not reply. Do not run it again unchanged. Find what it waits on, or run it with a timeout, and continue.`
}
