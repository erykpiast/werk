import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { holdChild, isRunning } from './children.ts'
import { sseEvent } from './sse.ts'
import type { Live } from './state.ts'

/** The name the chat agent is held under on the live server. */
export const CHAT_CHILD = 'chat'

/** A `claude` child that reads user turns as JSON lines on stdin and streams events on stdout (#werk-chat-stdin). */
export const CHAT_ARGS = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'] as const

/**
 * Sends one user turn to the chat agent. The first turn starts the agent in the project
 * directory; every later turn, also after a hot reload, goes to the same child. Each line
 * the agent prints goes to every open live channel as an `agent` event. Throws when the
 * child cannot start.
 */
export function sendTurn(live: Live, text: string): ChildProcessWithoutNullStreams {
  let agent = live.children.get(CHAT_CHILD) as ChildProcessWithoutNullStreams | undefined
  if (!agent || !isRunning(agent)) {
    agent = holdChild(live, CHAT_CHILD, 'claude', CHAT_ARGS, {
      cwd: live.projectDir,
      stdio: 'pipe',
    }) as ChildProcessWithoutNullStreams
    // A child that fails to start or dies mid-write must not take the server down with it.
    agent.on('error', (error) => console.error(`werk: the chat agent failed: ${error.message}`))
    agent.stdin.on('error', (error) => console.error(`werk: the chat agent's stdin closed: ${error.message}`))
    agent.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    relay(live, agent)
  }
  if (agent.pid === undefined) throw new Error('could not start claude: is it on PATH?')
  agent.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
  return agent
}

function relay(live: Live, agent: ChildProcessWithoutNullStreams): void {
  let buffered = ''
  agent.stdout.setEncoding('utf8')
  agent.stdout.on('data', (chunk: string) => {
    buffered += chunk
    const lines = buffered.split('\n')
    buffered = lines.pop()!
    for (const line of lines.filter(Boolean)) {
      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        event = { type: 'text', text: line }
      }
      for (const client of live.clients) client.write(sseEvent('agent', event))
    }
  })
}
