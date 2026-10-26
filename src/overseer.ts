/**
 * The overseer's parts outside the silence timer. See #lp-overseer, #lp-overseer-det.
 *
 * The overseer is code. It asks a model only two questions, each a short classification call
 * with no tools, waited for with a timeout like any other tool call:
 *
 *   - Does this permission ask make sense for the ticket? (#lp-overseer-asks)
 *   - Is this agent looping? (#lp-overseer-progress)
 *
 * The third part, telling a working tool call from a frozen one (#lp-overseer-inflight),
 * needs no model: it reads the process tree under the agent through a ProcessProbe, so a
 * test can fake what the operating system reports.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { extractJson } from './grade-parse.ts'
import { askPrompt, descendants, progressPrompt } from './overseer-text.ts'
import type { ProcessSample } from './overseer-text.ts'
import { runHeadless } from './prototype.ts'
import type { HeadlessResult } from './prototype.ts'
import type { AgentRole } from './instructions.ts'

export { askPrompt, descendants, describeToolUse, frozenNote, parseCpuTime, progressPrompt, type ProcessSample } from './overseer-text.ts'

export interface ProcessProbe {
  sample(rootPid: number): Promise<ProcessSample>
}

/** The real probe: one `ps` call per sample. Open files and connections are not read.
 *  A `ps` that cannot start or exits non-zero is a failed read, not an empty process tree. */
export const psProbe: ProcessProbe = {
  sample: (root) =>
    new Promise((resolve) => {
      const proc = spawn('ps', ['-A', '-o', 'pid=,ppid=,time='], { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      proc.stdout.on('data', (d) => (out += d))
      proc.on('error', (e) => resolve({ cpuMs: 0, pids: [], error: e.message }))
      proc.on('close', (code, signal) =>
        resolve(code === 0 ? descendants(out, root) : { cpuMs: 0, pids: [], error: `ps exited with ${signal ?? `code ${code}`}` }),
      )
    }),
}

export type Classify = {
  timeoutMs: number
  sessionDir: string
  signal?: AbortSignal
  /** Runs the call, so the caller can record it as a step with its cost (#ms-cost). `file` is
   *  the call's transcript. */
  record?: (file: string, call: () => Promise<HeadlessResult>) => Promise<HeadlessResult>
}

/** One classification call: no tools, a JSON object back, or undefined when there is none. */
async function classify(prompt: string, name: string, role: AgentRole, o: Classify): Promise<{ value?: Record<string, unknown>; error?: string; costUsd: number }> {
  const logPath = join(o.sessionDir, `${name}.jsonl`)
  const call = () => runHeadless(o.sessionDir, prompt, { timeoutMs: o.timeoutMs, tools: [], role, signal: o.signal, logPath })
  const out = await (o.record ? o.record(logPath, call) : call())
  const costUsd = out.costUsd ?? 0
  if (out.error) return { error: out.error, costUsd }
  const text = out.result ?? ''
  const raw = extractJson(text) ?? (() => {
    try {
      return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    } catch {
      return undefined
    }
  })()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'no JSON object in the answer', costUsd }
  return { value: raw as Record<string, unknown>, costUsd }
}

/** #lp-overseer-asks: allow or deny one ask. No verdict is a deny: nobody judged it safe. */
export async function classifyAsk(o: Classify & { brief: string; tool: string; input: unknown; name: string }): Promise<{ allow: boolean; comment: string; costUsd: number }> {
  const r = await classify(askPrompt(o), o.name, 'ask-classifier', o)
  if (!r.value || typeof r.value.allow !== 'boolean') {
    return { allow: false, comment: `The overseer could not judge this call (${r.error ?? 'no "allow" in the answer'}), so it is denied. Continue without it.`, costUsd: r.costUsd }
  }
  return { allow: r.value.allow, comment: typeof r.value.comment === 'string' ? r.value.comment : '', costUsd: r.costUsd }
}

/** #lp-overseer-progress: no verdict counts as "not looping". */
export async function classifyProgress(o: Classify & { brief: string; calls: string[]; name: string; session?: string }): Promise<{ looping: boolean; reason: string; costUsd: number }> {
  const r = await classify(progressPrompt(o), o.name, 'progress-classifier', o)
  if (!r.value || typeof r.value.looping !== 'boolean') return { looping: false, reason: `no verdict: ${r.error ?? 'no "looping" in the answer'}`, costUsd: r.costUsd }
  return { looping: r.value.looping, reason: typeof r.value.reason === 'string' ? r.value.reason : '', costUsd: r.costUsd }
}
