import { afterEach, beforeEach, expect, test } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { EventBody } from '../map/events.ts'
import { fold } from '../map/fold.ts'
import { App } from './App.tsx'

const realFetch = globalThis.fetch
const map = fold(
  (
    [
      { type: 'added', id: 'a', kind: 'card', title: 'Use a log' },
      { type: 'added', id: 'b', kind: 'card', title: 'Cards fold from it' },
      { type: 'linked', from: 'b', to: 'a', link: 'refines' },
    ] as EventBody[]
  ).map((body, i) => ({ ...body, seq: i + 1, at: '' })),
)
const serve = (routes: Record<string, unknown>) => {
  globalThis.fetch = (async (url: string) => Response.json(routes[url])) as unknown as typeof fetch
}

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(() => {
  globalThis.fetch = realFetch
})

test('the root page shows the project name and the top-level cards', async () => {
  serve({ '/api/project': { name: 'my-project' }, '/api/map': map })
  render(<App />)
  expect((await screen.findByRole('heading', { level: 1, name: 'my-project' })).textContent).toBe('my-project')
  expect(screen.getByRole('link', { name: 'Use a log' }).getAttribute('href')).toBe('/card/a')
})

test('opening a sub-card puts its id in the address, and Back returns to the parent', async () => {
  serve({ '/api/project': { name: 'p' }, '/api/map': map })
  history.replaceState(null, '', '/card/a')
  render(<App />)
  fireEvent.click(await screen.findByRole('link', { name: 'Cards fold from it' }))
  expect(location.pathname).toBe('/card/b')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cards fold from it')

  await act(async () => {
    const popped = new Promise((resolve) => addEventListener('popstate', resolve, { once: true }))
    history.back()
    await popped
  })
  await screen.findByRole('heading', { level: 1, name: 'Use a log' })
})

test('a map that fails to load shows the reason', async () => {
  serve({ '/api/project': { name: 'p' }, '/api/map': { error: 'bad line' } })
  render(<App />)
  expect((await screen.findByRole('alert')).textContent).toContain('bad line')
})
