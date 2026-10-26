/**
 * Finds a quote verbatim in a session transcript (#werk-excerpt). A pure module: the text of
 * the transcript in, one pointer or the reason there is none out. It never guesses.
 *
 * The transcript is Claude Code's: one JSON object per line. A message is a user or
 * assistant line that carries text. Its index counts every line of the file from 0, so the
 * pointer stays valid whatever a reader filters out.
 */
import { SPEAKERS, type Pointer, type Speaker } from '../map/events.ts'

export type QuoteResult =
  | ({ ok: true } & Pointer)
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'no-match' }
  /** The text occurs in more than one message. */
  | { ok: false; reason: 'ambiguous'; messages: number[] }
  /** The text occurs once in one message only, but more than once in it. */
  | { ok: false; reason: 'repeated'; msgIndex: number; count: number }

type Line = { type?: unknown; isMeta?: unknown; message?: { content?: unknown } }

/**
 * The text of one transcript line, and who wrote it. Undefined for a line that is not a
 * message: a summary, a meta line, a tool call or a tool result with no text, or bad JSON.
 * The text blocks of one line are joined with a newline. That newline is not in the file, so
 * `joins` holds its offsets, and a quote that covers one is no match.
 */
export function messageOf(line: string): { speaker: Speaker; text: string; joins: number[] } | undefined {
  let parsed: Line
  try {
    parsed = JSON.parse(line) as Line
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const speaker = parsed.type as Speaker
  if (!SPEAKERS.includes(speaker) || parsed.isMeta === true) return undefined
  const content = parsed.message?.content
  if (typeof content === 'string') return content === '' ? undefined : { speaker, text: content, joins: [] }
  if (!Array.isArray(content)) return undefined
  const texts = content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text as string)
  if (texts.length === 0) return undefined
  const joins = texts.slice(0, -1).map((_, i) => texts.slice(0, i + 1).reduce((n, t) => n + t.length, 0) + i)
  return { speaker, text: texts.join('\n'), joins }
}

/** The lines of a transcript, with the line break of each removed. A final empty line is not a line. */
export function transcriptLines(transcript: string): string[] {
  const lines = transcript.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** Finds `quote` in the transcript. Exactly one occurrence in the whole file is a match. */
export function findQuote(transcript: string, quote: string): QuoteResult {
  if (quote === '') return { ok: false, reason: 'empty' }
  const hits: { msgIndex: number; speaker: Speaker; at: number[] }[] = []
  transcriptLines(transcript).forEach((line, msgIndex) => {
    const message = messageOf(line)
    if (!message) return
    const at = occurrences(message.text, quote).filter((start) => !message.joins.some((j) => j >= start && j < start + quote.length))
    if (at.length > 0) hits.push({ msgIndex, speaker: message.speaker, at })
  })
  if (hits.length === 0) return { ok: false, reason: 'no-match' }
  if (hits.length > 1) return { ok: false, reason: 'ambiguous', messages: hits.map((hit) => hit.msgIndex) }
  const [hit] = hits as [(typeof hits)[number]]
  if (hit.at.length > 1) return { ok: false, reason: 'repeated', msgIndex: hit.msgIndex, count: hit.at.length }
  const start = hit.at[0]!
  return { ok: true, msgIndex: hit.msgIndex, span: [start, start + quote.length], speaker: hit.speaker }
}

/** Every start offset of `needle` in `text`, overlaps included. */
function occurrences(text: string, needle: string): number[] {
  const at: number[] = []
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) at.push(i)
  return at
}

/** The sentence that says why a quote failed. It names the case, so the agent knows what to fix. */
export function describeFailure(result: Exclude<QuoteResult, { ok: true }>, session: string): string {
  switch (result.reason) {
    case 'empty':
      return 'quote: the text is empty'
    case 'no-match':
      return `quote: no exact match in session ${session}. The text must be copied character for character from one message.`
    case 'ambiguous':
      return `quote: ambiguous. The text occurs in ${result.messages.length} messages of session ${session} (message ${result.messages.join(', ')}). Quote more of the sentence so it occurs in one.`
    case 'repeated':
      return `quote: ambiguous. The text occurs ${result.count} times in message ${result.msgIndex} of session ${session}. Quote more of the sentence so it occurs once.`
  }
}
