/**
 * Steps 02-16. Each test runs the Given/When steps through the werk command line in a
 * temporary project from the CLI harness, then checks the Then steps. Browser steps open the
 * page that `werk serve` prints. The verb names follow the step words (add, link, retitle,
 * show, map, status, amend, accept, discard, reopen, review, quote, plan).
 */
import { expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { makeProject, startServer, type Project, type RunResult } from './lib.ts'

const T = 120_000

async function ok(p: Project, ...args: string[]): Promise<RunResult> {
  const r = await p.werk(...args)
  expect({ cmd: `werk ${args.join(' ')}`, code: r.code, out: r.stdout + r.stderr })
    .toEqual({ cmd: `werk ${args.join(' ')}`, code: 0, out: expect.any(String) })
  return r
}
async function refused(p: Project, ...args: string[]): Promise<RunResult> {
  const r = await p.werk(...args)
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).not.toMatch(/unknown verb/)
  return r
}
function log(p: Project): string {
  const f = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8') : ''
}
const lines = (s: string) => s.split('\n').filter(Boolean).length

async function withPage(p: Project, hash: string, fn: (page: Page) => Promise<void>) {
  const s = await startServer(p.dir, p.env)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(s.url + hash)
    await fn(page)
  } finally { await browser.close(); s.stop() }
}

function scenario(id: string, body: (p: Project) => Promise<void>) {
  test(id, async () => {
    const p = await makeProject()
    try { await body(p) } finally { p.cleanup() }
  }, T)
}

scenario('02.1 retitle appends one event', async (p) => {
  await ok(p, 'add', 'a', '--title', 'Use a log')
  await ok(p, 'add', 'b', '--title', 'Cards fold from it')
  await ok(p, 'link', 'b', 'refines', 'a')
  const saved = log(p)
  await ok(p, 'retitle', 'a', 'Use an append-only log')
  const now = log(p)
  expect(lines(now)).toBe(lines(saved) + 1)
  expect(now.startsWith(saved)).toBe(true)
  const map = (await ok(p, 'map')).stdout
  const show = (await ok(p, 'show', 'a')).stdout
  expect(map).toContain('Use an append-only log')
  expect(show).toContain('Use an append-only log')
  expect(map.replaceAll('Use an append-only log', '')).not.toContain('Use a log')
  expect(show.replaceAll('Use an append-only log', '')).not.toContain('Use a log')
  expect(now).toContain('Use a log')
})

scenario('02.2 CLI add shows in open page without reload', async (p) => {
  await ok(p, 'add', 'a', '--title', 'Use an append-only log')
  await withPage(p, '', async (page) => {
    await page.getByText('Use an append-only log').waitFor()
    let reloaded = false
    page.on('load', () => { reloaded = true })
    await ok(p, 'add', 'c', '--title', 'Fold is pure')
    await ok(p, 'link', 'c', 'refines', 'a')
    await page.getByText('Fold is pure').waitFor()
    expect(reloaded).toBe(false)
  })
})

scenario('02.3 CLI status change shows in browser and CLI', async (p) => {
  await ok(p, 'add', 'a', '--title', 'Use an append-only log')
  await withPage(p, '', async (page) => {
    await page.getByText('Use an append-only log').waitFor()
    const before = log(p)
    await ok(p, 'status', 'a', 'decided')
    await page.getByText(/decided/i).first().waitFor()
    expect((await ok(p, 'show', 'a')).stdout).toMatch(/decided/)
    const now = log(p)
    expect(now.startsWith(before)).toBe(true)
    expect(lines(now)).toBe(lines(before) + 1)
  })
})

scenario('02.4 hash opens a card and survives reload', async (p) => {
  await ok(p, 'add', 'a', '--title', 'Use an append-only log')
  await ok(p, 'add', 'b', '--title', 'Cards fold from it')
  await ok(p, 'link', 'b', 'refines', 'a')
  await withPage(p, '#b', async (page) => {
    await page.getByRole('heading', { name: 'Cards fold from it' }).waitFor()
    await page.reload()
    await page.getByRole('heading', { name: 'Cards fold from it' }).waitFor()
  })
})

