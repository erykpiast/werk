/**
 * Plan-stage cost, rebuilt from the agent transcripts that past sessions left on disk.
 * See #ms-cost for the unit and the grain, and #ms-cost-history for how a past turn is
 * counted. Everything here is pure: the transcript reader in cost-history.ts feeds it, and
 * the report is a fold over the plan-turn events of the pipeline log (#ms-store).
 */
import type { PipelineEvent, PlanTurnEnded } from './pipeline.ts'
import type { Event } from './types.ts'

/** Dollars per million tokens. Cache writes are a multiple of input, by lifetime. */
export type Price = { input: number; output: number; cacheRead: number }

/**
 * Anthropic first-party API rates, valid from 2026-09-25. A session run on a subscription
 * did not pay these, so the dollars are an API-equivalent cost, not a bill.
 */
export const PRICES_FROM = '2026-09-25'
export const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
}
const WRITE_5M = 1.25
const WRITE_1H = 2
/** Fast mode runs the same model at twice the standard rate. */
const FAST = 2

/** The usage block of one model response, as the transcript records it. */
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  speed?: string
}

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const ZERO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export function tokensOf(u: Usage): Tokens {
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  }
}

export function addTokens(a: Tokens, b: Tokens, scale = 1): Tokens {
  return {
    input: a.input + b.input * scale,
    output: a.output + b.output * scale,
    cacheRead: a.cacheRead + b.cacheRead * scale,
    cacheWrite: a.cacheWrite + b.cacheWrite * scale,
  }
}

/** A dated id like claude-haiku-4-5-20251001 prices as its base id. */
function priceFor(model: string): Price | null {
  return PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, '')] ?? null
}

/**
 * Dollars for one response, or null when the model has no price. A cache write with no
 * lifetime split is priced as a 5-minute write, the cheaper reading.
 */
export function dollars(model: string, u: Usage): number | null {
  const p = priceFor(model)
  if (!p) return null
  const w = u.cache_creation_input_tokens ?? 0
  const w1h = Math.min(w, u.cache_creation?.ephemeral_1h_input_tokens ?? 0)
  const w5m = w - w1h
  const perM =
    (u.input_tokens ?? 0) * p.input +
    (u.output_tokens ?? 0) * p.output +
    (u.cache_read_input_tokens ?? 0) * p.cacheRead +
    w5m * p.input * WRITE_5M +
    w1h * p.input * WRITE_1H
  return (perM / 1e6) * (u.speed === 'fast' ? FAST : 1)
}

/** A content block of an assistant response; only tool calls matter here. */
export type Block = { type: string; name?: string; input?: any }

/** The map verbs that write to a card. The first id after the verb is the card written. */
const MAP_VERBS = [
  'add', 'link', 'unlink', 'status', 'reopen', 'say', 'edit', 'retitle', 'kill', 'rederive',
  'accept', 'discard', 'remove', 'restore', 'quote', 'move', 'propose',
]
const MAP_WRITE = new RegExp(
  String.raw`(?:cli\.ts|\bwerk)\s+(?:${MAP_VERBS.join('|')})\s+['"]?#?([A-Za-z0-9][\w.:-]*)`,
  'g',
)
const CODE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** An option, source or excerpt id (`card:opt0`) counts toward the card it hangs on. */
export function cardOf(id: string): string {
  return id.split(':')[0]
}

/**
 * What one response did: the cards it wrote through the CLI, and whether it changed code.
 * A file under the map's own directory or under a temp directory is not code.
 */
export function classify(blocks: Block[]): { cards: string[]; code: boolean } {
  const cards = new Set<string>()
  let code = false
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue
    if (b.name === 'Bash' && typeof b.input?.command === 'string') {
      for (const m of b.input.command.matchAll(MAP_WRITE)) cards.add(cardOf(m[1]))
    } else if (b.name && CODE_TOOLS.has(b.name)) {
      const path = String(b.input?.file_path ?? b.input?.notebook_path ?? '')
      if (!/\/\.werk\/|^\/tmp\/|^\/private\/|\/\.claude\//.test(path)) code = true
    }
  }
  return { cards: [...cards], code }
}

