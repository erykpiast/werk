/**
 * The fan-out sample runner. See #al-sample-runner.
 *
 * #al-sample-when: climb the substrate ladder only as far as the fork needs. `tier: 'plan'`
 * is the bottom rung — plan text, no worktree, no build, one `claude -p` per sample, run from
 * the repository as it stands. `tier: 'output'` is #al-sample-build-isolation's first step up:
 * still no worktree, but each sample gets its own scratch directory to write an artifact into,
 * because the fork needs to be looked at, not read about. A worktree tier belongs to a built
 * option, not a plan-rung sample — see prototype.ts and #al-sample-proto-agent.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentEnv } from './instructions.ts'

export type SampleResult = {
  id: number
  /** The model's raw stdout — the decision manifest, ideally nothing else. */
  manifest: string
  /** Set when the sample produced nothing usable: a timeout or a non-zero exit with no output. */
  error?: string
  /** Only set for `tier: 'output'` — the one path this sample was allowed to write to. */
  outputDir?: string
}

/**
 * The no-questions contract. A headless sample cannot stop at a question, so it may not ask
 * one — it must pick and write down every pick instead. The one-line-per-field shape is what
 * `findForks` parses back apart. `writeRule` is the one sentence that differs by tier.
 */
const NO_QUESTIONS_CONTRACT = (writeRule: string) => `You are one of several independent samples run from the same brief, to find where the brief is ambiguous. You may not ask a question, and you may not use AskUserQuestion. Where the brief leaves more than one reasonable reading, pick the one you think best and record the pick — never guess at what to write without also recording that you had to choose.

${writeRule}

Answer with a decision manifest and nothing else: one line per requirement choice you made, in the exact form
  <field>: <choice> — <one-line reason>
Use a short, stable name for <field> so it lines up with the other samples' answers to the same fork. List every point where the brief admitted more than one reasonable reading. If the brief is unambiguous, say so with no manifest lines.`

/** `tier: 'plan'` — no filesystem access at all beyond reading. */
const PLAN_WRITE_RULE = 'Do not edit or write any file. Read only as needed to make each pick.'

/** #al-sample-build-isolation: `tier: 'output'` may write, but only inside its own scratch
 *  directory — the rest of the checkout stays read-only. */
function outputWriteRule(dir: string): string {
  return `The repository is read-only except for one path: ${dir} — it already exists and is yours alone. Use Write, Edit, or Bash only to produce an artifact there; do not create, edit, or delete anything at any other path.`
}

const DEFAULT_TOOLS = ['Read', 'Grep', 'Glob']
/** #al-sample-build-isolation part 1: the output tier adds the tools a scratch-directory
 *  artifact needs, on top of the read-only default. */
const OUTPUT_TOOLS = [...DEFAULT_TOOLS, 'Write', 'Edit', 'Bash']
const DEFAULT_N = 3
/** #al-sample-budget: a sample run costs real tokens and minutes, so the cap is not optional. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

function runOne(
  cwd: string,
  brief: string,
  id: number,
  tools: string[],
  timeoutMs: number,
  outputDir?: string,
): Promise<SampleResult> {
  return new Promise((resolve) => {
    const writeRule = outputDir ? outputWriteRule(outputDir) : PLAN_WRITE_RULE
    const prompt = `${NO_QUESTIONS_CONTRACT(writeRule)}\n\nBrief:\n${brief}`
    // The prompt is a positional argument, but --allowedTools is variadic and swallows
    // anything after it — see agent.ts's own note on this. Put the prompt first.
    const proc = spawn('claude', ['--print', prompt, '--allowedTools', ...tools], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: agentEnv('sampler'),
    })
    let out = ''
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', (e) => {
      clearTimeout(timer)
      resolve({ id, manifest: '', error: e.message, outputDir })
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        return resolve({ id, manifest: out.trim(), error: `killed after ${timeoutMs}ms wall-clock cap`, outputDir })
      }
      if (code !== 0 && !out.trim()) {
        return resolve({ id, manifest: '', error: err.trim().slice(-2000) || `exit ${code}`, outputDir })
      }
      resolve({ id, manifest: out.trim(), outputDir })
    })
  })
}

/** Fan out N independent samples of the same brief. Runs them concurrently; #al-sample-budget
 *  is the budget control: `n` and `timeoutMs`, both capped by default. `tier: 'output'`
 *  gives each sample its own `os.tmpdir()/werk-sample-<runId>-<i>/` per #al-sample-build-isolation
 *  part 1 — `runId` should be stable for one fan-out call so the directories are predictable. */
export async function sample(
  cwd: string,
  brief: string,
  opts: { n?: number; tools?: string[]; timeoutMs?: number; tier?: 'plan' | 'output'; runId?: string } = {},
): Promise<SampleResult[]> {
  const n = opts.n ?? DEFAULT_N
  const tier = opts.tier ?? 'plan'
  const tools = opts.tools ?? (tier === 'output' ? OUTPUT_TOOLS : DEFAULT_TOOLS)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const runId = opts.runId ?? String(Date.now())
  return Promise.all(
    Array.from({ length: n }, (_, i) => {
      if (tier !== 'output') return runOne(cwd, brief, i, tools, timeoutMs)
      const outputDir = join(tmpdir(), `werk-sample-${runId}-${i}`)
      mkdirSync(outputDir, { recursive: true })
      return runOne(cwd, brief, i, tools, timeoutMs, outputDir)
    }),
  )
}

export type Fork = {
  field: string
  choices: Array<{ choice: string; reason: string; sampleIds: number[] }>
}