scenario('02.5 page control appends one event', async (p) => {
  await ok(p, 'add', 'a', '--title', 'Use an append-only log')
  await ok(p, 'add', 'b', '--title', 'Cards fold from it')
  await ok(p, 'link', 'b', 'refines', 'a')
  const saved = log(p)
  await withPage(p, '#b', async (page) => {
    await page.getByRole('heading', { name: 'Cards fold from it' }).waitFor()
    await page.getByRole('button', { name: /open|decide|status/i }).first().click()
    await page.waitForTimeout(500)
    const now = log(p)
    expect(lines(now)).toBe(lines(saved) + 1)
    expect(now.startsWith(saved)).toBe(true)
    const show = (await ok(p, 'show', 'b')).stdout
    const status = show.match(/status:\s*(\w+)/)?.[1] ?? ''
    await page.getByText(status).first().waitFor()
  })
})

async function fullCard(p: Project, id: string, omit: string) {
  await ok(p, 'add', id, '--title', `Card ${id}`)
  if (omit !== 'decider') await ok(p, 'amend', id, '--decider', 'eryk')
  if (omit !== 'basis') { await ok(p, 'add', `${id}-base`, '--title', 'Base'); await ok(p, 'link', id, 'depends_on', `${id}-base`) }
  if (omit !== 'options') await ok(p, 'option', id, '--rejected', 'Other', '--why-not', 'slower')
  if (omit !== 'kill') await ok(p, 'amend', id, '--kill', 'drop it if X')
}

scenario('03.1 missing kill criteria blocks decided; printed command fixes it', async (p) => {
  await fullCard(p, 'k', 'kill')
  const before = log(p)
  const r = await refused(p, 'status', 'k', 'decided')
  expect(r.stdout + r.stderr).toMatch(/kill/i)
  const cmd = (r.stdout + r.stderr).match(/werk [^\n]+/)?.[0]
  expect(cmd).toBeDefined()
  expect(log(p)).toBe(before)
  expect((await ok(p, 'map')).stdout).not.toMatch(/k.*decided/)
  const args = cmd!.replace(/^werk /, '').replace(/<[^>]+>/, 'drop it if X').split(' ')
  await ok(p, ...args)
  await ok(p, 'status', 'k', 'decided')
  expect((await ok(p, 'map')).stdout).toMatch(/decided/)
})

scenario('03.2 each missing fact prints its own command', async (p) => {
  const omits = ['decider', 'basis', 'options', 'kill']
  const cmds: string[] = []
  for (const [i, o] of omits.entries()) await fullCard(p, `c${i}`, o)
  for (const i of omits.keys()) {
    const before = log(p)
    const r = await refused(p, 'status', `c${i}`, 'decided')
    expect(log(p)).toBe(before)
    cmds.push((r.stdout + r.stderr).match(/werk [^\n]+/)?.[0] ?? '')
  }
  expect(new Set(cmds).size).toBe(4)
})

scenario('03.3 stated lack of basis and unchallenged flag satisfy the check', async (p) => {
  await ok(p, 'add', 'x', '--title', 'X')
  await ok(p, 'amend', 'x', '--decider', 'eryk', '--kill', 'drop if Y')
  await ok(p, 'amend', 'x', '--no-basis', 'first principle')
  await ok(p, 'amend', 'x', '--unchallenged')
  await ok(p, 'status', 'x', 'decided')
  const map = (await ok(p, 'map')).stdout
  expect(map).toMatch(/decided/)
  expect(map).toContain('first principle')
  expect(map).toMatch(/unchallenged/)
})

scenario('03.4 amend cannot remove a required fact', async (p) => {
  await fullCard(p, 'd', '')
  await ok(p, 'status', 'd', 'decided')
  const before = log(p)
  const r = await refused(p, 'amend', 'd', '--kill', '')
  expect(r.stdout + r.stderr).toMatch(/werk [^\n]*kill/)
  expect(log(p)).toBe(before)
  await ok(p, 'amend', 'd', '--body', 'new text')
  expect((await ok(p, 'map')).stdout).toContain('new text')
})