/** The card a chat-pane prompt names as open on the map, if any. */
export function openCard(prompt: string): string | null {
  const m = prompt.match(/\[(?:the map is now at|still on) #([A-Za-z0-9][\w.:-]*)/)
  return m ? m[1] : null
}

/** One response inside a turn, already priced and classified. */
export type Response = {
  /** When the response arrived. A part of a turn starts after the last response of the part before. */
  at?: string
  model: string
  tokens: Tokens
  dollars: number
  unpriced: boolean
  cards: string[]
  code: boolean
}

/** One turn: a person's message and every response up to the next message. */
export type Turn = {
  session: string
  /** The prompt's own id in the session. */
  turnId: string
  at: string
  /** When the last response of the turn arrived. */
  endAt: string
  wallSec: number
  /** The open card, for a chat-pane turn. Null for a terminal turn. */
  openCard: string | null
  responses: Response[]
  /** Responses of subagents started in this turn. They follow the turn's ratio. */
  subagent: Response[]
}

/**
 * The facts of one turn, as its step-ended event in the pipeline log holds them. A chat-pane
 * turn with no open-card line names its conversation's home card.
 */
export function planTurn(turn: Turn, homeCard: string | null, prices = PRICES_FROM): PlanTurnEnded {
  const t = turnTotals(turn)
  const written = new Set<string>()
  for (const r of turn.responses) r.cards.forEach(c => written.add(c))
  return {
    stage: 'plan',
    step: 'turn',
    session: turn.session,
    turnId: turn.turnId,
    card: turn.openCard ?? homeCard,
    cardsWritten: [...written],
    mapResponses: turn.responses.filter(r => r.cards.length > 0).length,
    codeResponses: turn.responses.filter(r => r.cards.length === 0 && r.code).length,
    responses: turn.responses.length,
    subagentResponses: turn.subagent.length,
    ms: Math.round(turn.wallSec * 1000),
    costUsd: t.dollars,
    tokens: t.tokens,
    unpriced: t.unpriced,
    prices,
    result: 'ok',
  }
}

/** The key of one part of one turn. An event written before parts existed is part 0. */
export const partKey = (t: { session: string; turnId: string; part?: number }) => `${t.session}\u0000${t.turnId}\u0000${t.part ?? 0}`

/**
 * What a turn added since the parts the log holds (#ms-store-plan). A background task can wake
 * a turn after its result: the wake's responses belong to the same prompt, so they are the
 * turn's next part, not a second record of it. Returns null when nothing is new.
 *
 * An event written before parts existed has no subagent count; its subagents are all taken as
 * recorded. Subagent responses are compared in time order, because a subagent started by a
 * wake can sort before older ones by its file name.
 */
export function nextPart(turn: Turn, recorded: PlanTurnEnded[]): (Turn & { part: number }) | null {
  const mainDone = recorded.reduce((n, p) => n + p.responses, 0)
  const subDone = recorded.some(p => p.subagentResponses === undefined) ? Infinity : recorded.reduce((n, p) => n + (p.subagentResponses ?? 0), 0)
  const subagent = [...turn.subagent].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  const responses = turn.responses.slice(mainDone)
  const newSub = subDone === Infinity ? [] : subagent.slice(subDone)
  if (responses.length === 0 && newSub.length === 0) return null
  const part = recorded.length === 0 ? 0 : Math.max(...recorded.map(p => p.part ?? 0)) + 1
  const from = part === 0 ? turn.at : (turn.responses[mainDone - 1]?.at ?? turn.at)
  const ats = [...responses, ...newSub].map(r => r.at).filter((a): a is string => !!a)
  return { ...turn, part, responses, subagent: newSub, wallSec: activeSeconds(from, ats) }
}

/** How a turn's cost is shared out: plan cost per card, and the rest. */
export type Allocation = {
  /** Fraction of the turn that is plan cost, 0 to 1. */
  plan: number
  /** The part of the plan fraction that is the prototype step (#st-six). The rest is refinement. */
  prototype: number
  /** Each card's share of the plan part. The shares add up to 1. */
  cards: Record<string, number>
  reason: 'chat-pane' | 'map-write' | 'mixed' | 'code-only' | 'no-map-write'
}

/**
 * The #ms-cost-history rule. A chat-pane turn is plan cost for its open card. A terminal
 * turn is plan cost only when it wrote to the map, split equally over the cards it wrote.
 * Inside a plan turn, a response that changed code is prototype cost and a response that
 * wrote to the map is refinement; every other response follows that ratio.
 */
export function allocate(t: PlanTurnEnded): Allocation {
  const map = t.mapResponses
  const code = t.codeResponses
  const prototype = map + code === 0 ? 0 : code / (map + code)
  if (t.card) return { plan: 1, prototype, cards: { [cardOf(t.card)]: 1 }, reason: 'chat-pane' }
  if (map === 0) return { plan: 0, prototype: 0, cards: {}, reason: code ? 'code-only' : 'no-map-write' }
  const cards = [...new Set(t.cardsWritten.map(cardOf))]
  const share = Object.fromEntries(cards.map(c => [c, 1 / cards.length]))
  return { plan: 1, prototype, cards: share, reason: code === 0 ? 'map-write' : 'mixed' }
}

export function turnTotals(turn: Turn): { dollars: number; tokens: Tokens; unpriced: number } {
  let dollars = 0
  let tokens = ZERO_TOKENS
  let unpriced = 0
  for (const r of [...turn.responses, ...turn.subagent]) {
    dollars += r.dollars
    tokens = addTokens(tokens, r.tokens)
    if (r.unpriced) unpriced++
  }
  return { dollars, tokens, unpriced }
}

/**
 * A gap longer than this between two responses of one turn is idle: a background task woke
 * the turn again, hours after its prompt. Idle time is not wall time.
 */
export const IDLE_SEC = 15 * 60

/** Wall time from the prompt to the last response, without the idle gaps. */
export function activeSeconds(promptAt: string, responseAts: string[]): number {
  const times = [Date.parse(promptAt), ...responseAts.map(t => Date.parse(t))].sort((a, b) => a - b)
  let sec = 0
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] - times[i - 1]) / 1000
    if (gap <= IDLE_SEC) sec += gap
  }
  return sec
}

