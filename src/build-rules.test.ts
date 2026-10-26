import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRulesFor, buildRuleTitles } from './build-rules.ts'
import { fold } from './fold.ts'
import type { Event } from './types.ts'

const log = (...events: Array<[Event['type'], Record<string, unknown>]>): Event[] =>
  events.map(([type, payload], i) => ({ seq: i + 1, at: `t${i}`, actor: 'agent', type, payload }))

const events = log(
  ['node.added', { id: 'root', kind: 'card', title: 'What we build', status: 'decided' }],
  ['node.added', { id: 'export', kind: 'card', title: 'An order export holds every order', status: 'decided' }],
  ['node.added', { id: 'how', kind: 'card', title: 'How we build', status: 'decided' }],
  ['node.added', { id: 'db', kind: 'card', title: 'Tests run against a real database', status: 'decided' }],
  ['node.added', { id: 'db-seed', kind: 'card', title: 'Each test seeds its own rows', status: 'decided' }],
  ['node.added', { id: 'words', kind: 'card', title: 'Domain words', status: 'open' }],
  ['node.added', { id: 'order', kind: 'card', title: 'An order is one checkout', status: 'decided' }],
  ['node.added', { id: 'db:opt0', kind: 'option', title: 'Mock the database' }],
  ['node.proposed', { id: 'ghost', kind: 'card', title: 'A proposed rule', status: 'decided' }],
  ['edge.added', { from: 'export', to: 'root', type: 'refines' }],
  ['edge.added', { from: 'db', to: 'how', type: 'refines' }],
  ['edge.added', { from: 'db-seed', to: 'db', type: 'refines' }],
  ['edge.added', { from: 'words', to: 'how', type: 'refines' }],
  ['edge.added', { from: 'order', to: 'words', type: 'refines' }],
  ['edge.added', { from: 'db:opt0', to: 'db', type: 'alternative_to' }],
  ['edge.added', { from: 'ghost', to: 'how', type: 'refines' }],
)

const mapFile = (evs: Event[]) => {
  const path = join(mkdtempSync(join(tmpdir(), 'werk-rules-')), 'log.jsonl')
  writeFileSync(path, evs.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return path
}

describe('buildRuleTitles', () => {
  test('lists every decided card under the build-rules card, indented by depth', () => {
    const text = buildRuleTitles(fold(events))
    expect(text).toContain("## This project's build rules")
    expect(text).toContain('- #db — Tests run against a real database\n  - #db-seed — Each test seeds its own rows')
  })

  test('an open card is left out, and its decided children move up to its depth', () => {
    const text = buildRuleTitles(fold(events))
    expect(text).not.toContain('#words')
    expect(text).toContain('\n- #order — An order is one checkout')
  })

  test('a requirement, an option and a ghost are not build rules', () => {
    const text = buildRuleTitles(fold(events))
    expect(text).not.toContain('#export')
    expect(text).not.toContain('#db:opt0')
    expect(text).not.toContain('#ghost')
  })

  test('a map with no build rule gives no text at all', () => {
    expect(buildRuleTitles(fold(events.filter((e) => e.payload.to !== 'how' && e.payload.to !== 'db' && e.payload.to !== 'words')))).toBe('')
  })
})

describe('buildRulesFor', () => {
  test('a stage agent gets the titles from the map it is given', () => {
    const path = mapFile(events)
    for (const role of ['chat', 'builder', 'grader', 'reviewer-security', 'spec-writer', 'ticket-writer', 'step-author', 'binder'] as const) {
      expect(buildRulesFor(role, path)).toContain('#db')
    }
  })

  test('an agent outside the stages gets nothing', () => {
    const path = mapFile(events)
    for (const role of ['sampler', 'clusterer', 'prototyper', 'ask-classifier', 'sysdiag-scout'] as const) {
      expect(buildRulesFor(role, path)).toBe('')
    }
  })

  test('a missing or broken map gives nothing instead of failing the launch', () => {
    expect(buildRulesFor('builder', join(tmpdir(), 'no-such-map', 'log.jsonl'))).toBe('')
    const broken = mapFile([])
    writeFileSync(broken, '{not json\n')
    expect(buildRulesFor('builder', broken)).toBe('')
  })
})
