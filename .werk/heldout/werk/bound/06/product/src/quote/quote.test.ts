/**
 * The quote command against a temporary project and a temporary Claude config dir that holds
 * one session transcript (#werk-excerpt).
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProject, type TempProject } from '../../test/harness.ts'
import { messageOf, transcriptLines } from './find.ts'
import { claudeConfigDir, encodeProjectDir, readTranscript } from './transcript.ts'

const SESSION = '0b6c1f9e-5d1a-4c3e-9f00-6a2d7e1c4b88'

const user = (content: string) => JSON.stringify({ type: 'user', message: { role: 'user', content } })
const assistant = (text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const TRANSCRIPT = [
  JSON.stringify({ type: 'summary', summary: 'restarts' }),
  user('a restart kills my session every time I save'),
  assistant('The hot reload keeps the agent child alive, so the session survives.'),
  user('and a client edit? the session must survive that too'),
].join('\n') + '\n'

let project: TempProject | undefined
let config: string | undefined
afterEach(() => {
  project?.cleanup()
  if (config) rmSync(config, { recursive: true, force: true })
  project = undefined
  config = undefined
})

/** A project with card #a, and a config dir that holds the transcript under `projectDir`, or under the project. */
function setup(options: { projectDir?: string } = {}) {
  project = makeProject()
  config = realpathSync(mkdtempSync(join(tmpdir(), 'werk-claude-')))
  const dir = join(config, 'projects', encodeProjectDir(options.projectDir ?? project.dir))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${SESSION}.jsonl`), TRANSCRIPT)
  expect(project.run(['add', 'a', '--title', 'Keep the session through a reload']).code).toBe(0)
  const env = { CLAUDE_CONFIG_DIR: config }
  const p = project
  return {
    quote: (text: string, session = SESSION) => p.run(['quote', 'a', session, '--text', text], env),
    log: () => readFileSync(join(p.dir, '.werk', 'log.jsonl'), 'utf8'),
    show: (id: string) => JSON.parse(p.run(['show', id]).stdout),
  }
}

test('a quote that matches one message once proposes a ghost excerpt with the message index, span, speaker and session', () => {
  const { quote, show } = setup()
  const result = quote('kills my session')
  expect(result).toMatchObject({ code: 0, stderr: '' })
  expect(result.stdout).toBe(`2 quoted #a supported_by #a:ex0\n#a:ex0 is proposed: user, message 1 of session ${SESSION}. It waits for the ✓.\n`)
  const excerpt = show('a:ex0').card
  expect(excerpt).toMatchObject({
    kind: 'excerpt',
    title: 'kills my session',
    proposed: true,
    excerpt: { session: SESSION, msgIndex: 1, span: [10, 26], speaker: 'user' },
  })
})

test('the span on the excerpt selects the quoted text in the transcript exactly', () => {
  const { quote, show } = setup()
  const text = 'keeps the agent child alive, so'
  expect(quote(text).code).toBe(0)
  const { msgIndex, span } = show('a:ex0').card.excerpt
  const message = messageOf(transcriptLines(TRANSCRIPT)[msgIndex]!)!
  expect(message).toMatchObject({ speaker: 'assistant' })
  expect(message.text.slice(span[0], span[1])).toBe(text)
})

test('the excerpt is linked supported_by from the citing card, and the link is held until the ✓', () => {
  const { quote, show } = setup()
  expect(quote('kills my session').code).toBe(0)
  const page = show('a')
  expect(page.evidence.map((c: { id: string; proposed?: boolean }) => [c.id, c.proposed])).toEqual([['a:ex0', true]])
  expect(show('a:ex0').supports.map((c: { id: string }) => c.id)).toEqual(['a'])
  const map = JSON.parse(project!.run(['show']).stdout)
  expect(map.children.map((c: { id: string }) => c.id)).toEqual(['a'])
})

test('a second quote on the same card gets the next excerpt id', () => {
  const { quote } = setup()
  expect(quote('kills my session').code).toBe(0)
  expect(quote('client edit').stdout).toStartWith('3 quoted #a supported_by #a:ex1\n')
})

test('a quote with one changed character fails with no event, and says there is no exact match', () => {
  const { quote, log } = setup()
  const before = log()
  const result = quote('kills my sessiom')
  expect(result.code).toBe(1)
  expect(result.stderr).toBe(`werk: quote: no exact match in session ${SESSION}. The text must be copied character for character from one message.\n`)
  expect(log()).toBe(before)
})

test('a quote that occurs in two messages fails with no event, and names the ambiguity', () => {
  const { quote, log } = setup()
  const before = log()
  const result = quote('the session')
  expect(result.code).toBe(1)
  expect(result.stderr).toBe(
    `werk: quote: ambiguous. The text occurs in 2 messages of session ${SESSION} (message 2, 3). Quote more of the sentence so it occurs in one.\n`,
  )
  expect(log()).toBe(before)
})

test('a quote of an unknown session, or of an unsafe session id, fails with no event', () => {
  const { quote, log } = setup()
  const before = log()
  expect(quote('kills my session', 'nope')).toMatchObject({ code: 1, stderr: `werk: quote: no transcript for session nope under ${join(config!, 'projects')}\n` })
  expect(quote('kills my session', '../x')).toMatchObject({ code: 1, stderr: 'werk: quote: "../x" is not a session id\n' })
  expect(log()).toBe(before)
})

test('a quote for a card that is not in the map fails with no event', () => {
  const { log } = setup()
  const before = log()
  const result = project!.run(['quote', 'nope', SESSION, '--text', 'kills my session'], { CLAUDE_CONFIG_DIR: config! })
  expect(result).toMatchObject({ code: 1, stderr: 'werk: no card #nope\n' })
  expect(log()).toBe(before)
})

test('the transcript of a session that ran in another project directory is found too', () => {
  const { quote, show } = setup({ projectDir: '/elsewhere/worktree' })
  expect(quote('kills my session').code).toBe(0)
  expect(show('a:ex0').card.excerpt.session).toBe(SESSION)
})

test('the project directory is encoded the way Claude Code names it, and the config dir defaults to ~/.claude', () => {
  expect(encodeProjectDir('/Users/e/my_proj.v2')).toBe('-Users-e-my-proj-v2')
  expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/tmp/c' })).toBe('/tmp/c')
  expect(claudeConfigDir({})).toEndWith('/.claude')
  expect(readTranscript('s1', '/p', '/no/such/dir')).toEqual({ ok: false, message: 'quote: no transcript for session s1 under /no/such/dir/projects' })
})
