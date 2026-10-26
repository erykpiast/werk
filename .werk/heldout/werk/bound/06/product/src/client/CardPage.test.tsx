import { describe, expect, test } from 'bun:test'
import { cleanup, render, screen, within } from '@testing-library/react'
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

test('a card page has the detail on top and the sub-cards below', () => {
  render(<CardPage project="demo" map={map} id="root" />)
  const detail = screen.getByRole('region', { name: 'card detail' })
  const subcards = screen.getByRole('region', { name: 'sub-cards' })
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Root, retitled')
  expect(detail.textContent).toContain('the reason')
  expect(detail.textContent).toContain('the decision')
  expect(detail.compareDocumentPosition(subcards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(subcards).getByRole('link', { name: 'Leaf' }).getAttribute('href')).toBe('#leaf')
})

test('the detail carries the proof: excerpts, evidence pointers and rejected options', () => {
  render(<CardPage project="demo" map={map} id="root" />)
  const said = screen.getByRole('region', { name: 'said' })
  expect(within(said).getByText('a restart kills my session')).toBeTruthy()
  expect(said.textContent).toContain('— Eryk')
  const evidence = screen.getByRole('region', { name: 'evidence' })
  expect(within(evidence).getByRole('link', { name: 'Bench run' }).getAttribute('href')).toBe('#src')
  expect(evidence.textContent).not.toContain('6% to 11%')
  const options = screen.getByRole('region', { name: 'options' })
  expect(options.textContent).toContain('Restart on edit')
  expect(options.textContent).toContain('rejected: kills the child')
  expect(screen.getByRole('region', { name: 'depends on' }).textContent).toContain('Dep')
  expect(screen.getByRole('region', { name: 'needs review' }).textContent).toContain('is disputed: old numbers')
})

test('a leaf shows a stale mark and its trail, and has no sub-cards section', () => {
  render(<CardPage project="demo" map={map} id="leaf" />)
  expect(screen.getByRole('region', { name: 'stale' }).textContent).toContain('#root retitled at event 11, over refines')
  expect(screen.getByRole('navigation', { name: 'trail' }).textContent).toBe('demo / Root, retitled')
  expect(screen.queryByRole('region', { name: 'sub-cards' })).toBeNull()
})

test('a source page uses the same shape and lists what it supports', () => {
  render(<CardPage project="demo" map={map} id="src" />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bench run')
  expect(screen.getByRole('region', { name: 'card detail' }).textContent).toContain('6% to 11%')
  expect(screen.getByRole('region', { name: 'supports' }).textContent).toContain('Root, retitled')
})

test('the root page names the project; an empty map says so', () => {
  render(<CardPage project={undefined} map={build()} id={undefined} />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('werk')
  expect(screen.getByRole('region', { name: 'card detail' }).textContent).toContain('The map has no cards yet.')
})

test('an unknown card id says the card is not in the map', () => {
  render(<CardPage project="demo" map={map} id="gone" />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('No card #gone')
})

test('every card link points at the card id in the location hash, and the brand at the root', () => {
  render(<CardPage project="demo" map={map} id={undefined} />)
  expect(within(screen.getByRole('region', { name: 'sub-cards' })).getByRole('link', { name: 'Root, retitled' }).getAttribute('href')).toBe('#root')
  expect(screen.getByRole('link', { name: 'werk' }).getAttribute('href')).toBe('#')
})

test('no control on a page can change a card: the page has only links, never a field or a button (#werk-write)', () => {
  for (const id of [undefined, 'root', 'leaf', 'src', 'root:opt0']) {
    const { container, unmount } = render(<CardPage project="demo" map={map} id={id} />)
    expect(container.querySelectorAll('input, textarea, select, button, form, [contenteditable]')).toHaveLength(0)
    unmount()
  }
})

describe('the marks of a reopen (#pr-wf-paused)', () => {
  /**
   * b depends_on a and refines x; c depends_on b and x. a is postponed, so b and c are paused.
   * x is rejected, so its next hop, b and c, is stale as well: stale wins on both.
   */
  const marked = build(
    { type: 'added', id: 'a', kind: 'card', title: 'A' },
    { type: 'added', id: 'b', kind: 'card', title: 'B' },
    { type: 'added', id: 'c', kind: 'card', title: 'C' },
    { type: 'added', id: 'x', kind: 'card', title: 'X' },
    { type: 'linked', from: 'b', to: 'a', link: 'depends_on' },
    { type: 'linked', from: 'c', to: 'b', link: 'depends_on' },
    { type: 'linked', from: 'c', to: 'x', link: 'depends_on' },
    { type: 'linked', from: 'b', to: 'x', link: 'refines' },
    { type: 'decided', id: 'b' },
    { type: 'decided', id: 'a' },
    { type: 'decided', id: 'x' },
    { type: 'reopened', id: 'a', reason: 'postponed', why: 'not this month' },
    { type: 'reopened', id: 'x', reason: 'rejected', why: 'the plan is wrong' },
  )

  test('a card reached by a postponement and an invalidation shows stale, and the reopened card its reason', () => {
    render(<CardPage project="demo" map={marked} id="x" />)
    const subcards = screen.getByRole('region', { name: 'sub-cards' })
    const b = within(subcards).getByRole('link', { name: 'B' }).closest('li')!
    // b is a child of x, so the rejected reopen reaches it as well: stale wins.
    expect(b.className).toBe('stale')
    expect(b.textContent).toContain('stale: rejected')
    cleanup()

    render(<CardPage project="demo" map={marked} id="a" />)
    expect(screen.getByRole('region', { name: 'card detail' }).textContent).toContain('reopened, postponed: not this month')
  })

  test('the page of a card reached by both shows only the stale trace, and keeps its status badge', () => {
    render(<CardPage project="demo" map={marked} id="c" />)
    const detail = screen.getByRole('region', { name: 'card detail' })
    expect(detail.querySelector('.status')!.className).toBe('status open')
    expect(screen.getByRole('region', { name: 'stale' }).textContent).toBe('Why this card is stale#x reopened, rejected, at event 13, over depends_on: the plan is wrong')
    expect(screen.queryByRole('region', { name: 'paused' })).toBeNull()
  })

  test('a paused card in a list is grey, with its status badge and the reopen reason', () => {
    const paused = build(
      { type: 'added', id: 'p', kind: 'card', title: 'P' },
      { type: 'added', id: 'q', kind: 'card', title: 'Q', parent: 'p' },
      { type: 'added', id: 'r', kind: 'card', title: 'R', parent: 'q' },
      { type: 'decided', id: 'q' },
      { type: 'decided', id: 'p' },
      { type: 'reopened', id: 'p', reason: 'postponed', why: 'later' },
    )
    render(<CardPage project="demo" map={paused} id="q" />)
    const r = within(screen.getByRole('region', { name: 'sub-cards' })).getByRole('link', { name: 'R' }).closest('li')!
    expect(r.className).toBe('paused')
    expect(r.querySelector('.status')!.className).toBe('status open')
    expect(r.querySelector('.mark')!.textContent).toBe('paused: postponed')
    const detail = screen.getByRole('region', { name: 'card detail' })
    expect(detail.querySelector('.status')!.className).toBe('status decided')
    expect(screen.getByRole('region', { name: 'paused' }).textContent).toBe('Why this card is paused#p reopened, postponed, at event 6, over refines: later')
  })

  test('the root page lists each marked card with the reopen reason and the trace', () => {
    render(<CardPage project="demo" map={marked} id={undefined} />)
    const listing = screen.getByRole('region', { name: 'staleness' })
    const rows = within(listing)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement!.className === 'cards')
      .map((li) => li.className + ' ' + li.querySelector('a')!.textContent)
    expect(rows).toEqual(['stale B', 'stale C'])
    expect(listing.textContent).toContain('#x reopened, rejected, at event 13, over refines: the plan is wrong')
    expect(listing.textContent).toContain('#x reopened, rejected, at event 13, over depends_on: the plan is wrong')
  })
})

const ghosts = build(
  { type: 'added', id: 'root', kind: 'card', title: 'Root' },
  { type: 'proposed', id: 'g', kind: 'card', title: 'A guess', parent: 'root' },
  { type: 'proposed', id: 'h', kind: 'card', title: 'Another guess', parent: 'root' },
  { type: 'proposed', id: 'g:opt0', kind: 'option', title: 'Restart', whyNot: 'slow', alternativeTo: 'g' },
)

test('a ghost is drawn dashed under its proposed parent, each with one ✓ of its own', () => {
  render(<CardPage project="demo" map={ghosts} id="root" />)
  const subcards = screen.getByRole('region', { name: 'sub-cards' })
  const items = within(subcards).getAllByRole('listitem')
  expect(items.map((li) => li.className)).toEqual(['ghost', 'ghost'])
  expect(items[0]!.textContent).toContain('proposed')
  // One button per ghost, and each names one id: no control accepts more than one.
  expect(within(subcards).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['accept #g', 'accept #h'])
  expect(screen.getByRole('region', { name: 'card detail' }).className).toBe('detail')
})

test('the page of a ghost is dashed, with a ✓ for it and one for each ghost option', () => {
  render(<CardPage project="demo" map={ghosts} id="g" />)
  expect(screen.getByRole('region', { name: 'card detail' }).className).toBe('detail ghost')
  expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['accept #g', 'accept #g:opt0'])
})

test('the ✓ posts one accept for its own id, and shows the reason when the server refuses', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Response.json({ error: '#g is not a proposal' }, { status: 409 })
  }) as unknown as typeof fetch
  try {
    render(<CardPage project="demo" map={ghosts} id="root" />)
    screen.getByRole('button', { name: 'accept #g' }).click()
    expect((await screen.findByRole('alert')).textContent).toContain('#g is not a proposal')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('/api/accept')
    expect(calls[0]!.init).toMatchObject({ method: 'POST', body: '{"id":"g"}' })
  } finally {
    globalThis.fetch = realFetch
  }
})

