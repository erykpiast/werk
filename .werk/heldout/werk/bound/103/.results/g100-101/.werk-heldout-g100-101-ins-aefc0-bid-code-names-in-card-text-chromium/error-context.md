# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g100-101/instructions.spec.ts >> 100.2 the instructions forbid code names in card text
- Location: .werk-heldout/g100-101/instructions.spec.ts:51:1

# Error details

```
Error: expect(received).toMatch(expected)

Expected pattern: /child cards?/i
Received string:  "# werk — how to write a card on the map·
This project keeps its decisions in a werk map. You read and write the map with the werk command line:·
    \"/Users/eryk.napierala/.bun/bin/bun\" \"/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-app-pQENkt/app/src/cli/main.ts\" <verb> ...·
## Read a card from the map before you write it·
Read a card from the map before you write it. Print it with:·
    \"/Users/eryk.napierala/.bun/bin/bun\" \"/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-app-pQENkt/app/src/cli/main.ts\" show <id>·
Your own context can be stale. Another conversation can have changed or decided the card since you last read it. The map on disk is always current, so the card you print is the card you change. Never write a card from what you remember of it.·
## Read another conversation from its transcript·
Other conversations of this project run beside you, and none of them tells you what it said. When you need what another conversation said, read it from its transcript on disk. List every conversation with its session id and its home card:·
    \"/Users/eryk.napierala/.bun/bin/bun\" \"/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-app-pQENkt/app/src/cli/main.ts\" convos·
Then print what one of them said, by its session id, its home card or its tab name. Each --grep keeps only the messages that contain its term:·
    \"/Users/eryk.napierala/.bun/bin/bun\" \"/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-app-pQENkt/app/src/cli/main.ts\" recall <session-id> --grep \"term\"·
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
"
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - navigation "views" [ref=e5]:
      - link "Map" [ref=e6] [cursor=pointer]:
        - /url: "#"
      - link "Board" [ref=e7] [cursor=pointer]:
        - /url: "#/board"
    - main [ref=e8]:
      - navigation "breadcrumbs" [ref=e9]:
        - link "The map" [ref=e10] [cursor=pointer]:
          - /url: "#"
        - generic [ref=e11]:
          - text: /
          - 'link "werk: a visual layer over Claude Code" [ref=e12] [cursor=pointer]':
            - /url: "#werk"
        - generic [ref=e13]:
          - text: /
          - link "Draw the map in a browser" [ref=e14] [cursor=pointer]:
            - /url: "#map"
      - article [ref=e15]:
        - paragraph [ref=e16]: "#map-hash"
        - heading "The open card lives in the location hash" [level=1] [ref=e17]
        - generic [ref=e18]:
          - text: "why:"
          - paragraph [ref=e20]: A view can be shared, and it stays after a reload.
        - paragraph [ref=e23]: The address bar names the open card.
        - generic [ref=e24]:
          - generic [ref=e25]:
            - term [ref=e26]: kind
            - definition [ref=e27]: card
          - generic [ref=e28]:
            - term [ref=e29]: who
            - definition [ref=e30]: me
      - region "sub-cards" [ref=e31]:
        - heading "Sub-cards" [level=2] [ref=e32]
        - paragraph [ref=e33]: No sub-cards.
  - complementary "chat" [ref=e34]:
    - list "transcript" [ref=e35]:
      - listitem [ref=e36]:
        - generic [ref=e37]: What does this card decide?
        - generic "reply" [ref=e38]:
          - paragraph [ref=e40]: Ok.
        - paragraph [ref=e41]: 0.1s · $0.01
    - generic "context" [ref=e42]:
      - link "#map-hash" [ref=e43] [cursor=pointer]:
        - /url: "#map-hash"
    - textbox "message" [active] [ref=e44]:
      - /placeholder: Message the agent. Enter sends, Shift+Enter starts a new line.
    - generic [ref=e45]:
      - tablist "conversations" [ref=e46]:
        - tab "the map" [ref=e47] [cursor=pointer]
        - tab "#map-hash" [selected] [ref=e49] [cursor=pointer]
      - button "Fork at the open card" [ref=e51] [cursor=pointer]: +
      - button "New empty conversation" [ref=e52] [cursor=pointer]: ∅
```

# Test source

