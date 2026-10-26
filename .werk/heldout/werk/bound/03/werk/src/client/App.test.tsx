import { afterEach, beforeEach, expect, test } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
import type { EventBody } from '../map/events.ts'
import { fold } from '../map/fold.ts'
import { App } from './App.tsx'

const build = (...bodies: EventBody[]) => fold(bodies.map((body, i) => ({ ...body, seq: i + 1, at: '' })))
const base: EventBody[] = [
  { type: 'added', id: 'a', kind: 'card', title: 'Use a log' },
  { type: 'added', id: 'b', kind: 'card', title: 'Cards fold from it', parent: 'a' },
]
const map = build(...base)

/** A stand-in for the live channel: a test fires its events by hand. */
class FakeEventSource {
  static last: FakeEventSource | undefined
  readonly listeners = new Map<string, (() => void)[]>()
  closed = false
  constructor(readonly url: string) {
    FakeEventSource.last = this
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }
  close() {
    this.closed = true
  }
  fire(name: string) {
    for (const listener of this.listeners.get(name) ?? []) listener()
  }
}

const realFetch = globalThis.fetch
const realEventSource = globalThis.EventSource
let routes: Record<string, unknown> = {}
const serve = (next: Record<string, unknown>) => {
  routes = next
  globalThis.fetch = (async (url: string) => Response.json(routes[url])) as unknown as typeof fetch
}

beforeEach(() => {
  history.replaceState(null, '', '/')
  FakeEventSource.last = undefined
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
})
afterEach(() => {
  globalThis.fetch = realFetch
  globalThis.EventSource = realEventSource
})

test('the root page shows the project name and the top-level cards, each linked by its hash', async () => {
  serve({ '/api/project': { name: 'my-project' }, '/api/map': map })
  render(<App />)
  expect((await screen.findByRole('heading', { level: 1, name: 'my-project' })).textContent).toBe('my-project')
  expect(screen.getByRole('link', { name: 'Use a log' }).getAttribute('href')).toBe('#a')
})

test('a card id in the location hash opens that card', async () => {
  serve({ '/api/project': { name: 'p' }, '/api/map': map })
  history.replaceState(null, '', '/#b')
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'Cards fold from it' })
})

test('a change of the hash opens the card it names, and an empty hash the root', async () => {
  serve({ '/api/project': { name: 'p' }, '/api/map': map })
  history.replaceState(null, '', '/#a')
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'Use a log' })
  await act(async () => {
    location.hash = 'b'
    dispatchEvent(new HashChangeEvent('hashchange'))
  })
  await screen.findByRole('heading', { level: 1, name: 'Cards fold from it' })
  await act(async () => {
    location.hash = ''
    dispatchEvent(new HashChangeEvent('hashchange'))
  })
  await screen.findByRole('heading', { level: 1, name: 'p' })
})

test('changed on the live channel fetches the fold again and draws it', async () => {
  serve({ '/api/project': { name: 'p' }, '/api/map': map })
  history.replaceState(null, '', '/#a')
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'Use a log' })
  expect(FakeEventSource.last!.url).toBe('/api/live')

  serve({
    '/api/project': { name: 'p' },
    '/api/map': build(...base, { type: 'added', id: 'c', kind: 'card', title: 'Added from the CLI', parent: 'a' }, { type: 'retitled', id: 'a', title: 'Use an append-only log' }),
  })
  await act(async () => FakeEventSource.last!.fire('changed'))
  await screen.findByRole('link', { name: 'Added from the CLI' })
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Use an append-only log')
  expect(screen.queryByText('Use a log')).toBeNull()
})

test('a new connection of the live channel fetches the fold again, so a write in a gap is not missed', async () => {
  serve({ '/api/project': { name: 'p' }, '/api/map': map })
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'p' })
  serve({ '/api/project': { name: 'p' }, '/api/map': build(...base, { type: 'added', id: 'c', kind: 'card', title: 'Written while away' }) })
  await act(async () => FakeEventSource.last!.fire('hello'))
  await screen.findByRole('link', { name: 'Written while away' })
})

test('the live channel closes when the page goes away', async () => {
  serve({ '/api/project': { name: 'p' }, '/api/map': map })
  const { unmount } = render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'p' })
  unmount()
  expect(FakeEventSource.last!.closed).toBe(true)
})

test('a map that fails to load shows the reason', async () => {
  serve({ '/api/project': { name: 'p' }, '/api/map': { error: 'bad line' } })
  render(<App />)
  expect((await screen.findByRole('alert')).textContent).toContain('bad line')
})
