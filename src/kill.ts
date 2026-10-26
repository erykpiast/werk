// Kill criteria — #kill. Pure code: no I/O, so cli.ts and the tests share one definition.
import type { KillCriterion, KillForm, KillReason, KillTrigger } from './types.ts'

export const KILL_FORMS: KillForm[] = ['metric', 'manual', 'no-metric', 'revisit']
export const KILL_REASONS: KillReason[] = ['unclear', 'cheap', 'slow', 'values', 'constraint']

/** What each no-metric reason is revisited by — the table in #kill-shape. */
const REASON_TRIGGER: Record<KillReason, KillTrigger> = {
  unclear: 'date',
  cheap: 'none',
  slow: 'date',
  values: 'event',
  constraint: 'event',
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export type KillInput = Partial<Record<
  'form' | 'text' | 'source' | 'metric' | 'threshold' | 'window' | 'min-sample' | 'review-date' | 'reason' | 'fallback' | 'trigger',
  string
>>

/**
 * One criterion from the flags of `werk kill`. A machine-checkable criterion has a source,
 * a metric, a threshold and a window (#kill-shape). Every other form needs the words that
 * say why there is no metric. A missing part is an error that names the flag.
 */
export function buildCriterion(input: KillInput): KillCriterion | { error: string } {
  const form = input.form as KillForm | undefined
  if (!form || !KILL_FORMS.includes(form)) return { error: `--form must be one of ${KILL_FORMS.join(', ')}` }
  const missing = (names: (keyof KillInput)[]) => names.filter((n) => !input[n])
  const need = (names: (keyof KillInput)[]) => {
    const m = missing(names)
    return m.length ? { error: `--form ${form} also needs ${m.map((n) => `--${n}`).join(' ')}` } : null
  }
  if (input['review-date'] && !DATE.test(input['review-date'])) return { error: '--review-date must be YYYY-MM-DD' }
  let minSample: number | undefined
  if (input['min-sample'] !== undefined) {
    minSample = Number(input['min-sample'])
    if (!Number.isInteger(minSample) || minSample < 1) return { error: '--min-sample must be a whole number, 1 or more' }
  }

  const c: KillCriterion = { form, trigger: 'none', state: 'monitored' }
  if (input.fallback) c.fallback = input.fallback
  if (input.text) c.text = input.text

  if (form === 'metric') {
    const err = need(['source', 'metric', 'threshold', 'window'])
    if (err) return err
    Object.assign(c, { trigger: 'metric', source: input.source, metric: input.metric, threshold: input.threshold, window: input.window })
    if (minSample) c.minSample = minSample
  } else if (form === 'manual') {
    const err = need(['text'])
    if (err) return err
    c.trigger = input['review-date'] ? 'date' : 'event'
  } else if (form === 'no-metric') {
    const err = need(['reason', 'text'])
    if (err) return err
    const reason = input.reason as KillReason
    if (!KILL_REASONS.includes(reason)) return { error: `--reason must be one of ${KILL_REASONS.join(', ')}` }
    c.reason = reason
    c.trigger = REASON_TRIGGER[reason]
    if (c.trigger === 'date' && !input['review-date']) {
      return { error: `--reason ${reason} is revisited by a review date. Add --review-date YYYY-MM-DD` }
    }
  }
  if (input['review-date']) {
    c.reviewDate = input['review-date']
    if (form !== 'revisit') c.trigger = 'date'
  }
  return c
}

/** The one-line form of a criterion, for the CLI echo and the failure message. */
export function describe(c: KillCriterion): string {
  switch (c.form) {
    case 'metric':
      return `${c.source}: ${c.metric} ${c.threshold} over ${c.window}${c.minSample ? `, min sample ${c.minSample}` : ''}`
    case 'manual':
      return `manual test: ${c.text}`
    case 'no-metric':
      return `no metric (${c.reason}): ${c.text}`
    case 'revisit':
      return 'revisit at any time'
  }
}

type Option = { id: string; title: string }

/**
 * The prompt `werk status <id> decided` prints when no criterion is on record (#kill-ask).
 * The CLI message is the question, so no skill file has to remember to ask it. The drafts are
 * ready-to-run commands: the good answer is one paste away. A rejected option makes the
 * fallback, so a criterion that fires already points at something.
 */
export function killPrompt(id: string, options: Option[]): string {
  const fb = options[0] ? ` --fallback ${options[0].id}` : ''
  const lines = [
    `no kill criterion is on record. Answer one question first: what must become true to change this decision?`,
    `      - What would invalidate the hypothesis that made you choose this over the alternatives?`,
    `      - What makes this helpful? If that is not true in reality, we should consider killing it.`,
    `    Record an answer with one of these, then run status again:`,
    `      1. A metric (best — if it does not exist yet, building it is part of the decision):`,
    `         werk kill ${id} --form metric --source <data source> --metric "<what is measured>" --threshold "<> or < a value>" --window 7d --min-sample 100${fb}`,
    `      2. A test you run yourself:`,
    `         werk kill ${id} --form manual --text "I test this myself and see if it works"${fb}`,
    `      3. No metric, with the reason (${KILL_REASONS.join('|')}; slow and unclear also need --review-date YYYY-MM-DD):`,
    `         werk kill ${id} --form no-metric --reason values --text "<why>"${fb}`,
    `      4. Revisit at any time (valid, and recorded as such):`,
    `         werk kill ${id} --form revisit${fb}`,
  ]
  if (options.length) {
    lines.push(`    Rejected options a criterion can fall back to: ${options.map((o) => `${o.id} (${o.title})`).join('; ')}`)
  }
  return lines.join('\n')
}