/** Median, 90th percentile and maximum. #ms-cost asks for these, not a mean. */
export function distribution(values: number[]): { n: number; median: number; p90: number; max: number } {
  if (values.length === 0) return { n: 0, median: 0, p90: 0, max: 0 }
  const s = [...values].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]
  return { n: s.length, median: at(0.5), p90: at(0.9), max: s[s.length - 1] }
}

/** The day each card first became decided, from the decision log. */
export function decidedDays(events: Event[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of events) {
    const p: any = e.payload
    const decided =
      (e.type === 'status.set' && p?.status === 'decided') ||
      ((e.type === 'node.added' || e.type === 'node.proposed') && p?.status === 'decided' && (p.kind ?? 'card') === 'card')
    if (decided && p.id && !out.has(p.id)) out.set(p.id, e.at.slice(0, 10))
  }
  return out
}

/** Every part of every plan turn in the pipeline log, each part once even if it was written twice. */
export function planTurns(events: PipelineEvent[]): { at: string; turn: PlanTurnEnded }[] {
  const seen = new Set<string>()
  const out: { at: string; turn: PlanTurnEnded }[] = []
  for (const e of events) {
    if (e.type !== 'step.ended' || e.payload.step !== 'turn') continue
    const turn = e.payload as PlanTurnEnded
    const key = partKey(turn)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ at: e.at, turn })
  }
  return out
}

