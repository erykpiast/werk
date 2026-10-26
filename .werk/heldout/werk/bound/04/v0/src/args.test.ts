import { describe, expect, test } from 'bun:test'
import { DEFAULT_PORT, parseArgs } from './args.ts'
import { KINDS } from './map/events.ts'

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

  test('add makes one proposed event, never an added one, and --parent goes into that event', () => {
    expect(write('add', 'a', '--title', 'A', '--why', 'w', '--body', 'b', '--parent', 'p')).toEqual({
      kind: 'write',
      event: { type: 'proposed', id: 'a', kind: 'card', title: 'A', why: 'w', body: 'b', parent: 'p' },
    })
    expect(write('add', 'a:opt0', '--kind', 'option', '--title', 'O', '--why-not', 'slow')).toEqual({
      kind: 'write',
      event: { type: 'proposed', id: 'a:opt0', kind: 'option', title: 'O', whyNot: 'slow' },
    })
  })

  test('add refuses an unknown kind, a missing title and a missing id', () => {
    expect(write('add', 'a', '--title', 'A', '--kind', 'note')).toEqual({ kind: 'error', message: 'add: --kind is one of card, option, source, excerpt, got note' })
    expect(write('add', 'a')).toEqual({ kind: 'error', message: 'add: --title is required' })
    expect(write('add', '--title', 'A')).toEqual({ kind: 'error', message: 'add: needs 1 argument(s), got 0' })
    expect(write('add', 'a', '--title')).toEqual({ kind: 'error', message: 'add: --title needs a value' })
  })

  test('add of each kind, card, option, source and excerpt, proposes', () => {
    for (const kind of KINDS) {
      expect(write('add', 'x', '--kind', kind, '--title', 'X')).toEqual({ kind: 'write', event: { type: 'proposed', id: 'x', kind, title: 'X' } })
    }
  })

  test('accept refuses unless --actor you states that the person asked for it', () => {
    expect(write('accept', 'a', '--actor', 'you')).toEqual({ kind: 'write', event: { type: 'accepted', id: 'a' } })
    for (const argv of [['accept', 'a'], ['accept', 'a', '--actor', 'me']]) {
      const result = write(...argv)
      expect(result.kind).toBe('error')
      if (result.kind === 'error') expect(result.message).toStartWith('accept: only the person accepts a proposal.')
    }
    expect(write('accept', 'a', 'b', '--actor', 'you')).toEqual({ kind: 'error', message: 'accept: needs 1 argument(s), got 2' })
  })

  test('discard drops one ghost', () => {
    expect(write('discard', 'a')).toEqual({ kind: 'write', event: { type: 'discarded', id: 'a' } })
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
    expect(write('edit', 'a', '--body', 'x', '--why', 'y')).toEqual({ kind: 'error', message: 'edit: give exactly one of --body, --why, --why-not, --who, --no-basis, --unchallenged' })
  })

  test('edit records one contract fact: who, or a waiver with its reason', () => {
    expect(write('edit', 'a', '--who', 'you')).toEqual({ kind: 'write', event: { type: 'recorded', id: 'a', fact: 'who', value: 'you' } })
    expect(write('edit', 'a', '--no-basis', 'the root')).toEqual({ kind: 'write', event: { type: 'recorded', id: 'a', fact: 'noBasis', value: 'the root' } })
    expect(write('edit', 'a', '--unchallenged', 'one way')).toEqual({ kind: 'write', event: { type: 'recorded', id: 'a', fact: 'unchallenged', value: 'one way' } })
    expect(write('edit', 'a', '--who', 'them')).toEqual({ kind: 'error', message: 'edit: --who is one of you, me, prototype, got them' })
    expect(write('edit', 'a', '--who', 'me', '--no-basis', 'x')).toMatchObject({ kind: 'error' })
  })

  test('kill adds one criterion', () => {
    expect(write('kill', 'a', 'revisit at any time')).toEqual({ kind: 'write', event: { type: 'killAdded', id: 'a', text: 'revisit at any time' } })
    expect(write('kill', 'a')).toEqual({ kind: 'error', message: 'kill: needs 2 argument(s), got 1' })
  })

  test('add takes who and the card an option is weighed against', () => {
    expect(write('add', 'a:opt0', '--kind', 'option', '--title', 'O', '--alternative-to', 'a')).toEqual({
      kind: 'write',
      event: { type: 'proposed', id: 'a:opt0', kind: 'option', title: 'O', alternativeTo: 'a' },
    })
    expect(write('add', 'a', '--title', 'A', '--who', 'me')).toEqual({ kind: 'write', event: { type: 'proposed', id: 'a', kind: 'card', title: 'A', who: 'me' } })
    expect(write('add', 'a', '--title', 'A', '--who', 'them')).toEqual({ kind: 'error', message: 'add: --who is one of you, me, prototype, got them' })
  })

  test('the one-card verbs each make their event', () => {
    expect(write('retitle', 'a', 'New')).toEqual({ kind: 'write', event: { type: 'retitled', id: 'a', title: 'New' } })
    expect(write('decide', 'a')).toEqual({ kind: 'write', event: { type: 'decided', id: 'a' } })
    expect(write('reopen', 'a', '--reason', 'postponed', '--why', 'later')).toEqual({ kind: 'write', event: { type: 'reopened', id: 'a', reason: 'postponed', why: 'later' } })
    expect(write('remove', 'a')).toEqual({ kind: 'write', event: { type: 'removed', id: 'a' } })
    expect(write('restore', 'a')).toEqual({ kind: 'write', event: { type: 'restored', id: 'a' } })
    expect(write('say', 'a', 'quote', '--who', 'Eryk')).toEqual({ kind: 'write', event: { type: 'said', id: 'a', who: 'Eryk', text: 'quote' } })
    expect(write('dispute', 's', '--why', 'old')).toEqual({ kind: 'write', event: { type: 'disputed', id: 's', why: 'old' } })
    expect(write('status', 'a', 'decided')).toEqual({ kind: 'write', event: { type: 'decided', id: 'a' } })
    expect(write('status', 'a', 'open', '--reason', 'rejected', '--why', 'wrong')).toEqual({ kind: 'write', event: { type: 'reopened', id: 'a', reason: 'rejected', why: 'wrong' } })
    expect(write('status', 'a', 'decided', '--why', 'x')).toEqual({ kind: 'error', message: 'status: decided takes no --reason or --why' })
    expect(write('status', 'a', 'done')).toEqual({ kind: 'error', message: 'status: is decided or open, got done' })
    expect(write('decide', 'a', '--now', '1')).toEqual({ kind: 'error', message: 'decide: unknown option: --now' })
  })
})