describe('a quoted excerpt (#werk-excerpt)', () => {
  const quoted = build(
    { type: 'added', id: 'a', kind: 'card', title: 'Keep the session' },
    { type: 'quoted', id: 'a:ex0', cites: 'a', text: 'kills my session', session: 's-42', msgIndex: 7, span: [10, 26], speaker: 'user' },
  )

  test('shows as evidence on the citing card, as a ghost with its speaker and session and a ✓', () => {
    render(<CardPage project="demo" map={quoted} id="a" />)
    const evidence = screen.getByRole('region', { name: 'evidence' })
    const item = within(evidence).getByRole('link', { name: 'kills my session' }).closest('li')!
    expect(item.className).toBe('ghost')
    expect(item.textContent).toContain('excerpt')
    expect(item.textContent).toContain('proposed')
    expect(item.textContent).toContain('user, message 7 of session s-42')
    expect(within(item).getByRole('button', { name: 'accept #a:ex0' })).toBeTruthy()
  })

  test('its own page shows the quoted text, the pointer with its span, and the card it supports', () => {
    render(<CardPage project="demo" map={quoted} id="a:ex0" />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('kills my session')
    const detail = screen.getByRole('region', { name: 'card detail' })
    expect(within(detail).getByLabelText('pointer').textContent).toBe('user, message 7 of session s-42, span 10–26')
    expect(screen.getByRole('region', { name: 'supports' }).textContent).toContain('Keep the session')
  })
})
