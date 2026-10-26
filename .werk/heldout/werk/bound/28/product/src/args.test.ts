import { describe, expect, test } from 'bun:test'
import { DEFAULT_PORT, parseArgs } from './args.ts'

describe('parseArgs', () => {
  test('no command, help, --help and -h all ask for help', () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) expect(parseArgs(argv)).toEqual({ kind: 'help' })
  })

  test('serve uses the default port', () => {
    expect(parseArgs(['serve'])).toEqual({ kind: 'serve', port: DEFAULT_PORT })
  })

  test('serve --port takes a port, and 0 asks for any free port', () => {
    expect(parseArgs(['serve', '--port', '5000'])).toEqual({ kind: 'serve', port: 5000 })
    expect(parseArgs(['serve', '--port', '0'])).toEqual({ kind: 'serve', port: 0 })
  })

  test('serve --port refuses a missing, empty, fractional or out-of-range value', () => {
    for (const value of [undefined, '', 'x', '1.5', '-1', '65536']) {
      const argv = value === undefined ? ['serve', '--port'] : ['serve', '--port', value]
      const result = parseArgs(argv)
      expect(result.kind).toBe('error')
      if (result.kind === 'error') expect(result.message).toContain('--port needs a port number')
    }
  })

  test('serve refuses an unknown option', () => {
    expect(parseArgs(['serve', '--nope'])).toEqual({ kind: 'error', message: 'serve: unknown option: --nope' })
  })

  test('an unknown command is an error that names it', () => {
    expect(parseArgs(['frobnicate'])).toEqual({ kind: 'error', message: 'unknown command: frobnicate' })
  })

  test('show takes an optional card id', () => {
    expect(parseArgs(['show'])).toEqual({ kind: 'show', id: undefined })
    expect(parseArgs(['show', 'a'])).toEqual({ kind: 'show', id: 'a' })
    expect(parseArgs(['show', 'a', 'b'])).toEqual({ kind: 'error', message: 'show: takes at most one card id' })
    expect(parseArgs(['show', '--x', '1'])).toEqual({ kind: 'error', message: 'show: unknown option: --x' })
  })
})

describe('the commands that write the log', () => {
  const write = (...argv: string[]) => parseArgs(argv)

  test('add makes one added event, and --parent goes into that event', () => {
    expect(write('add', 'a', '--title', 'A', '--why', 'w', '--body', 'b', '--parent', 'p')).toEqual({
      kind: 'write',
      event: { type: 'added', id: 'a', kind: 'card', title: 'A', why: 'w', body: 'b', parent: 'p' },
    })
    expect(write('add', 'a:opt0', '--kind', 'option', '--title', 'O', '--why-not', 'slow')).toEqual({
      kind: 'write',
      event: { type: 'added', id: 'a:opt0', kind: 'option', title: 'O', whyNot: 'slow' },
    })
  })

  test('add refuses an unknown kind, a missing title and a missing id', () => {
    expect(write('add', 'a', '--title', 'A', '--kind', 'note')).toEqual({ kind: 'error', message: 'add: --kind is one of card, option, source, got note' })
    expect(write('add', 'a')).toEqual({ kind: 'error', message: 'add: --title is required' })
    expect(write('add', '--title', 'A')).toEqual({ kind: 'error', message: 'add: needs 1 argument(s), got 0' })
    expect(write('add', 'a', '--title')).toEqual({ kind: 'error', message: 'add: --title needs a value' })
  })

  test('link takes one of the four types', () => {
    expect(write('link', 'a', 'b', '--type', 'depends_on', '--why', 'w')).toEqual({
      kind: 'write',
      event: { type: 'linked', from: 'a', to: 'b', link: 'depends_on', why: 'w' },
    })
    expect(write('link', 'a', 'b', '--type', 'supported_by')).toEqual({ kind: 'write', event: { type: 'linked', from: 'a', to: 'b', link: 'supported_by' } })
    expect(write('link', 'a', 'b', '--type', 'blocks')).toMatchObject({ kind: 'error', message: 'link: --type is one of refines, depends_on, supported_by, alternative_to, got blocks' })
  })

  test('edit replaces exactly one field', () => {
    expect(write('edit', 'a', '--why-not', 'x')).toEqual({ kind: 'write', event: { type: 'edited', id: 'a', field: 'whyNot', text: 'x' } })
    expect(write('edit', 'a', '--body', 'x', '--why', 'y')).toEqual({ kind: 'error', message: 'edit: give exactly one of --body, --why, --why-not' })
  })

  test('the one-card verbs each make their event', () => {
    expect(write('retitle', 'a', 'New')).toEqual({ kind: 'write', event: { type: 'retitled', id: 'a', title: 'New' } })
    expect(write('decide', 'a')).toEqual({ kind: 'write', event: { type: 'decided', id: 'a' } })
    expect(write('reopen', 'a', '--why', 'postponed')).toEqual({ kind: 'write', event: { type: 'reopened', id: 'a', why: 'postponed' } })
    expect(write('remove', 'a')).toEqual({ kind: 'write', event: { type: 'removed', id: 'a' } })
    expect(write('restore', 'a')).toEqual({ kind: 'write', event: { type: 'restored', id: 'a' } })
    expect(write('say', 'a', 'quote', '--who', 'Eryk')).toEqual({ kind: 'write', event: { type: 'said', id: 'a', who: 'Eryk', text: 'quote' } })
    expect(write('dispute', 's', '--why', 'old')).toEqual({ kind: 'write', event: { type: 'disputed', id: 's', why: 'old' } })
    expect(write('reopen', 'a')).toEqual({ kind: 'error', message: 'reopen: --why is required' })
    expect(write('status', 'a', 'decided')).toEqual({ kind: 'write', event: { type: 'decided', id: 'a' } })
    expect(write('status', 'a', 'open', '--why', 'postponed')).toEqual({ kind: 'write', event: { type: 'reopened', id: 'a', why: 'postponed' } })
    expect(write('status', 'a', 'open')).toEqual({ kind: 'error', message: 'status: open needs --why' })
    expect(write('status', 'a', 'decided', '--why', 'x')).toEqual({ kind: 'error', message: 'status: decided takes no --why' })
    expect(write('status', 'a', 'done')).toEqual({ kind: 'error', message: 'status: is decided or open, got done' })
    expect(write('decide', 'a', '--now', '1')).toEqual({ kind: 'error', message: 'decide: unknown option: --now' })
  })
})
