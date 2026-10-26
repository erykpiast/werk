import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { planProject, read, script, spec, SUBTREE, ticket, ticketColumns, werk } from './plan-fixture.ts'

const T = 60_000
const SPEC_RULE = (stories: number, extra: Record<string, string> = {}) => ({ match: 'You are the spec writer', files: { '.werk/specs/shop.md': spec(stories), ...extra } })
const TICKETS_RULE = (tickets: Record<string, string>, extra: Record<string, string> = {}) => ({
  match: 'You are the ticket writer',
  files: { ...Object.fromEntries(Object.entries(tickets).map(([n, t]) => [`.werk/tickets/shop/${n}.md`, t])), ...extra },
})
const PATHLIKE = /[\w*.-]\/[\w*.-]+\.[A-Za-z0-9]{1,5}\b/

describe('16 plan', () => {
  test('16.1 a plan writes one spec, then tickets, and puts each on the board', () => {
    const p = planProject(SUBTREE)
    script(p, [
      SPEC_RULE(2),
      TICKETS_RULE({
        '01': ticket({ title: 'Store items', cites: 'shop, b, ext', stories: '1' }),
        '02': ticket({ title: 'Add an item', cites: 'a', blocked: '01', stories: '2' }),
      }),
    ])
    const r = werk(p, ['plan', 'shop'])
    console.log('16.1 stderr:\n' + r.stderr)
    expect(r.code).toBe(0)

    // One spec for the subtree, with every section.
    const specs = readdirSync(join(p.dir, '.werk', 'specs')).filter((f) => f.endsWith('.md'))
    expect(specs).toEqual(['shop.md'])
    expect(r.stderr).toMatch(/^spec: \S*\/\.werk\/specs\/shop\.md$/m)
    const s = read(p, '.werk/specs/shop.md')
    for (const h of ['## Problem Statement', '## Solution', '## User Stories', '## Implementation Decisions', '## Testing Decisions', '## Out of Scope']) expect(s).toContain(h)
    expect(s).toMatch(/## User Stories\n\n1\. As a /)

    // At least one ticket, each with every field, none naming a file path.
    const files = readdirSync(join(p.dir, '.werk', 'tickets', 'shop')).filter((f) => /^\d+\.md$/.test(f))
    expect(files.length).toBeGreaterThanOrEqual(1)
    for (const f of files) {
      const t = read(p, `.werk/tickets/shop/${f}`)
      for (const re of [/^title: .+$/m, /^## What to build$/m, /^## Acceptance criteria$/m, /^stories:/m, /^cites: .+$/m, /^blocked_by:/m, /^## Checks$/m]) expect(t).toMatch(re)
      expect(t).not.toMatch(PATHLIKE)
    }
    const record = JSON.parse(read(p, '.werk/tickets/shop/checks.json'))
    for (const rec of record) expect(rec.checks.find((c: any) => c.check === 'no-file-paths').ok).toBe(true)

    // The ticket state log: each ticket ready or blocked.
    const { cols, text } = ticketColumns(p, 'shop')
    console.log('16.1 ticket list:\n' + text)
    for (const f of files) {
      const id = `shop/${f.replace('.md', '')}`
      expect([...(cols.ready ?? []), ...(cols.blocked ?? [])]).toContain(id)
    }
  }, T)

  test('16.3 a set missing a required card and a story fails the set check, blocking only named tickets', () => {
    const p = planProject(SUBTREE)
    script(p, [
      SPEC_RULE(3),
      TICKETS_RULE({
        '01': ticket({ title: 'Show the list', cites: 'shop', stories: '1' }),
        '02': ticket({ title: 'Add and store an item', cites: 'a, b', stories: '2' }),
        '03': ticket({ title: 'Sort the list', cites: 'shop', stories: '1' }),
      }),
    ])
    const r = werk(p, ['plan', 'shop'])
    console.log('16.3 stderr:\n' + r.stderr)
    expect(r.code).not.toBe(0)
    const fails = r.stderr.split('\n').filter((l) => l.includes('FAIL'))
    expect(fails.some((l) => /not cited: .*\bext\b/.test(l))).toBe(true)
    expect(fails.some((l) => /not delivered: .*\b3\b/.test(l))).toBe(true)
    // Tickets the failure names (by file).
    const named = new Set([...fails.join('\n').matchAll(/\b(\d\d)\.md\b/g)].map((m) => `shop/${m[1]}`))
    console.log('16.3 tickets named by the failure:', [...named])
    const { cols, text } = ticketColumns(p, 'shop')
    console.log('16.3 ticket list:\n' + text)
    for (const id of ['shop/01', 'shop/02', 'shop/03']) {
      if (named.has(id)) expect(cols.blocked ?? []).toContain(id)
      else expect(cols.ready ?? []).toContain(id)
    }
  }, T)

  test('16.4 blocked_by follows depends_on between the cited cards', () => {
    const p = planProject(SUBTREE)
    script(p, [
      SPEC_RULE(2),
      TICKETS_RULE({
        '01': ticket({ title: 'Store items', cites: 'shop, b, ext', stories: '1' }),
        '02': ticket({ title: 'Add an item', cites: 'a', blocked: '01', stories: '2' }),
      }),
    ])
    const r1 = werk(p, ['plan', 'shop'])
    console.log('16.4 run 1 stderr:\n' + r1.stderr)
    expect(r1.code).toBe(0)
    expect(read(p, '.werk/tickets/shop/02.md')).toMatch(/^blocked_by: 01$/m)
    const rec1 = JSON.parse(read(p, '.werk/tickets/shop/checks.json'))
    for (const rec of rec1) expect(rec.checks.every((c: any) => c.ok)).toBe(true)
    const l1 = ticketColumns(p, 'shop')
    console.log('16.4 run 1 ticket list:\n' + l1.text)
    expect(l1.text).toMatch(/shop\/02 .*blocked by shop\/01/)

    script(p, [
      SPEC_RULE(2),
      TICKETS_RULE({
        '01': ticket({ title: 'Store items', cites: 'shop, b, ext', stories: '1' }),
        '02': ticket({ title: 'Add an item', cites: 'a', blocked: '', stories: '2' }),
      }),
    ])
    const r2 = werk(p, ['plan', 'shop'])
    console.log('16.4 run 2 stderr:\n' + r2.stderr)
    expect(read(p, '.werk/tickets/shop/02.md')).toMatch(/^blocked_by: *$/m)
    expect(r2.code).not.toBe(0)
    // A failure that names ticket 02.
    expect(r2.stderr.split('\n').some((l) => l.includes('FAIL') && /\b02\.md\b/.test(l))).toBe(true)
    const rec2 = JSON.parse(read(p, '.werk/tickets/shop/checks.json'))
    console.log('16.4 run 2 own checks of 02.md:', JSON.stringify(rec2.find((x: any) => x.file === '02.md').checks))
    const l2 = ticketColumns(p, 'shop')
    console.log('16.4 run 2 ticket list:\n' + l2.text)
    expect(l2.cols.blocked ?? []).toContain('shop/02')
    expect(l2.text).not.toMatch(/shop\/02 .*blocked by shop\/01/)
  }, T)

  test('16.5 own check passes an empty stories line and fails a file path or a missing field', () => {
    const p = planProject(SUBTREE)
    script(p, [
      SPEC_RULE(2),
      TICKETS_RULE({
        '01': ticket({ title: 'Prefactor the list module', cites: 'b', stories: '' }),
        '02': ticket({ title: 'Add an item', cites: 'a', stories: '1', what: 'Add an item; the change goes in src/list.ts.' }),
        '03': ticket({ title: 'Show the list', cites: 'shop', stories: '2', noAcceptance: true }),
        '04': ticket({ title: 'Whole list', cites: 'shop, a, b, ext', stories: '1, 2' }),
      }),
    ])
    const r = werk(p, ['plan', 'shop'])
    console.log('16.5 stderr:\n' + r.stderr)
    const rec = JSON.parse(read(p, '.werk/tickets/shop/checks.json'))
    const own = (f: string) => rec.find((x: any) => x.file === f).checks as Array<{ check: string; ok: boolean; detail: string }>
    expect(own('01.md').every((c) => c.ok)).toBe(true)
    expect(own('02.md').find((c) => c.check === 'no-file-paths')!.ok).toBe(false)
    expect(own('03.md').find((c) => c.check === 'acceptance')!.ok).toBe(false)
    expect(r.stderr).toMatch(/FAIL\s+02\.md\s+names file paths: src\/list\.ts/)
    expect(r.stderr).toMatch(/FAIL\s+03\.md\s+0 acceptance criteria/)
    const { cols, text } = ticketColumns(p, 'shop')
    console.log('16.5 ticket list:\n' + text)
    expect(cols.ready ?? []).toContain('shop/01')
    expect(cols.ready ?? []).toContain('shop/04')
    expect(cols.blocked ?? []).toContain('shop/02')
    expect(cols.blocked ?? []).toContain('shop/03')
  }, T)
})
