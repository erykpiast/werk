import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import type { Werk } from '../../e2e/harness.ts'

export const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
export const start: FakeStep = stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
export const delta = (text: string): FakeStep => stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
export const whole = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
export const end: FakeStep = { event: { type: 'result', subtype: 'success', duration_ms: 1000, total_cost_usd: 0.01 } }
export const init = (session: string): FakeStep => ({ event: { type: 'system', subtype: 'init', session_id: session } })
export const reply = (text: string, session?: string): FakeReply => ({
  steps: [...(session ? [init(session)] : []), start, delta(text), whole(text), end],
})
export const textOf = (message: unknown) => (message as { message: { content: { text: string }[] } }).message.content[0]!.text
export const chatRuns = (werk: Werk) => werk.agentRuns().filter((r) => r.role === 'chat')

/** The text after --append-system-prompt in a launch argv, or undefined. */
export const systemPrompt = (argv: string[]): string | undefined => {
  const at = argv.indexOf('--append-system-prompt')
  return at === -1 ? undefined : argv[at + 1]
}

/** Adds and accepts a card with the CLI, the way an agent and the person do. */
export const addCard = (werk: Werk, id: string, title: string, parent = 'map', body?: string) => {
  werk.cli(['add', id, '--title', title, '--parent', parent, ...(body ? ['--body', body] : [])])
  werk.cli(['accept', id, '--actor', 'you'])
}
