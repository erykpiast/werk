# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g100-101/restart.spec.ts >> 100.5 a resumed conversation after a restart still carries the instructions
- Location: .werk-heldout/g100-101/restart.spec.ts:29:1

# Error details

```
Error: the transcript still shows the earlier reply

expect(locator).toContainText(expected) failed

Locator: getByRole('list', { name: 'transcript' })
Expected substring: "The earlier reply."
Received string:    "A new messageThe later reply.0.1s · $0.01"
Timeout: 5000ms

Call log:
  - the transcript still shows the earlier reply getByRole('list', { name: 'transcript' }) with timeout 5000ms
  - waiting for getByRole('list', { name: 'transcript' })
    14 × locator resolved to <ol class="transcript" aria-label="transcript">…</ol>
       - unexpected value "A new messageThe later reply.0.1s · $0.01"

```

```yaml
- list "transcript":
  - listitem:
    - text: A new message
    - paragraph: The later reply.
    - paragraph: 0.1s · $0.01
```

```
Error: the second start resumes the earlier session

expect(received).toEqual(expected) // deep equality

Expected: ArrayContaining ["--resume", "s-earlier"]
Received: ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "auto", "--append-system-prompt", "# werk — how to write a card on the map·
This project keeps its decisions in a werk map. You read and write the map with the werk command line:·
    \"/Users/eryk.napierala/.bun/bin/bun\" \"/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-app-CGqvSv/app/src/cli/main.ts\" <verb> ...·
## Read a card from the map before you write it·
Read a card from the map before you write it. Print it with:·
    \"/Users/eryk.napierala/.bun/bin/bun\" \"/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-app-CGqvSv/app/src/cli/main.ts\" show <id>·
Your own context can be stale. Another conversation can have changed or decided the card since you last read it. The map on disk is always current, so the card you print is the card you change. Never write a card from what you remember of it.·
## Read another conversation from its transcript·
Other conversations of this project run beside you, and none of them tells you what it said. When you need what another conversation said, read it from its transcript on disk. List every conversation with its session id and its home card:·
    \"/Users/eryk.napierala/.bun/bin/bun\" \"/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-app-CGqvSv/app/src/cli/main.ts\" convos·
Then print what one of them said, by its session id, its home card or its tab name. Each --grep keeps only the messages that contain its term:·
    \"/Users/eryk.napierala/.bun/bin/bun\" \"/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-app-CGqvSv/app/src/cli/main.ts\" recall <session-id> --grep \"term\"·
Never answer that you have no access to another conversation. Read it.·
## Write a card about its subject·
A card describes its own subject, not the session that wrote it. A reader reads it later, cold, and must act on its subject. Session facts are stale when that reader arrives.·
1. Do not narrate the session. Do not write who said what, what came before, or what stage the conversation is at. Attribution goes in the card's \"who\" field and in the log.
2. Do not write edit history. Do not write \"X is new\", \"Y used to say Z\", or \"that no longer applies\". State the current fact.
3. Do not write where the text came from: \"moved here from #x\", \"split out of #y\", \"merged from #z\". The log records the move.
4. A reversal is a fact about the subject. A superseded card may say what replaced it and why the earlier reading was wrong, as a fact and not as a story of the conversation.·
## Keep a card at the level of the decision·
A card names behaviour and concepts. It never names a source file, a function, a class, a constant, a line number or an internal endpoint. Those change with every refactor, and the card would go stale while its decision still holds. The code points to the card, not the other way round.·
Example. A card #order-export, about a made-up shop:·
    # WRONG
    title: \"We moved the export into exportOrders() for now\"
    body:  \"This used to be part of #orders. Split out after the review.\"·
    # CORRECT
    title: \"Export is its own operation\"
    body:  \"The export writes every order as one file. See #order-format for what an order holds.\"
"]
```

# Test source

```ts
  1  | /** Step 100.5: a conversation resumed after a werk restart still carries the instructions. */
  2  | import { test as base, expect } from '@playwright/test'
  3  | import type { FakeReply } from '../../src/test/fake-agent.ts'
  4  | import { makeDev, type Dev } from './devfixture.ts'
  5  | 
  6  | const test = base.extend<{ dev: Dev }>({
  7  |   dev: async ({}, use) => {
  8  |     const dev = makeDev()
  9  |     try {
  10 |       await use(dev)
  11 |     } finally {
  12 |       await dev.cleanup()
  13 |     }
  14 |   },
  15 | })
  16 | 
  17 | const reply = (text: string, session: string): FakeReply => ({
  18 |   steps: [
  19 |     { event: { type: 'system', subtype: 'init', session_id: session } },
  20 |     { event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } },
  21 |     { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } },
  22 |   ],
  23 | })
  24 | const promptOf = (argv: string[]) => {
  25 |   const i = argv.indexOf('--append-system-prompt')
  26 |   return i === -1 ? undefined : argv[i + 1]
  27 | }
  28 | 
  29 | test('100.5 a resumed conversation after a restart still carries the instructions', async ({ page, dev }) => {
  30 |   test.setTimeout(90_000)
  31 |   dev.scriptAgent({ steps: [], roles: { chat: [reply('The earlier reply.', 's-earlier')] } })
  32 |   const first = await dev.start({})
  33 |   await page.goto(`${first.url}#map`)
  34 |   const composer = page.getByRole('textbox', { name: 'message' })
  35 |   const transcript = page.getByRole('list', { name: 'transcript' })
  36 |   await composer.fill('First message')
  37 |   await composer.press('Enter')
  38 |   await expect(transcript).toContainText('The earlier reply.')
  39 | 
  40 |   // The user restarts werk on the same port.
  41 |   // The open page reloads itself when its dev server comes back; the user waits for the page to settle.
  42 |   const reloaded = page.waitForEvent('load', { timeout: 15_000 }).catch(() => undefined)
  43 |   await first.stop()
  44 |   dev.scriptAgent({ steps: [], roles: { chat: [reply('The later reply.', 's-earlier')] } })
  45 |   await dev.start({ port: first.port })
  46 |   await reloaded
  47 | 
  48 |   // The user sends a new message in the same conversation.
  49 |   await composer.fill('A new message')
  50 |   await composer.press('Enter')
  51 |   await expect(transcript).toContainText('The later reply.')
  52 |   await expect.soft(transcript, 'the transcript still shows the earlier reply').toContainText('The earlier reply.')
  53 | 
  54 |   const launches = dev.launches().filter((l) => l.role === 'chat')
  55 |   expect(launches).toHaveLength(2)
  56 |   const resumed = launches[1]!.argv
  57 |   // The second start is a resume of the same conversation's session.
> 58 |   expect.soft(resumed, 'the second start resumes the earlier session').toEqual(expect.arrayContaining(['--resume', 's-earlier']))
     |                                                                        ^ Error: the second start resumes the earlier session
  59 |   expect(promptOf(resumed)).toMatch(/how to write a card/i)
  60 | })
  61 | 
```