scenario('03.5 add and open are not checked; decided is', async (p) => {
  await ok(p, 'add', 'e', '--title', 'Only title', '--body', 'Only body')
  await ok(p, 'status', 'e', 'open')
  await refused(p, 'status', 'e', 'decided')
  expect((await ok(p, 'show', 'e')).stdout).toMatch(/open/)
})

scenario('04.1 agent add is a ghost until ✓', async (p) => {
  await ok(p, 'add', 'checkout', '--title', 'Checkout flow')
  await ok(p, 'accept', 'checkout', '--person-asked')
  const r = await ok(p, 'add', 'retry', '--title', 'Retry payment', '--under', 'checkout')
  expect(r.stdout).toContain('proposed')
  expect(r.stdout).not.toContain('added')
})

scenario('04.2 accepting a ghost child accepts its ghost parent and held edge', async (p) => {
  await ok(p, 'add', 'payments', '--title', 'Payments')
  await ok(p, 'add', 'fraud', '--title', 'Fraud rules')
  await ok(p, 'add', 'refunds', '--title', 'Refunds', '--under', 'payments')
  await ok(p, 'add', 'partial', '--title', 'Partial refunds', '--under', 'refunds')
  await ok(p, 'link', 'partial', 'depends_on', 'fraud')
  await withPage(p, '', async (page) => {
    await page.getByText('Partial refunds').waitFor()
    await page.getByRole('button', { name: '✓' }).first().click()
  })
})

scenario('04.3 discarding a ghost parent drops ghost children', async (p) => {
  await ok(p, 'add', 'onb', '--title', 'Onboarding')
  await ok(p, 'add', 'ev', '--title', 'Email verification', '--under', 'onb')
  await ok(p, 'add', 're', '--title', 'Resend email', '--under', 'ev')
  await ok(p, 'discard', 'ev')
  const map = (await ok(p, 'map')).stdout
  expect(map).not.toContain('Email verification')
  expect(map).not.toContain('Resend email')
})

scenario('04.4 ghost words are frozen but status can be proposed', async (p) => {
  await ok(p, 'add', 'search', '--title', 'Search')
  await ok(p, 'add', 'search-index', '--title', 'Search index', '--under', 'search')
  await refused(p, 'add', 'search-index', '--title', 'Other words')
  await refused(p, 'amend', 'search-index', '--body', 'x')
  await refused(p, 'retitle', 'search-index', 'y')
  await ok(p, 'amend', 'search-index', '--who', 'eryk')
})

scenario('04.5 CLI accept needs the person-asked statement', async (p) => {
  await ok(p, 'add', 'root', '--title', 'Root')
  await ok(p, 'add', 'audit', '--title', 'Audit log', '--under', 'root')
  const before = log(p)
  await refused(p, 'accept', 'audit')
  expect(log(p)).toBe(before)
  await ok(p, 'accept', 'audit', '--person-asked')
})

scenario('05.1 reopen without reason is refused', async (p) => {
  await ok(p, 'add', 'pricing', '--title', 'Pricing')
  await ok(p, 'add', 'checkout', '--title', 'Checkout')
  await ok(p, 'link', 'checkout', 'depends_on', 'pricing')
  await ok(p, 'status', 'pricing', 'decided')
  const r = await refused(p, 'reopen', 'pricing')
  expect(r.stdout + r.stderr).toMatch(/postponed|rejected/)
})

scenario('05.2 rejected reopen marks next hop stale', async (p) => {
  for (const [id, t] of [['storage', 'Storage'], ['api', 'API'], ['client', 'Client'], ['schema', 'Schema']]) await ok(p, 'add', id!, '--title', t!)
  await ok(p, 'link', 'api', 'depends_on', 'storage')
  await ok(p, 'link', 'client', 'depends_on', 'api')
  await ok(p, 'link', 'schema', 'refines', 'storage')
  await ok(p, 'reopen', 'storage', '--reason', 'rejected')
  const st = (await ok(p, 'stale')).stdout
  expect(st).toContain('API')
  expect(st).toContain('Schema')
  expect(st).not.toContain('Client')
})

