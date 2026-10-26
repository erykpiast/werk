# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g6/diag.spec.ts >> diag
- Location: .werk-heldout/g6/diag.spec.ts:2:1

# Error details

```
ReferenceError: require is not defined
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
          - link "Payments" [ref=e12] [cursor=pointer]:
            - /url: "#payments"
      - article [ref=e13]:
        - paragraph [ref=e14]: "#refunds proposed — not a real card until you accept it"
        - paragraph [ref=e15]:
          - 'button "Accept #refunds" [ref=e16] [cursor=pointer]': ✓
          - alert [ref=e17]: "werk: the server did not answer: Failed to fetch"
        - heading "Refunds" [level=1] [ref=e18]
        - generic [ref=e19]:
          - generic [ref=e20]:
            - term [ref=e21]: kind
            - definition [ref=e22]: card
          - generic [ref=e23]:
            - term [ref=e24]: status
            - definition [ref=e25]: open
      - region "sub-cards" [ref=e26]:
        - heading "Sub-cards" [level=2] [ref=e27]
        - paragraph [ref=e28]: No sub-cards.
  - complementary "chat" [ref=e29]:
    - list "transcript" [ref=e30]
    - generic "context" [ref=e31]:
      - link "#refunds" [ref=e32] [cursor=pointer]:
        - /url: "#refunds"
    - textbox "message" [ref=e33]:
      - /placeholder: Message the agent. Enter sends, Shift+Enter starts a new line.
    - generic [ref=e34]:
      - tablist "conversations" [ref=e35]:
        - tab "the map" [selected] [ref=e36] [cursor=pointer]
      - button "Fork at the open card" [ref=e38] [cursor=pointer]: +
      - button "New empty conversation" [ref=e39] [cursor=pointer]: ∅
```

# Test source

```ts
  1  | import { expect, test } from '../../e2e/harness.ts'
  2  | test('diag', async ({ page, werk, context }) => {
  3  |   werk.cli(['add', 'payments', '--title', 'Payments']); werk.cli(['accept', 'payments', '--actor', 'you'])
  4  |   werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  5  |   await page.goto(`${werk.url}#refunds`)
  6  |   const second = await context.newPage()
  7  |   await second.goto(werk.url)
  8  |   await expect(second.locator('li[data-card-id="refunds"]')).toHaveAttribute('data-proposed', 'true')
  9  |   const resp = page.waitForResponse(/api\/accept/, { timeout: 8000 }).then(r => 'status ' + r.status()).catch(e => 'no response: ' + e.message.slice(0, 80))
  10 |   await page.getByRole('button', { name: 'Accept #refunds' }).click()
  11 |   console.log('ACCEPT', await resp)
> 12 |   console.log('LOG', require('node:fs').readFileSync(werk.dir + '/.werk/log.jsonl', 'utf8').trim().split('\n').at(-1))
     |           ^ ReferenceError: require is not defined
  13 |   await page.waitForTimeout(3000)
  14 |   console.log('P1', await page.getByTestId('card').getAttribute('data-proposed'), 'P2', await second.locator('li[data-card-id="refunds"]').getAttribute('data-proposed'))
  15 | })
  16 | 
```