```ts
  1  | /** Steps 100.1-100.4: every chat conversation carries the card instructions in its system prompt. */
  2  | import type { FakeReply } from '../../src/test/fake-agent.ts'
  3  | import { expect, test, type Werk } from '../../e2e/harness.ts'
  4  | 
  5  | const reply = (text: string, session = 's-1'): FakeReply => ({
  6  |   steps: [
  7  |     { event: { type: 'system', subtype: 'init', session_id: session } },
  8  |     { event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } },
  9  |     { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } },
  10 |   ],
  11 | })
  12 | 
  13 | /** The system prompt text appended in a launch argv, or undefined. */
  14 | const systemPrompt = (argv: string[]) => {
  15 |   const i = argv.indexOf('--append-system-prompt')
  16 |   return i === -1 ? undefined : argv[i + 1]
  17 | }
  18 | 
  19 | const instructionsOf = (werk: Werk, n: number) => {
  20 |   const launch = werk.agentLaunches()[n]
  21 |   expect(launch, `launch ${n} exists`).toBeDefined()
  22 |   const prompt = systemPrompt(launch!)
  23 |   expect(prompt, 'the launch shows a system prompt').toBeDefined()
  24 |   expect(prompt).toMatch(/how to write a card/i)
  25 |   return prompt!
  26 | }
  27 | 
  28 | const send = async (page: import('@playwright/test').Page, text: string) => {
  29 |   const composer = page.getByRole('textbox', { name: 'message' })
  30 |   await composer.fill(text)
  31 |   await composer.press('Enter')
  32 | }
  33 | 
  34 | test('100.1 a new chat conversation starts with the card wording rules in its system prompt', async ({ page, werk }) => {
  35 |   werk.scriptAgent({ steps: [], roles: { chat: [reply('Hi there.')] } })
  36 |   await page.goto(werk.url)
  37 |   await expect(page.getByRole('textbox', { name: 'message' })).toBeVisible()
  38 |   const chat = page.getByRole('complementary', { name: 'chat' })
  39 |   await chat.getByRole('button', { name: 'New empty conversation' }).click()
  40 |   await expect(chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab')).toHaveCount(2)
  41 |   await send(page, 'hello')
  42 |   await expect(chat.getByRole('list', { name: 'transcript' })).toContainText('Hi there.')
  43 |   const launches = werk.agentLaunches()
  44 |   expect(launches).toHaveLength(1)
  45 |   const text = instructionsOf(werk, 0)
  46 |   expect(text).toContain('A card describes its own subject, not the session that wrote it.')
  47 |   expect(text).toMatch(/Do not narrate the session\. Do not write who said what/)
  48 |   expect(text).toMatch(/Do not write edit history/)
  49 | })
  50 | 
  51 | test('100.2 the instructions forbid code names in card text', async ({ page, werk }) => {
  52 |   werk.scriptAgent({ steps: [], roles: { chat: [reply('Ok.')] } })
  53 |   await page.goto(`${werk.url}#map`)
  54 |   const chat = page.getByRole('complementary', { name: 'chat' })
  55 |   await page.getByTestId('card').locator('..').getByRole('link', { name: /#map-hash/ }).click({ modifiers: ['Shift'] })
  56 |   await expect(chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab')).toHaveCount(2)
  57 |   await send(page, 'What does this card decide?')
  58 |   await expect(chat.getByRole('list', { name: 'transcript' })).toContainText('Ok.')
  59 |   const text = instructionsOf(werk, werk.agentLaunches().length - 1)
  60 |   expect(text).toContain('A card names behaviour and concepts.')
  61 |   expect(text).toMatch(/never names a source file, a function, a class, a constant, a line number or an internal endpoint/)
  62 |   // A card does not list its child cards.
> 63 |   expect(text).toMatch(/child cards?/i)
     |                ^ Error: expect(received).toMatch(expected)
  64 | })
  65 | 
  66 | test('100.3 the instructions tell the agent to read a card from the map before it writes it', async ({ page, werk }) => {
  67 |   werk.scriptAgent({ steps: [], roles: { chat: [reply('Will do.')] } })
  68 |   await page.goto(`${werk.url}#map-hash`)
  69 |   await send(page, 'Please change the body of #map-hash to say the hash holds the card id.')
  70 |   await expect(page.getByRole('list', { name: 'transcript' })).toContainText('Will do.')
  71 |   const text = instructionsOf(werk, 0)
  72 |   expect(text).toContain('Read a card from the map before you write it.')
  73 | })
  74 | 
  75 | test('100.4 a second chat conversation also gets the instructions', async ({ page, werk }) => {
  76 |   werk.scriptAgent({ steps: [], roles: { chat: [reply('A reply.', 's-a')] } })
  77 |   await page.goto(`${werk.url}#map`)
  78 |   const chat = page.getByRole('complementary', { name: 'chat' })
  79 |   const transcript = chat.getByRole('list', { name: 'transcript' })
  80 |   await send(page, 'First')
  81 |   await expect(transcript).toContainText('A reply.')
  82 |   await chat.getByRole('button', { name: 'New empty conversation' }).click()
  83 |   await expect(chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab')).toHaveCount(2)
  84 |   await send(page, 'Second')
  85 |   await expect(transcript.getByLabel('reply')).toHaveText('A reply.')
  86 |   expect(werk.agentLaunches()).toHaveLength(2)
  87 |   const first = instructionsOf(werk, 0)
  88 |   const second = instructionsOf(werk, 1)
  89 |   expect(second).toBe(first)
  90 | })
  91 | 
```