scenario('05.3 postponed reopen pauses every downstream card', async (p) => {
  for (const [id, t] of [['engine', 'Engine'], ['parser', 'Parser'], ['renderer', 'Renderer'], ['export', 'Export']]) await ok(p, 'add', id!, '--title', t!)
  await ok(p, 'link', 'parser', 'depends_on', 'engine')
  await ok(p, 'link', 'renderer', 'depends_on', 'parser')
  await ok(p, 'link', 'export', 'depends_on', 'renderer')
  await ok(p, 'reopen', 'engine', '--reason', 'postponed')
  const st = (await ok(p, 'stale')).stdout
  for (const t of ['Parser', 'Renderer', 'Export']) expect(st).toContain(t)
})

scenario('05.4 stale wins over paused', async (p) => {
  for (const [id, t] of [['billing', 'Billing'], ['auth', 'Auth'], ['ledger', 'Ledger'], ['report', 'Report']]) await ok(p, 'add', id!, '--title', t!)
  await ok(p, 'link', 'billing', 'depends_on', 'auth')
  await ok(p, 'link', 'billing', 'depends_on', 'ledger')
  await ok(p, 'link', 'report', 'depends_on', 'billing')
  await ok(p, 'reopen', 'auth', '--reason', 'postponed')
  await ok(p, 'reopen', 'ledger', '--reason', 'rejected')
  expect((await ok(p, 'stale')).stdout).toMatch(/Billing.*rejected/)
})

scenario('05.5 clearing one stale mark leaves others', async (p) => {
  for (const [id, t] of [['index', 'Index'], ['search', 'Search'], ['filters', 'Filters']]) await ok(p, 'add', id!, '--title', t!)
  await ok(p, 'link', 'search', 'depends_on', 'index')
  await ok(p, 'link', 'filters', 'depends_on', 'index')
  await ok(p, 'reopen', 'index', '--reason', 'rejected')
  await ok(p, 'review', 'search', '--unchanged')
  const st = (await ok(p, 'stale')).stdout
  expect(st).not.toContain('Search')
  expect(st).toContain('Filters')
})

function transcript(p: Project, msgs: [string, string][]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', 'x')
  mkdirSync(dir, { recursive: true })
  const f = join(dir, 'sess-1.jsonl')
  writeFileSync(f, msgs.map(([role, text]) => JSON.stringify({ type: role, message: { role, content: text } })).join('\n') + '\n')
  return 'sess-1'
}

scenario('06.1 exact quote becomes a ghost excerpt', async (p) => {
  const s = transcript(p, [['user', 'I think the map is a view of the log, always.']])
  await ok(p, 'add', 'c', '--title', 'Card')
  await ok(p, 'quote', 'c', '--session', s, '--text', 'the map is a view of the log')
})

scenario('06.2 excerpt span selects the quoted text exactly', async (p) => {
  const s = transcript(p, [['assistant', 'We fold it. Every change is a new event in the log. Then we draw.']])
  await ok(p, 'add', 'c', '--title', 'Card')
  await ok(p, 'quote', 'c', '--session', s, '--text', 'Every change is a new event in the log.')
})

scenario('06.3 a one-character change fails', async (p) => {
  const s = transcript(p, [['user', 'No view edits a drawn card in place.']])
  await ok(p, 'add', 'c', '--title', 'Card')
  const before = log(p)
  const r = await refused(p, 'quote', 'c', '--session', s, '--text', 'No view edits a drawn card in places.')
  expect(r.stdout + r.stderr).toMatch(/no exact match/i)
  expect(log(p)).toBe(before)
})

