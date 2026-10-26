import { expect, test } from 'bun:test'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { EventBody } from '../map/events.ts'
import { fold } from '../map/fold.ts'
import { CardPage } from './CardPage.tsx'

const build = (...bodies: EventBody[]) => fold(bodies.map((body, i) => ({ ...body, seq: i + 1, at: '' })))

const map = build(
  { type: 'added', id: 'root', kind: 'card', title: 'Root', why: 'the reason', body: 'the decision' },
  { type: 'added', id: 'leaf', kind: 'card', title: 'Leaf' },
  { type: 'added', id: 'dep', kind: 'card', title: 'Dep' },
  { type: 'added', id: 'src', kind: 'source', title: 'Bench run', body: '6% to 11%' },
  { type: 'added', id: 'root:opt0', kind: 'option', title: 'Restart on edit', whyNot: 'kills the child' },
  { type: 'linked', from: 'leaf', to: 'root', link: 'refines' },
  { type: 'linked', from: 'root', to: 'dep', link: 'depends_on' },
  { type: 'linked', from: 'root', to: 'src', link: 'supported_by' },
  { type: 'linked', from: 'root:opt0', to: 'root', link: 'alternative_to' },
  { type: 'said', id: 'root', who: 'Eryk', text: 'a restart kills my session' },
  { type: 'retitled', id: 'root', title: 'Root, retitled' },
  { type: 'disputed', id: 'src', why: 'old numbers' },
)

const noop = () => {}

test('a card page has the detail on top and the sub-cards below', () => {
  render(<CardPage project="demo" map={map} id="root" onOpen={noop} />)
  const detail = screen.getByRole('region', { name: 'card detail' })
  const subcards = screen.getByRole('region', { name: 'sub-cards' })
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Root, retitled')
  expect(detail.textContent).toContain('the reason')
  expect(detail.textContent).toContain('the decision')
  expect(detail.compareDocumentPosition(subcards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(subcards).getByRole('link', { name: 'Leaf' }).getAttribute('href')).toBe('/card/leaf')
})

test('the detail carries the proof: excerpts, evidence pointers and rejected options', () => {
  render(<CardPage project="demo" map={map} id="root" onOpen={noop} />)
  const said = screen.getByRole('region', { name: 'said' })
  expect(within(said).getByText('a restart kills my session')).toBeTruthy()
  expect(said.textContent).toContain('— Eryk')
  const evidence = screen.getByRole('region', { name: 'evidence' })
  expect(within(evidence).getByRole('link', { name: 'Bench run' }).getAttribute('href')).toBe('/card/src')
  expect(evidence.textContent).not.toContain('6% to 11%')
  const options = screen.getByRole('region', { name: 'options' })
  expect(options.textContent).toContain('Restart on edit')
  expect(options.textContent).toContain('rejected: kills the child')
  expect(screen.getByRole('region', { name: 'depends on' }).textContent).toContain('Dep')
  expect(screen.getByRole('region', { name: 'needs review' }).textContent).toContain('is disputed: old numbers')
})

test('a leaf shows a stale mark and its trail, and has no sub-cards section', () => {
  render(<CardPage project="demo" map={map} id="leaf" onOpen={noop} />)
  expect(screen.getByRole('region', { name: 'stale' }).textContent).toContain('#root changed, over refines')
  expect(screen.getByRole('navigation', { name: 'trail' }).textContent).toBe('demo / Root, retitled')
  expect(screen.queryByRole('region', { name: 'sub-cards' })).toBeNull()
})

test('a source page uses the same shape and lists what it supports', () => {
  render(<CardPage project="demo" map={map} id="src" onOpen={noop} />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bench run')
  expect(screen.getByRole('region', { name: 'card detail' }).textContent).toContain('6% to 11%')
  expect(screen.getByRole('region', { name: 'supports' }).textContent).toContain('Root, retitled')
})

test('the root page names the project; an empty map says so', () => {
  render(<CardPage project={undefined} map={build()} id={undefined} onOpen={noop} />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('werk')
  expect(screen.getByRole('region', { name: 'card detail' }).textContent).toContain('The map has no cards yet.')
})

test('an unknown card id says the card is not in the map', () => {
  render(<CardPage project="demo" map={map} id="gone" onOpen={noop} />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('No card #gone')
})

test('a plain click opens the card in the page; a modified click is left to the browser', () => {
  const opened: (string | undefined)[] = []
  render(<CardPage project="demo" map={map} id={undefined} onOpen={(id) => opened.push(id)} />)
  const link = screen.getByRole('link', { name: 'Root, retitled' })
  fireEvent.click(link)
  fireEvent.click(link, { metaKey: true })
  fireEvent.click(screen.getByRole('link', { name: 'werk' }))
  expect(opened).toEqual(['root', undefined])
})
