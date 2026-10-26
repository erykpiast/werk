// End to end: a hand-authored .wgrid text goes through parse, check, resolve and render. The
// unit-level rules live in each module's own test file (parse.test.ts, check.test.ts,
// resolve.test.ts, render.test.ts, metrics.test.ts). The fixtures are the grids in .werk/.
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { check } from './check.ts'
import { parseGrid } from './parse.ts'
import { render } from './render.ts'
import { resolveGrid } from './resolve.ts'

const REPO_WERK = join(import.meta.dir, '..', '..', '.werk')
const FIXTURES = readdirSync(REPO_WERK).filter((f) => f.endsWith('.wgrid'))

describe('every hand-authored grid in .werk', () => {
  test('there are fixtures to read', () => {
    expect(FIXTURES.length).toBeGreaterThan(0)
  })

  for (const file of FIXTURES) {
    test(`${file}: checks clean and renders every card and edge`, () => {
      const doc = parseGrid(readFileSync(join(REPO_WERK, file), 'utf8'))
      const { errors, index } = check(doc)
      expect(errors).toEqual([])
      const resolved = resolveGrid(doc, index)
      expect(resolved.width).toBeGreaterThan(0)
      expect(resolved.height).toBeGreaterThan(0)
      const svg = render(resolved)
      expect(svg.startsWith('<svg')).toBe(true)
      for (const card of doc.cards) expect(svg).toContain(card.id)
      expect(render(resolved, true).length).toBeGreaterThan(svg.length)
    })
  }
})