scenario('06.4 a quote in two messages is ambiguous', async (p) => {
  const s = transcript(p, [['user', 'Remember: the tool never guesses.'], ['assistant', 'Yes, the tool never guesses at all.']])
  await ok(p, 'add', 'c', '--title', 'Card')
  const before = log(p)
  const r = await refused(p, 'quote', 'c', '--session', s, '--text', 'the tool never guesses')
  expect(r.stdout + r.stderr).toMatch(/more than one/i)
  expect(log(p)).toBe(before)
})

scenario('06.5 accepted excerpt shows in the card view', async (p) => {
  const s = transcript(p, [['user', 'the map is a view of the log']])
  await ok(p, 'add', 'c', '--title', 'Card')
  await ok(p, 'quote', 'c', '--session', s, '--text', 'the map is a view of the log')
})

scenario('07.1 known card reference in a body opens that card', async (p) => {
  await ok(p, 'add', 'al-diff', '--title', 'Al diff')
  await ok(p, 'add', 'notes-card', '--title', 'Notes', '--body', 'see #al-diff and #ghost-card for details')
  await withPage(p, '#notes-card', async (page) => {
    await page.getByRole('link', { name: '#al-diff' }).click()
    expect(page.url()).toContain('#al-diff')
  })
})

scenario('07.2 bare ids and code spans link only with id shape', async (p) => {
  await ok(p, 'add', 'align', '--title', 'Align')
  await ok(p, 'add', 'al-diff', '--title', 'Al diff')
  await ok(p, 'add', 'pr-iface:opt0', '--title', 'Opt 0')
  await ok(p, 'add', 'w', '--title', 'W', '--why', 'compare al-diff with pr-iface:opt0, then align the rest')
  await withPage(p, '#w', async (page) => {
    await page.getByRole('link', { name: 'al-diff' }).first().waitFor()
  })
})

scenario('07.3 fenced blocks, headings and URL fragments stay', async (p) => {
  await ok(p, 'add', 'al-diff', '--title', 'Al diff')
  await ok(p, 'add', 'h', '--title', 'H', '--body', '# al-diff\n\n```\n#al-diff\n```\n\n[page](https://example.com/page#al-diff)')
  await withPage(p, '#h', async (page) => {
    await page.getByRole('heading', { name: 'al-diff' }).waitFor()
  })
})

scenario('07.4 grid tile summary shows a reference with no link', async (p) => {
  await ok(p, 'add', 'al-diff', '--title', 'Al diff')
  await ok(p, 'add', 's', '--title', 'S', '--summary', 'depends on #al-diff')
  await withPage(p, '', async (page) => {
    await page.getByText('depends on #al-diff').click()
    expect(page.url()).toContain('#s')
  })
})

scenario('07.5 fenced code is boxed and highlighted', async (p) => {
  const body = '```json\n{\n      "a":1,\n  "b": "' + 'x'.repeat(400) + '"\n}\n```\n\n```js\nconst a = 1\n```\n\n```ts\nlet b: number = 2\n```\n\n```bash\necho hi\n```'
  await ok(p, 'add', 'code', '--title', 'Code', '--body', body)
  await withPage(p, '#code', async (page) => {
    expect(await page.locator('pre').count()).toBe(4)
  })
})

scenario('16.1 plan writes one spec and tickets', async (p) => {
  await ok(p, 'add', 'root', '--title', 'Root')
  await ok(p, 'plan', 'root')
})
scenario('16.2 writer answers come back as proposed cards', async (p) => {
  await ok(p, 'add', 'root', '--title', 'Root')
  await ok(p, 'plan', 'root')
})
scenario('16.3 set check blocks only the named tickets', async (p) => {
  await ok(p, 'add', 'root', '--title', 'Root')
  await ok(p, 'plan', 'root')
})
scenario('16.4 blocked_by follows depends_on', async (p) => {
  await ok(p, 'add', 'a', '--title', 'A')
  await ok(p, 'add', 'b', '--title', 'B')
  await ok(p, 'link', 'a', 'depends_on', 'b')
  await ok(p, 'plan', 'a')
})
scenario('16.5 ticket own check', async (p) => {
  await ok(p, 'add', 'root', '--title', 'Root')
  await ok(p, 'plan', 'root')
})
