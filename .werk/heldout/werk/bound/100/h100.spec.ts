/** Held-out steps 100.x, 98.3 and 99.x: the chat pane and the system prompt of the chat agent. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FakeReply, FakeScript, FakeStep } from '../src/test/fake-agent.ts'
import { writeFakeAgent } from '../src/test/fake-bin.ts'
import { expect, test, type Werk } from '../e2e/harness.ts'

const ROOT = join(import.meta.dirname, '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const TEST_SERVER = join(ROOT, 'src', 'test', 'test-server.ts')
const FIXTURE = join(ROOT, 'e2e', 'fixture-project')

const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
const start: FakeStep = stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
const delta = (text: string): FakeStep => stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
const whole = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const end: FakeStep = { event: { type: 'result', subtype: 'success', duration_ms: 1000, total_cost_usd: 0.01 } }
const reply = (text: string): FakeReply => ({ steps: [start, delta(text), whole(text), end] })

/** The system prompt that werk appended to a launch: the value after --append-system-prompt. */
const systemPromptOf = (argv: string[]) => {
  const i = argv.indexOf('--append-system-prompt')
  return i < 0 ? undefined : argv[i + 1]
}
const textOf = (message: unknown) => (message as { message: { content: { text: string }[] } }).message.content[0]!.text

/** The card instructions text: the heading werk puts at the top of it. */
const INSTRUCTIONS_HEADING = '# werk — how to write a card on the map'

const pane = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'chat' })
const composerOf = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'message' })
const transcriptOf = (page: import('@playwright/test').Page) => page.getByRole('list', { name: 'transcript' })

async function send(page: import('@playwright/test').Page, text: string) {
  const composer = composerOf(page)
  await composer.fill(text)
  await composer.press('Enter')
}