/** A card's plan cost. `dollars` is the whole of it; `prototype` is the part of it spent on code. */
export type CardCost = { card: string; dollars: number; prototype: number; wallSec: number; turns: number; tokens: Tokens }
export type DayCost = { day: string; plan: number; prototype: number; notPlan: number; decided: number; perDecided: number | null }

export type PlanCost = {
  prices: string[]
  sessions: { chatPane: number; terminal: number }
  dollars: { plan: number; prototype: number; planChatPane: number; planTerminal: number; notPlan: number }
  reasons: Record<string, { turns: number; dollars: number }>
  unpricedResponses: number
  cards: CardCost[]
  days: DayCost[]
  perCard: ReturnType<typeof distribution>
  perDecidedCardPerDay: ReturnType<typeof distribution>
}

/**
 * Plan cost per card and per day, folded from the pipeline log's plan turns by the rule in
 * #ms-cost-history. A turn counts in the day it ended. The per-day denominator is the cards
 * that first became decided that day.
 */
export function foldPlanCost(pipeline: PipelineEvent[], decisions: Event[]): PlanCost {
  const cards = new Map<string, CardCost>()
  const days = new Map<string, DayCost>()
  const reasons: PlanCost['reasons'] = {}
  const dollars = { plan: 0, prototype: 0, planChatPane: 0, planTerminal: 0, notPlan: 0 }
  const chatPane = new Set<string>()
  const allSessions = new Set<string>()
  const prices = new Set<string>()
  let unpriced = 0
  const day = (d: string) => {
    const x = days.get(d) ?? { day: d, plan: 0, prototype: 0, notPlan: 0, decided: 0, perDecided: null }
    days.set(d, x)
    return x
  }

  for (const { at, turn } of planTurns(pipeline)) {
    allSessions.add(turn.session)
    if (turn.card) chatPane.add(turn.session)
    prices.add(turn.prices)
    unpriced += turn.unpriced
    const a = allocate(turn)
    const planUsd = turn.costUsd * a.plan
    const protoUsd = planUsd * a.prototype
    // A later part of a turn adds cost and time, not a turn.
    const first = (turn.part ?? 0) === 0 ? 1 : 0
    const r = (reasons[a.reason] ??= { turns: 0, dollars: 0 })
    r.turns += first
    r.dollars += turn.costUsd
    dollars.plan += planUsd
    dollars.prototype += protoUsd
    dollars.notPlan += turn.costUsd - planUsd
    if (a.reason === 'chat-pane') dollars.planChatPane += planUsd
    else dollars.planTerminal += planUsd
    const d = day(at.slice(0, 10))
    d.plan += planUsd
    d.prototype += protoUsd
    d.notPlan += turn.costUsd - planUsd
    for (const [card, share] of Object.entries(a.cards)) {
      const c = cards.get(card) ?? { card, dollars: 0, prototype: 0, wallSec: 0, turns: 0, tokens: ZERO_TOKENS }
      c.dollars += planUsd * share
      c.prototype += protoUsd * share
      c.wallSec += (turn.ms / 1000) * a.plan * share
      c.turns += first
      c.tokens = addTokens(c.tokens, turn.tokens, a.plan * share)
      cards.set(card, c)
    }
  }

  for (const d of decidedDays(decisions).values()) if (days.has(d)) day(d).decided++
  for (const d of days.values()) d.perDecided = d.decided ? d.plan / d.decided : null

  const cardList = [...cards.values()].sort((a, b) => b.dollars - a.dollars)
  const dayList = [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
  return {
    prices: [...prices].sort(),
    sessions: { chatPane: chatPane.size, terminal: allSessions.size - chatPane.size },
    dollars,
    reasons,
    unpricedResponses: unpriced,
    cards: cardList,
    days: dayList,
    perCard: distribution(cardList.map(c => c.dollars)),
    perDecidedCardPerDay: distribution(dayList.flatMap(d => (d.perDecided === null ? [] : [d.perDecided]))),
  }
}
