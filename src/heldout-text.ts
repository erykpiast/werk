/**
 * The pure half of the held-out set: where the steps live, what the step author and the binder
 * are told, how their answers are read, and the follow-up ticket's text. Split from heldout.ts
 * so the 90% line gate can hold it without holding git and the agents — see
 * #werk-test-scope-src0-pure-scope.
 */
import { join } from 'node:path'
import { DECISION_MARK } from './decision-pass.ts'
import { extractJson } from './grade-parse.ts'
import { NO_QUESTIONS, renderCards } from './loop-prompt.ts'
import type { ParsedTicket } from './ticket.ts'
import type { GraphNode } from './types.ts'

/** One held-out step: a Given/When/Then scenario. `id` is "<ticket number>.<k>". */
export type Step = { id: string; ticket: string; text: string }

/** `unbuilt`: the step needs a capability that the ticket named in `owner` builds, and that ticket
 *  is not merged yet (#st-heldout-unbuilt-capability). */
export type StepVerdict = { id: string; result: 'pass' | 'fail' | 'binder-error' | 'unbuilt'; detail: string; owner?: string }

/** A ticket of the run that is not merged yet: what the binder may name as the owner of a
 *  capability the main line lacks. */
export type Unmerged = { id: string; title: string }

/** The directory the binder writes its tests into, inside its throwaway worktree. */
export const BOUND_DIR = '.werk-heldout'

export const heldoutDir = (cwd: string, run: string) => join(cwd, '.werk', 'heldout', run)

const KEYWORD = /^(Scenario|Given|When|Then|And|But)\b/

