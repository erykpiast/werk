import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionTitle } from './convos.ts'

const transcript = (...records: unknown[]) => {
  const path = join(mkdtempSync(join(tmpdir(), 'werk-title-')), 's.jsonl')
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return path
}

describe('sessionTitle (#werk-mc-desc)', () => {
  test('a rename beats a generated title, and the last of each counts', () => {
    const path = transcript(
      { type: 'ai-title', aiTitle: 'first guess' },
      { type: 'custom-title', customTitle: 'renamed' },
      { type: 'ai-title', aiTitle: 'later guess' },
      { type: 'custom-title', customTitle: 'renamed again' },
    )
    expect(sessionTitle(path)).toBe('renamed again')
  })

  test('falls back to the generated title, then to an old summary record', () => {
    expect(sessionTitle(transcript({ type: 'summary', summary: 'old' }, { type: 'ai-title', aiTitle: 'new' }))).toBe('new')
    expect(sessionTitle(transcript({ type: 'summary', summary: 'old' }))).toBe('old')
  })

  test('is null for a session with no title record, or no transcript at all', () => {
    expect(sessionTitle(transcript({ type: 'user', message: { content: 'hi' } }))).toBeNull()
    expect(sessionTitle('/nonexistent/s.jsonl')).toBeNull()
  })
})