/** Adds a real card under "werk" from the command line. */
function addCard(werk: Werk, id: string, title: string, body?: string) {
  werk.cli(['add', id, '--title', title, '--parent', 'werk', ...(body ? ['--body', body] : [])])
  werk.cli(['accept', id, '--actor', 'you'])
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * A werk server that the test starts and stops itself, so the person can restart werk. It runs
 * on its own copy of the fixture project, with the fake agent first on PATH, the same way the
 * harness does.
 */
function ownProject() {
  const root = mkdtempSync(join(tmpdir(), 'werk-h100-'))
  const dir = join(root, 'project')
  const bin = join(root, 'bin')
  cpSync(FIXTURE, dir, { recursive: true })
  writeFakeAgent(bin)
  const scriptPath = join(root, 'agent-script.json')
  const launchLog = join(root, 'agent-launches.jsonl')
  const inputLog = join(root, 'agent-input.jsonl')
  writeFileSync(launchLog, '')
  writeFileSync(inputLog, '')
  const env = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: root,
    TMPDIR: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    WERK_FAKE_AGENT_SCRIPT: scriptPath,
    WERK_FAKE_AGENT_LOG: launchLog,
    WERK_FAKE_AGENT_INPUT: inputLog,
  }
  for (const args of [['init', '--quiet', '--initial-branch=main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@x.invalid'], ['add', '.'], ['commit', '--quiet', '-m', 'f']]) {
    spawnSync('git', args, { cwd: dir, env })
  }
  let server: ChildProcess | undefined
  const lines = (path: string) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  return {
    dir,
    scriptAgent: (script: FakeScript) => writeFileSync(scriptPath, JSON.stringify(script)),
    launches: () => lines(launchLog) as { argv: string[]; role?: string; pid: number }[],
    inputs: (pid: number) => (lines(inputLog) as { pid: number; message: unknown }[]).filter((i) => i.pid === pid).map((i) => i.message),
    start: (port = 0) =>
      new Promise<string>((resolve, reject) => {
        server = spawn('bun', [TEST_SERVER, '--port', String(port)], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        let err = ''
        server.stderr!.on('data', (c: Buffer) => (err += c.toString()))
        server.stdout!.on('data', (c: Buffer) => {
          out += c.toString()
          const m = out.match(/http:\/\/\S+\//)
          if (m) resolve(m[0])
        })
        server.on('exit', (code) => reject(new Error(`server exited ${code}: ${err}`)))
      }),
    stop: async () => {
      const s = server
      if (!s || s.exitCode !== null || s.signalCode !== null) return
      const exited = new Promise((r) => s.once('exit', r))
      s.kill('SIGTERM')
      const t = setTimeout(() => s.kill('SIGKILL'), 5000)
      await exited
      clearTimeout(t)
    },
    remove: () => rmSync(root, { recursive: true, force: true }),
  }
}

/** Lets only the given server through, the way the harness does for its own server. */
async function onlyHost(page: import('@playwright/test').Page, url: string) {
  const host = new URL(url).host
  await page.context().unroute('**/*')
  await page.context().route('**/*', (route) => (new URL(route.request().url()).host === host ? route.continue() : route.abort('blockedbyclient')))
}

// ---------------------------------------------------------------- 100

test('100.1 a new chat conversation starts with the card wording rules in its system prompt', async ({ page, werk }) => {
  // Given werk runs with the fake agent in place of the real agent
  // And the map holds at least one card
  // When the user opens the map in the browser
  // And the user starts a new chat conversation
  // And the user sends the message "hello"
  // Then the fake agent's launch record for that conversation shows a system prompt
  // And the system prompt contains the card instructions text
  // And the instructions text says that a card describes its own subject and not the session that wrote it
  // And the instructions text says that a card does not narrate who said what or its own edit history
  // Reading: the pane has one conversation; the first message in an empty pane starts it.
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Hi.')] } })
  await page.goto(werk.url)
  await expect(page.getByRole('link', { name: /werk: a visual layer/ }).first()).toBeVisible()
  await expect(transcriptOf(page).getByRole('listitem')).toHaveCount(0)
  await send(page, 'hello')
  await expect(transcriptOf(page)).toContainText('Hi.')
  const chat = werk.agentRuns().findIndex((r) => r.role === 'chat')
  expect(chat).toBeGreaterThanOrEqual(0)
  const prompt = systemPromptOf(werk.agentLaunches()[chat]!)
  expect(prompt).toBeDefined()
  expect(prompt).toContain(INSTRUCTIONS_HEADING)
  expect(prompt).toContain('A card describes its own subject, not the session that wrote it.')
  expect(prompt).toContain('Do not write who said what')
  expect(prompt).toContain('Do not write edit history.')
})

test('100.2 the instructions forbid code names in card text', async ({ page, werk }) => {
  // Given werk runs with the fake agent in place of the real agent
  // When the user starts a chat conversation from a card in the map
  // And the user sends a message in that conversation
  // Then the fake agent's launch record for that conversation shows the card instructions text in its system prompt
  // And the instructions text says that a card names behaviour and concepts
  // And the instructions text says that a card does not name a file, a function, a class, a constant, a line number or an internal endpoint
  // And the instructions text says that a card does not list its child cards
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Ok.')] } })
  await page.goto(werk.url)
  await page.locator('a[href="#fold"]').first().click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'fold')
  await send(page, 'What does this card say?')
  await expect(transcriptOf(page)).toContainText('Ok.')
  const chat = werk.agentRuns().findIndex((r) => r.role === 'chat')
  const prompt = systemPromptOf(werk.agentLaunches()[chat]!) ?? ''
  expect(prompt).toContain(INSTRUCTIONS_HEADING)
  expect(prompt).toContain('A card names behaviour and concepts.')
  expect(prompt).toMatch(/never names a (source )?file, a function, a class, a constant, a line number or an internal endpoint/)
  expect(prompt).toMatch(/child card/i)
})

test('100.3 the instructions tell the agent to read a card from the map before it writes it', async ({ page, werk }) => {
  // Given werk runs with the fake agent in place of the real agent
  // When the user starts a chat conversation
  // And the user asks the agent to change the body of a card
  // Then the fake agent's launch record for that conversation shows the card instructions text in its system prompt
  // And the instructions text says that the agent reads a card from the map before it writes that card
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Done.')] } })
  await page.goto(`${werk.url}#fold`)
  await send(page, 'Change the body of #fold to say that the fold is pure.')
  await expect(transcriptOf(page)).toContainText('Done.')
  const chat = werk.agentRuns().findIndex((r) => r.role === 'chat')
  const prompt = systemPromptOf(werk.agentLaunches()[chat]!) ?? ''
  expect(prompt).toContain(INSTRUCTIONS_HEADING)
  expect(prompt).toContain('Read a card from the map before you write it.')
})

test('100.4 a second chat conversation also gets the instructions', async ({ page, werk }) => {
  // Given werk runs with the fake agent in place of the real agent
  // And the user has one chat conversation that already has a reply
  // When the user starts a second chat conversation
  // And the user sends a message in the second conversation
  // Then the fake agent's launch record for the second conversation shows the card instructions text in its system prompt
  // And the instructions text in the second launch record is the same as the text in the first launch record
  werk.scriptAgent({ steps: [], roles: { chat: [reply('First reply.')] } })
  await page.goto(werk.url)
  await send(page, 'hello')
  await expect(transcriptOf(page)).toContainText('First reply.')
  // The person starts a second conversation with a control in the chat pane.
  const newConversation = pane(page).getByRole('button', { name: /new|conversation|chat|\+/i })
  await expect(newConversation, 'the chat pane has a control that starts a second conversation').toHaveCount(1, { timeout: 3000 })
  await newConversation.click()
  await send(page, 'hello again')
  await expect(transcriptOf(page)).toContainText('First reply.')
  const chats = werk.agentRuns().flatMap((r, i) => (r.role === 'chat' ? [i] : []))
  expect(chats).toHaveLength(2)
  const [a, b] = chats.map((i) => systemPromptOf(werk.agentLaunches()[i]!))
  expect(b).toContain(INSTRUCTIONS_HEADING)
  expect(b).toBe(a)
})

test('100.5 a resumed conversation after a restart still carries the instructions', async ({ page }) => {
  // Given werk runs with the fake agent in place of the real agent
  // And the user has a chat conversation with one reply
  // When the user restarts werk
  // And the user sends a new message in the same conversation
  // Then the conversation transcript still shows the earlier reply
  // And the fake agent's launch record for the resumed start shows the card instructions text in its system prompt
  test.setTimeout(90_000)
  const own = ownProject()
  try {
    own.scriptAgent({ steps: [], roles: { chat: [reply('Earlier reply.'), reply('Later reply.')] } })
    const url = await own.start()
    await onlyHost(page, url)
    await page.goto(url)
    await send(page, 'hello')
    await expect(transcriptOf(page)).toContainText('Earlier reply.')

    // The person restarts werk on the same port and opens the map again.
    await own.stop()
    const again = await own.start(Number(new URL(url).port))
    expect(again).toBe(url)
    await page.goto(again)
    const before = own.launches().filter((l) => l.role === 'chat').length
    own.scriptAgent({ steps: [], roles: { chat: [reply('Later reply.')] } })
    await send(page, 'and now?')
    await expect(transcriptOf(page)).toContainText('Later reply.')
    let failure: unknown
    try {
      await expect(transcriptOf(page).locator('.you').first()).toHaveText('hello', { timeout: 5000 })
      await expect(transcriptOf(page)).toContainText('Earlier reply.', { timeout: 1000 })
    } catch (err) {
      failure = err
    }
    await expect.poll(() => own.launches().filter((l) => l.role === 'chat').length).toBeGreaterThan(before)
    const resumed = own.launches().filter((l) => l.role === 'chat').at(-1)!
    expect(systemPromptOf(resumed.argv)).toContain(INSTRUCTIONS_HEADING)
    if (failure) throw failure
  } finally {
    await own.stop()
    own.remove()
  }
})

// ---------------------------------------------------------------- 98.3

test('98.3 a chat conversation answers each message and stays open until its input closes', async ({ page }) => {
  // Given a werk server on a copy of a fixture project with the fake agent first on the PATH
  // And the script holds two replies for the chat role, R1 and R2
  // When the user opens the chat pane and sends message M1
  // Then the chat pane shows R1
  // And the chat agent is still running
  // When the user sends message M2 in the same conversation
  // Then the chat pane shows R2 under R1 in one conversation
  // And the launch record shows one launch with role chat, not two
  // When the conversation input closes
  // Then the chat agent exits
  test.setTimeout(60_000)
  const own = ownProject()
  try {
    own.scriptAgent({ steps: [], roles: { chat: [reply('R1-REPLY'), reply('R2-REPLY')] } })
    const url = await own.start()
    await onlyHost(page, url)
    await page.goto(url)
    await expect(pane(page)).toBeVisible()
    await send(page, 'M1')
    await expect(transcriptOf(page)).toContainText('R1-REPLY')
    const [first] = own.launches().filter((l) => l.role === 'chat')
    expect(first).toBeDefined()
    expect(alive(first!.pid)).toBe(true)

    await send(page, 'M2')
    const items = transcriptOf(page).getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('R1-REPLY')
    await expect(items.nth(1)).toContainText('R2-REPLY')
    expect(own.launches().filter((l) => l.role === 'chat')).toHaveLength(1)

    // The conversation input closes when werk stops: it ends the agent's stdin.
    await own.stop()
    await expect.poll(() => alive(first!.pid), { timeout: 10_000 }).toBe(false)
  } finally {
    await own.stop()
    own.remove()
  }
})

// ---------------------------------------------------------------- 99

test('99.1 Enter sends the message with its full context and the reply streams into the pane', async ({ page, werk }) => {
  // Given the person has the map open with card "#werk-chat" open
  // And the "main" conversation tab is active in the chat pane
  // And the fake agent has a scripted reply in three parts
  // When the person types "What does this card decide?" in the composer
  // And the person pastes an image into the composer
  // And the person presses Enter
  // Then the server receives one request with the text, the image, the open card "#werk-chat" and the tab "main"
  // And the reply text appears in the chat pane part by part, before the full reply is complete
  // And the full scripted reply shows in the pane when the turn ends
  // And the launch record of the agent shows the chat role
  // And the turn input that the fake agent records starts with the id "#werk-chat"
  addCard(werk, 'werk-chat', 'The composer sends a live agent turn')
  const gate1 = join(werk.dir, '..', 'gate-1')
  const gate2 = join(werk.dir, '..', 'gate-2')
  werk.scriptAgent({
    steps: [],
    roles: {
      chat: [{ steps: [start, delta('Part one.'), { waitFor: gate1 }, delta(' Part two.'), { waitFor: gate2 }, delta(' Part three.'), whole('Part one. Part two. Part three.'), end] }],
    },
  })
  await page.goto(`${werk.url}#werk-chat`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat')
  await expect(pane(page)).toHaveAttribute('data-tab', 'main')
  const composer = composerOf(page)
  await composer.click()
  await composer.pressSequentially('What does this card decide?')
  await composer.evaluate((el) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgo='), (c) => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'shot.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(pane(page).locator('.chips')).toContainText('[Image #1]')
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/api/chat')) requests.push(r.postData() ?? '')
  })
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/chat'))
  await composer.press('Enter')
  const body = (await sent).postDataJSON() as { text: string; images: { type: string }[]; card: string; tab: string }
  expect(body.text).toContain('What does this card decide?')
  expect(body.images).toHaveLength(1)
  expect(body.images[0]!.type).toBe('image/png')
  expect(body.card).toBe('werk-chat')
  expect(body.tab).toBe('main')

  const replyText = transcriptOf(page).getByLabel('reply')
  await expect(replyText).toHaveText('Part one.')
  writeFileSync(gate1, '')
  await expect(replyText).toHaveText('Part one. Part two.')
  writeFileSync(gate2, '')
  await expect(replyText).toHaveText('Part one. Part two. Part three.')
  await expect(transcriptOf(page).locator('.end')).toBeVisible()
  expect(requests).toHaveLength(1)

  const chats = werk.agentRuns().filter((r) => r.role === 'chat')
  expect(chats).toHaveLength(1)
  const input = textOf(chats[0]!.inputs[0])
  // The first line of the turn input names the open card (step reading: "starts with" = its first line names the id).
  expect(input.split('\n')[0]).toContain('#werk-chat')
})

test('99.2 a second message reuses the same agent and names the card open at that moment', async ({ page, werk }) => {
  // Given the person has card "#werk-chat" open and sent one message from the composer
  // And the reply to that message is complete in the chat pane
  // When the person opens card "#werk-onechat" on the map
  // And the person types "And this one?" in the composer and presses Enter
  // Then the first reply is still in the chat pane
  // And the second reply streams into the same pane below the first
  // And the same agent process receives the second turn, and no new agent starts
  // And the first line of the second turn input names "#werk-onechat", not "#werk-chat"
  addCard(werk, 'werk-chat', 'The composer sends a live agent turn')
  addCard(werk, 'werk-onechat', 'One chat per tab')
  werk.scriptAgent({ steps: [], roles: { chat: [reply('First answer.'), reply('Second answer.')] } })
  await page.goto(`${werk.url}#werk-chat`)
  await send(page, 'What does this card decide?')
  await expect(transcriptOf(page).locator('.end')).toHaveCount(1)
  await expect(transcriptOf(page)).toContainText('First answer.')

  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  await page.locator('a[href="#werk-onechat"]').first().click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-onechat')
  await send(page, 'And this one?')
  const items = transcriptOf(page).getByRole('listitem')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('First answer.')
  await expect(items.nth(1)).toContainText('Second answer.')

  const chats = werk.agentRuns().filter((r) => r.role === 'chat')
  expect(chats).toHaveLength(1)
  expect(werk.agentRuns()).toHaveLength(1)
  const second = textOf(chats[0]!.inputs[1]).split('\n')[0]!
  expect(second).toContain('#werk-onechat')
  expect(second).not.toMatch(/#werk-chat(?![-\w])/)
})

test('99.3 the chat pane keeps its content as the person moves through the map', async ({ page, werk }) => {
  // Given the person sent a message and the reply shows in the chat pane
  // When the person opens three different cards on the map, one after the other
  // Then the chat pane shows the same message and reply after each move
  // And the composer stays beside the map and accepts new text
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Kept reply.')] } })
  await page.goto(werk.url)
  await send(page, 'Kept message')
  await expect(transcriptOf(page)).toContainText('Kept reply.')
  // Three moves: a tile of the tree, a sub-card, then a breadcrumb.
  for (const id of ['log', 'fold', 'werk']) {
    await page.locator(`a[href="#${id}"]`).first().click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', id)
    await expect(transcriptOf(page).locator('.you')).toHaveText(['Kept message'])
    await expect(transcriptOf(page).getByLabel('reply')).toHaveText(['Kept reply.'])
  }
  const composer = composerOf(page)
  await expect(composer).toBeVisible()
  await composer.fill('more text')
  await expect(composer).toHaveValue('more text')
  // Beside the map: the pane and the card are both on screen, side by side.
  const card = await page.getByTestId('card').boundingBox()
  const chat = await pane(page).boundingBox()
  expect(card && chat).toBeTruthy()
  expect(chat!.x >= card!.x + card!.width - 1 || chat!.x + chat!.width <= card!.x + 1).toBe(true)
})

test('99.4 a card id in the reply opens that card on the map', async ({ page, werk }) => {
  // Given the fake agent has a scripted reply that mentions "#werk-chat-stdin"
  // And the person has card "#werk-chat" open
  // When the person sends a message from the composer
  // And the reply shows in the chat pane
  // Then "#werk-chat-stdin" in the reply shows as a link, with the same style as card links in a card body
  // And the reply Markdown renders the same way a card body renders
  // When the person clicks the "#werk-chat-stdin" link
  // Then the map opens card "#werk-chat-stdin"
  // And the chat pane still shows the reply
  const md = 'See #werk-chat-stdin for the **input** side.'
  addCard(werk, 'werk-chat-stdin', 'The turn goes to the agent on stdin')
  addCard(werk, 'werk-chat', 'The composer sends a live agent turn', md)
  werk.scriptAgent({ steps: [], roles: { chat: [reply(md)] } })
  await page.goto(`${werk.url}#werk-chat`)
  await send(page, 'Where does the input go?')
  const replyText = transcriptOf(page).getByLabel('reply')
  await expect(replyText).toContainText('See #werk-chat-stdin for the input side.')
  const inReply = replyText.getByRole('link', { name: '#werk-chat-stdin' })
  const inBody = page.getByTestId('card').locator('.body').getByRole('link', { name: '#werk-chat-stdin' })
  await expect(inReply).toBeVisible()
  await expect(inBody).toBeVisible()
  expect(await inReply.getAttribute('class')).toBe(await inBody.getAttribute('class'))
  const style = (l: typeof inReply) => l.evaluate((el) => { const s = getComputedStyle(el); return [s.color, s.textDecorationLine, s.fontFamily, s.fontWeight].join('|') })
  expect(await style(inReply)).toBe(await style(inBody))
  // The same Markdown: the reply's rendered HTML equals the body's.
  const replyHtml = await replyText.locator('.md').innerHTML()
  const bodyHtml = await page.getByTestId('card').locator('.body .md').innerHTML()
  expect(replyHtml).toBe(bodyHtml)
  await inReply.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat-stdin')
  await expect(replyText).toContainText('See #werk-chat-stdin for the input side.')
})

test('99.5 the server has no note route for the person', async ({ page, werk }) => {
  // Given the werk server runs with the map loaded
  // When a person sends a request to add a note to card "#werk-chat" through a note route
  // Then the server answers that the route does not exist
  // And card "#werk-chat" shows no new note on the map
  addCard(werk, 'werk-chat', 'The composer sends a live agent turn')
  await page.goto(`${werk.url}#werk-chat`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat')
  const token = await page.locator('meta[name="werk-token"]').getAttribute('content')
  for (const path of ['api/note', 'api/notes', 'api/note/werk-chat', 'api/notes/werk-chat', 'api/cards/werk-chat/notes']) {
    const res = await page.request.post(`${werk.url}${path}`, {
      headers: { 'content-type': 'application/json', 'x-werk-token': token ?? '' },
      data: { card: 'werk-chat', id: 'werk-chat', text: 'a person note' },
    })
    expect(res.status(), path).toBe(404)
  }
  await expect(page.getByTestId('card').getByRole('region', { name: 'notes' })).toHaveCount(0)
  await expect(page.getByTestId('card')).not.toContainText('a person note')
  expect(werk.cli(['inbox'])).not.toContain('a person note')
  expect(existsSync(werk.dir)).toBe(true)
})
