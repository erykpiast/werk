import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRun, readTicketText, ticketPath } from './board-files.ts'

const root = mkdtempSync(join(tmpdir(), 'werk-board-files-'))
const tickets = join(root, 'tickets')
mkdirSync(join(tickets, 'r'), { recursive: true })
writeFileSync(join(tickets, 'r', '01.md'), 'title: One\n\nx\n')
writeFileSync(join(tickets, 'r', 'notes.txt'), 'not a ticket')
// A folder beside tickets/: what `werk ticket import ../outside` would have read.
mkdirSync(join(root, 'outside'))
writeFileSync(join(root, 'outside', '01.md'), 'title: Secret\n\nx\n')
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('readRun', () => {
  test('reads the numbered ticket files of one run, paths relative to cwd', () => {
    expect(readRun('r', tickets, root)).toEqual([{ name: '01.md', path: join('tickets', 'r', '01.md'), text: 'title: One\n\nx\n' }])
    expect(readRun('missing', tickets, root)).toBeUndefined()
  })

  test('refuses a run id that is not a plain name, before it reads anything', () => {
    for (const run of ['../outside', '..', 'r/../../outside', '/etc']) expect(() => readRun(run, tickets, root)).toThrow('not a plan run id')
  })
})

describe('ticketPath', () => {
  test('finds the file by the ticket id only when the id is "<run>/<number>"', () => {
    expect(ticketPath({ id: 'r/01', file: '' }, tickets, root)).toBe(join(tickets, 'r', '01.md'))
    expect(ticketPath({ id: '../outside/01', file: '' }, tickets, root)).toBeUndefined()
    expect(readTicketText({ id: 'r/01', file: '' }, tickets, root)?.title).toBe('One')
    expect(readTicketText({ id: '../outside/01', file: '' }, tickets, root)).toBeUndefined()
  })
})