/** A fork the model proposed but code could not stand behind — printed, never silently
 *  dropped, same as #al-diff-cli's rejected ops. */
export type RejectedFork = { field: string; reason: string }

/**
 * #al-sample-diverge, second pass. The first pass grouped manifest lines by exact field
 * name and got both a false negative (same fork, two names, never joined — see
 * `cli-vs-web`/`agent-authority` on #al-sample-build:ex0) and a false positive (two
 * differently-worded but agreeing `undo` lines counted as a disagreement).
 *
 * This clusters by meaning instead: one model call reads every manifest side by side and
 * groups by what was actually decided. #al-diff-cli's pattern one level up applies again —
 * the agent supplies the structure, code verifies the claim against the artifact before it
 * is trusted. Here the artifact is the set of raw manifests; verification is structural
 * (every claimed sample id is real, no sample double-booked within one fork, at least two
 * distinct samples actually disagree) — code cannot check that a paraphrase is faithful to
 * its source line, only that the fork it describes is internally consistent.
 */
export async function findForks(
  cwd: string,
  results: SampleResult[],
  opts: { timeoutMs?: number } = {},
): Promise<{ forks: Fork[]; rejected: RejectedFork[] }> {
  const usable = results.filter((r) => r.manifest.trim())
  if (usable.length < 2) return { forks: [], rejected: [] }

  const body = usable.map((r) => `=== sample ${r.id} ===\n${r.manifest}`).join('\n\n')
  const prompt = `${CLUSTER_CONTRACT}\n\n${body}`
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const raw = await new Promise<SampleResult>((resolve) => {
    // No tool access: this call only has to read the manifests already in its prompt.
    // `--allowedTools` with zero items is a Commander argument error, so `--tools ""` is
    // the CLI's own way to say "disable every tool".
    const proc = spawn('claude', ['--print', prompt, '--tools', ''], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: agentEnv('clusterer') })
    let out = ''
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', (e) => {
      clearTimeout(timer)
      resolve({ id: -1, manifest: '', error: e.message })
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (timedOut) return resolve({ id: -1, manifest: out.trim(), error: `killed after ${timeoutMs}ms wall-clock cap` })
      if (code !== 0 && !out.trim()) return resolve({ id: -1, manifest: '', error: err.trim().slice(-2000) || `exit ${code}` })
      resolve({ id: -1, manifest: out.trim() })
    })
  })
  if (!raw.manifest) return { forks: [], rejected: [{ field: '(clustering call)', reason: raw.error ?? 'produced no output' }] }

  let parsed: { forks?: unknown }
  try {
    parsed = JSON.parse(stripFence(raw.manifest))
  } catch {
    return { forks: [], rejected: [{ field: '(clustering call)', reason: 'did not return valid JSON' }] }
  }

  const validIds = new Set(usable.map((r) => r.id))
  const forks: Fork[] = []
  const rejected: RejectedFork[] = []
  for (const f of Array.isArray(parsed.forks) ? parsed.forks : []) {
    const field = typeof f?.field === 'string' ? f.field.trim() : ''
    if (!field || !Array.isArray(f.choices)) {
      rejected.push({ field: field || '(unnamed)', reason: 'malformed fork shape' })
      continue
    }
    const seen = new Set<number>()
    let contradicted = false
    const choices: Fork['choices'] = []
    for (const c of f.choices) {
      const sampleIds = (Array.isArray(c?.sampleIds) ? c.sampleIds : []).filter(
        (id: unknown): id is number => typeof id === 'number' && validIds.has(id),
      )
      for (const id of sampleIds) {
        // A sample cannot make two different choices for the same fork. Real disagreement
        // is between samples, not within one — this is the model contradicting itself.
        if (seen.has(id)) contradicted = true
        seen.add(id)
      }
      if (sampleIds.length && typeof c.choice === 'string') {
        choices.push({ choice: c.choice, reason: typeof c.reason === 'string' ? c.reason : '', sampleIds })
      }
    }
    if (contradicted) {
      rejected.push({ field, reason: 'a sample was claimed for two different choices in the same fork' })
      continue
    }
    // A fork needs at least two choices, and at least two distinct samples behind them —
    // otherwise it is not disagreement, and #al-sample-when says do not ask about it.
    if (choices.length < 2 || seen.size < 2) {
      rejected.push({ field, reason: 'fewer than two samples actually disagreed' })
      continue
    }
    forks.push({ field, choices })
  }
  return { forks, rejected }
}

const CLUSTER_CONTRACT = `Below are decision manifests from several independent samples of the same brief. Each sample chose its own wording, so the same real fork may appear under different field names, and different real decisions may happen to share a name.

Find every real fork: a point where two or more samples made genuinely different choices for the same underlying decision. Group by what was decided, not by how it was labelled. If every sample that addressed a point agreed on it, even in different words, that is not a fork — leave it out.

Output ONLY a JSON object, no other text, no code fence, matching exactly:
{
  "forks": [
    {
      "field": "short_stable_name_you_choose",
      "choices": [
        { "sampleIds": [0, 2], "choice": "one-line paraphrase of what these samples decided", "reason": "one-line, drawn from their stated reasons" }
      ]
    }
  ]
}

Each sampleIds entry must list the samples that made that specific choice — a sample may appear in at most one choice per fork. Omit a sample from a fork entirely if it said nothing relevant to that decision. Do not invent a choice for a sample that did not make one.`

/** Strip a ```json fence if the model added one anyway. */
function stripFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return m ? m[1].trim() : text
}