/** The scenarios in an author's answer. A block with no Then is not a step. */
export function parseSteps(text: string): string[] {
  const lines = text
    .replace(/```[a-z]*\n?/g, '')
    .split('\n')
    .map((l) => l.trim())
  const blocks: string[][] = []
  let cur: string[] | undefined
  for (const l of lines) {
    if (!KEYWORD.test(l)) {
      if (l === '') cur = undefined
      continue
    }
    // A new scenario starts at "Scenario:", or at a Given that follows a Then.
    const startsNew = l.startsWith('Scenario') || (l.startsWith('Given') && !!cur && cur.some((x) => x.startsWith('Then')))
    if (!cur || startsNew) {
      cur = []
      blocks.push(cur)
    }
    cur.push(l)
  }
  return blocks
    .filter((b) => b.some((l) => l.startsWith('Then')) && b.some((l) => /^(Given|When)\b/.test(l)))
    .map((b) => (b[0].startsWith('Scenario') ? b : [`Scenario: ${b.find((l) => l.startsWith('When')) ?? b[0]}`, ...b]).join('\n'))
}

export const ticketNum = (id: string) => id.split('/').pop()!

export function stepsFile(cwd: string, run: string, ticketId: string): string {
  return join(heldoutDir(cwd, run), `${ticketNum(ticketId)}.steps.md`)
}

/** #st-heldout-step-fresh: beside each steps file, the version of each card its steps were
 *  written from, by card id. */
export function sourcesFile(cwd: string, run: string, ticketId: string): string {
  return join(heldoutDir(cwd, run), `${ticketNum(ticketId)}.sources.json`)
}

/** The source cards whose version changed since the steps were written, or that are no longer
 *  a decided card of the ticket. A steps file with no record has an unknown source: every
 *  recorded-nothing file counts as changed, with the reason given. */
export function changedSources(recorded: Record<string, string> | undefined, now: Record<string, string>): string[] {
  if (!recorded) return ['the steps record no source cards']
  return Object.keys(recorded).filter((id) => now[id] !== recorded[id])
}

/** The step author's answer when every step is dropped. */
export const NO_STEPS = 'NO STEPS'

export const stepName = (s: Step) => `${s.id} ${s.text.split('\n')[0].replace(/^Scenario:\s*/, '')}`

export function authorPrompt(p: { ticket: ParsedTicket; stories: string[]; cards: GraphNode[] }): string {
  return `You are the step author of a held-out test set. ${NO_QUESTIONS}

A builder agent is building the ticket below right now. You will never see its code. Write the user paths that must work once the ticket is built, as Given/When/Then scenarios. Another agent turns them into tests later, and the builder never sees them.

Rules for a scenario:

- It follows one path through the whole product, the way a user does. It does not test one part alone.
- Each line names a user action or a thing the user sees. It names no selector, file, function, or command-line flag the user would not type.
- Each scenario starts with "Scenario: <name>", then Given, When, Then lines; And and But continue the line above.

Write between two and five scenarios. Answer with only the scenarios, separated by blank lines.

## The ticket: ${p.ticket.title}

### What to build

${p.ticket.whatToBuild}

### Acceptance criteria

${p.ticket.acceptance.map((a) => `- ${a}`).join('\n')}

### User stories it delivers

${p.stories.length ? p.stories.join('\n') : '(none)'}

## Decided cards it builds

${renderCards(p.cards)}`
}

/** #st-heldout-step-fresh: the step author again, after a card its steps came from changed. */
export function rewritePrompt(p: { ticket: ParsedTicket; stories: string[]; cards: GraphNode[]; steps: string[]; changed: string[] }): string {
  return `${authorPrompt(p)}

## Your earlier scenarios

You wrote the scenarios below for this ticket. Since then these cards changed or went: ${p.changed.map((c) => (c.includes(' ') ? c : `#${c}`)).join(', ')}. The cards above are the current ones.

Check each scenario against the current cards. Keep a scenario the cards still ask for, word for word. Rewrite a scenario the cards now ask for in another way. Drop a scenario that asks for what the cards no longer ask for, or forbid. Do not add a new scenario. The rule of two to five scenarios does not apply here.

Answer with only the scenarios you keep or rewrite, in their old order, separated by blank lines. If you drop every one, answer with only ${NO_STEPS}.

${p.steps.join('\n\n')}`
}

/** A red step with what the binder saw, for the step author to read against its cards. */
export type RedStep = Step & { detail: string }

/** #st-heldout-step-contradiction: the step author reads each red step against the cards it was
 *  written from, before the step files anything. */
export function contradictionPrompt(p: { ticket: ParsedTicket; stories: string[]; cards: GraphNode[]; red: RedStep[] }): string {
  return `${authorPrompt(p)}

## Red steps

Each scenario below was red on the merged product. A step can be red because the code is wrong, or because you misread a decided card when you wrote it. Read each one against the cards above. Does a decided card say something the scenario contradicts, so that no code could satisfy both? A scenario the code fails to do is not a contradiction.

Answer with only a JSON array, one object per scenario: {"id": "<step id>", "verdict": "agrees" | "contradicts", "card": "<card id, for contradicts>", "why": "<what the card says and what the step says>"}. Do not write new scenarios here.

${p.red.map((s) => `### ${s.id}\n\n${s.text}\n\nWhat the binder saw: ${s.detail || '(nothing)'}`).join('\n\n')}`
}

/** The steps the author found to contradict a decided card. A step the answer leaves out, or an
 *  answer that cannot be read, agrees: the build follow-up is the safe default. */
export function parseContradictions(text: string, ids: string[]): Map<string, { card: string; why: string }> {
  const out = new Map<string, { card: string; why: string }>()
  const raw = extractJson(text)
  if (!Array.isArray(raw)) return out
  for (const x of raw) {
    if (x?.verdict !== 'contradicts' || typeof x.id !== 'string' || !ids.includes(x.id)) continue
    out.set(x.id, { card: typeof x.card === 'string' ? x.card.replace(/^#/, '') : '', why: typeof x.why === 'string' ? x.why : '' })
  }
  return out
}

/** Beside each steps file, the steps that wait for a decision follow-up: their ids, the ticket
 *  that judges them, and the card each contradicts. */
export function holdFile(cwd: string, run: string, ticketId: string): string {
  return join(heldoutDir(cwd, run), `${ticketNum(ticketId)}.held.json`)
}
export type Hold = { decision: string; steps: string[]; cards: string[] }

/** The decision follow-up's ticket text: judge the step against the card, propose a card, and
 *  build the code the proposal asks for when it changed a decided card. */
export function decisionStepText(o: { of: string; steps: Array<{ step: Step; card: string; why: string }>; cites: string[]; checks: string[]; touches?: string[] }): string {
  return `title: Judge ${o.steps.length === 1 ? 'a held-out step' : `${o.steps.length} held-out steps`} against a decided card
cites: ${[...new Set([...o.cites, ...o.steps.map((s) => s.card).filter(Boolean)])].join(', ')}
blocked_by:
stories:
touches: ${(o.touches ?? []).join(', ')}

## What to build

${DECISION_MARK} a held-out step of ${o.of} contradicts a decided card, so no code can satisfy both. Decide whether the card or the step is right, and propose the answer as a card. If the answer changes what the product does, build it.

${o.steps.map((s) => `${s.step.text}\n\nIt contradicts #${s.card}: ${s.why}`).join('\n\n')}

## Acceptance criteria

${o.steps.map((s) => `- [ ] A proposed card answers whether #${s.card} or "${s.step.text.split('\n')[0].replace(/^Scenario:\s*/, '')}" is right, and the code follows the card that holds`).join('\n')}

## Checks

${o.checks.map((c) => `- \`${c}\``).join('\n')}
`
}

export function binderPrompt(steps: Step[], unmerged: Unmerged[] = []): string {
  return `You are the binder of a held-out test set. ${NO_QUESTIONS}

This checkout is the merged product. Below are user paths written as Given/When/Then steps. For each step, read the code, find what the step names, and write a test for it in this project's own stack. Put every test under \`${BOUND_DIR}/\` and run them.

Two rules you must keep:

1. You cannot change the text of a step. You only map it to actions and checks.
2. You do not make a test pass. When a test fails, record the failure and move on. Fix only your own errors, such as a wrong name or a typo in your test. Do not change any file outside \`${BOUND_DIR}/\`; a change there voids your whole report. Do not add a wait, a reload, or a retry that a user would not do.

"Not found" can be your error or a missing feature. Say which one you think it is.
${unmerged.length ? `
A step can fail because the product lacks a capability it reaches the product through: an operation of the command line, a screen or route, a field or kind of event in the log, a behaviour of an agent. When that capability is the job of one of these tickets, which are not merged yet, answer "unbuilt" and put the ticket's id in "owner". When it is the job of the step's own ticket, or of none of them, answer "fail".

${unmerged.map((t) => `- ${t.id}: ${t.title}`).join('\n')}
` : ''}
Answer with only a JSON array, one object per step, every step below included:

[{"id": "<step id>", "result": "pass" | "fail" | "binder-error"${unmerged.length ? ' | "unbuilt"' : ''}, "detail": "<what the test did and what it saw>"${unmerged.length ? ', "owner": "<ticket id, for unbuilt only>"' : ''}}]

"fail" means the product does not do what the step says. "binder-error" means you could not write a working test for the step.

## Steps

${steps.map((s) => `### ${s.id}\n\nTicket: ${s.ticket}\n\n${s.text}`).join('\n\n')}`
}

/** The verdict for each step, or why the answer is unreadable. A step left out is a binder error.
 *  An `unbuilt` step counts only when its owner is one of `unmerged` and not the step's own
 *  ticket: a capability the source ticket forgot is a red step (#st-heldout-unbuilt-capability). */
export function parseVerdicts(text: string, steps: Step[], unmerged: string[] = []): StepVerdict[] | string {
  const raw = extractJson(text)
  if (!Array.isArray(raw)) return 'the binder did not answer with a JSON array'
  const byId = new Map<string, StepVerdict>()
  for (const x of raw) {
    if (typeof x?.id !== 'string') continue
    const detail = typeof x.detail === 'string' ? x.detail : ''
    const step = steps.find((s) => s.id === x.id)
    if (x.result === 'unbuilt') {
      const owned = typeof x.owner === 'string' && unmerged.includes(x.owner) && x.owner !== step?.ticket
      byId.set(x.id, owned ? { id: x.id, result: 'unbuilt', detail, owner: x.owner } : { id: x.id, result: 'fail', detail })
      continue
    }
    const result = x.result === 'pass' || x.result === 'fail' ? x.result : 'binder-error'
    byId.set(x.id, { id: x.id, result, detail })
  }
  return steps.map((s) => byId.get(s.id) ?? { id: s.id, result: 'binder-error', detail: 'the binder gave no verdict for this step' })
}

/** The follow-up ticket's text: the failed steps word for word, nothing else of the set. */
/** `touches` is the followed ticket's: the fix lands in the modules whose merge went red, and
 *  the scheduler keeps the follow-up apart from tickets that touch them (#st-build-parallel). */
export function followUpText(o: { steps: Step[]; cites: string[]; checks: string[]; touches?: string[] }): string {
  return `title: Make ${o.steps.length === 1 ? 'a failed user path' : `${o.steps.length} failed user paths`} work
cites: ${o.cites.join(', ')}
blocked_by:
stories:
touches: ${(o.touches ?? []).join(', ')}

## What to build

After a merge, a user path that must work does not work on the merged product. Make it work. Each path, word for word:

${o.steps.map((s) => s.text).join('\n\n')}

## Before you build (#st-heldout-unbuilt-close)

Check two facts for each path. First, the path needs a capability that the main line does not provide and that another ticket, one that is not merged yet, builds. A capability is an operation of the command line, a screen or route, a field or kind of event in the log, or a behaviour of an agent. Second, the seam behind the path has unit tests that state its outcome, and they pass on the main line. When both facts hold for every path, change no code: the paths are not run until that ticket merges. When the second fact fails for a path, write the missing unit test at the seam and change nothing else for that path.

## Acceptance criteria

${o.steps.map((s) => `- [ ] A user can follow "${s.text.split('\n')[0].replace(/^Scenario:\s*/, '')}" from start to end, or both facts above hold for it and a passing unit test at its seam states its outcome`).join('\n')}

## Checks

${o.checks.map((c) => `- \`${c}\``).join('\n')}
`
}

/** The paths in `git status --porcelain -z` output, as git wrote them. A rename or a copy
 *  carries its old path as the next entry, and that entry is skipped. */
export function changedPaths(z: string): string[] {
  const out: string[] = []
  const entries = z.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.length < 4) continue
    out.push(e.slice(3))
    if (e[0] === 'R' || e[0] === 'C') i++
  }
  return out
}