describe('a reopen with no reason is refused (#pr-wf-paused)', () => {
  const write = (...argv: string[]) => parseArgs(argv)

  test('reopen needs --reason and --why', () => {
    expect(write('reopen', 'a', '--why', 'later')).toEqual({ kind: 'error', message: 'reopen: --reason is required' })
    expect(write('reopen', 'a', '--reason', 'rejected')).toEqual({ kind: 'error', message: 'reopen: --why is required' })
  })

  test('status open needs --reason and --why', () => {
    expect(write('status', 'a', 'open')).toEqual({ kind: 'error', message: 'status: open needs --reason and --why' })
    expect(write('status', 'a', 'open', '--why', 'later')).toEqual({ kind: 'error', message: 'status: open needs --reason and --why' })
  })

  test('the reason is postponed or rejected, nothing else', () => {
    expect(write('reopen', 'a', '--reason', 'later', '--why', 'w')).toEqual({ kind: 'error', message: 'reopen: --reason is one of postponed, rejected, got later' })
    expect(write('status', 'a', 'open', '--reason', 'invalidated', '--why', 'w')).toEqual({
      kind: 'error',
      message: 'status: --reason is one of postponed, rejected, got invalidated',
    })
  })
})

describe('stale', () => {
  test('takes an optional card id and an optional kind', () => {
    expect(parseArgs(['stale'])).toEqual({ kind: 'stale', id: undefined, only: undefined })
    expect(parseArgs(['stale', 'a', '--kind', 'paused'])).toEqual({ kind: 'stale', id: 'a', only: 'paused' })
  })

  test('refuses a second id, an unknown kind and an unknown flag', () => {
    expect(parseArgs(['stale', 'a', 'b'])).toEqual({ kind: 'error', message: 'stale: takes at most one card id' })
    expect(parseArgs(['stale', '--kind', 'waiting'])).toEqual({ kind: 'error', message: 'stale: --kind is one of stale, paused, review, got waiting' })
    expect(parseArgs(['stale', '--all', 'x'])).toEqual({ kind: 'error', message: 'stale: unknown option: --all' })
  })
})
