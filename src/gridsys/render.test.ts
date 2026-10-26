// render is pure: resolved geometry in, an SVG string out. A wrong rule draws an SVG that
// still opens, so it sits under the 90% gate — see #werk-test-scope-src0-pure-scope. The
// geometry here is written by hand, so each test reads as "this box gives this markup".
import { describe, expect, test } from 'bun:test'
import { render } from './render.ts'
import type { ResolvedGrid, ResolvedGridEdge } from './resolve.ts'

const edge = (over: Partial<ResolvedGridEdge> = {}): ResolvedGridEdge => ({
  id: 'a->b',
  cls: 'state',
  points: [
    { x: 50, y: 70 },
    { x: 50, y: 130 },
  ],
  label: '',
  labelLines: [],
  labelBox: null,
  cards: [],
  labelInline: false,
  hops: [],
  ...over,
})

const scene = (over: Partial<ResolvedGrid> = {}): ResolvedGrid => ({
  width: 200,
  height: 220,
  cards: [
    { id: 'a', cls: 'state', titleLines: ['A'], descLines: ['first card'], contentH: 40, box: { x: 30, y: 30, w: 40, h: 40 }, cards: ['werk-test', 'werk-x'] },
    { id: 'b', cls: '', titleLines: ['B'], descLines: [], contentH: 40, box: { x: 30, y: 130, w: 40, h: 60 }, cards: [] },
  ],
  groups: [],
  edges: [edge()],
  colW: [40, 26, 40],
  rowH: [40],
  colX: [30, 84, 124],
  rowY: [30],
  warnings: [],
  ...over,
})

describe('render', () => {
  test('an SVG of the grid size, with a background and one arrow marker per class', () => {
    const svg = render(scene())
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220" width="200" height="220"')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('<rect x="0" y="0" width="200" height="220" fill="#0a0d12"/>')
    for (const cls of ['read', 'state', 'agent', 'perm', 'write', 'ext', 'dev']) expect(svg).toContain(`id="arrow-${cls}"`)
  })

  test('a card is a group carrying its id and its map cards, with its title and description lines', () => {
    const svg = render(scene())
    expect(svg).toContain('<g class="wd-node" data-node="a" data-cards="werk-test,werk-x">')
    expect(svg).toContain('<rect x="30" y="30" width="40" height="40" rx="8"')
    expect(svg).toContain('<tspan x="50" y="50" font-weight="700" font-size="12.5">A</tspan>')
    // The description sits one title line plus a 6px gap under the title.
    expect(svg).toContain('<tspan x="50" y="72" font-size="10" fill="#9fb0c4">first card</tspan>')
  })

  test('a card taller than its text centres the text in its box', () => {
    // b is 60 tall with 40 of content: the text starts 10px lower than it would at the top.
    expect(render(scene())).toContain('<tspan x="50" y="160" font-weight="700" font-size="12.5">B</tspan>')
  })

  test('text is escaped', () => {
    const s = scene()
    s.cards[0].titleLines = ['a < b & c > d']
    s.groups = [{ id: 'g', title: 'X & Y', box: { x: 10, y: 10, w: 100, h: 100 } }]
    const svg = render(s)
    expect(svg).toContain('a &lt; b &amp; c &gt; d')
    expect(svg).toContain('>X &amp; Y</text>')
  })

  test('a group is a dashed frame with its title in the top-left corner', () => {
    const svg = render(scene({ groups: [{ id: 'g', title: 'TOP', box: { x: 10.123, y: 10, w: 100, h: 100 } }] }))
    expect(svg).toContain('<rect x="10.12" y="10" width="100" height="100" rx="12" fill="none" stroke="#2a3a4d" stroke-width="1" stroke-dasharray="3 4"/>')
    expect(svg).toContain('<text x="22.12" y="26"')
  })

  test('an edge is a group with a wide hit area and a coloured line ending in its class arrow', () => {
    const svg = render(scene({ edges: [edge({ cards: ['werk-test'] })] }))
    // The edge id is escaped like any other text: its `>` is `&gt;` in the attribute.
    expect(svg).toContain('<g class="wd-edge" data-edge="a-&gt;b" data-cards="werk-test">')
    expect(svg).toContain('<path class="wd-hitarea" d="M50,70 L50,130" fill="none" stroke="transparent" stroke-width="11"/>')
    expect(svg).toContain('stroke="#5c8fd6" stroke-width="1.6" stroke-linejoin="round" marker-end="url(#arrow-state)"')
  })

  test('an edge of an unknown class draws in the read colour and arrow', () => {
    const svg = render(scene({ edges: [edge({ cls: 'mystery' })] }))
    expect(svg).toContain('stroke="#5fb0c9" stroke-width="1.6" stroke-linejoin="round" marker-end="url(#arrow-read)"')
  })

  test('a label is centred in its box in the edge colour; an inline one gets a background plate first', () => {
    const labelBox = { x: 20, y: 90, w: 60, h: 34 }
    const beside = render(scene({ edges: [edge({ label: 'go far', labelLines: ['go', 'far'], labelBox })] }))
    expect(beside).toContain('<text text-anchor="middle" font-size="9.5" fill="#5c8fd6"><tspan x="50" y="104">go</tspan><tspan x="50" y="116">far</tspan></text>')
    expect(beside).not.toContain('rx="3"')
    const inline = render(scene({ edges: [edge({ label: 'go', labelLines: ['go'], labelBox, labelInline: true })] }))
    expect(inline).toContain('<rect x="20" y="90" width="60" height="34" rx="3" fill="#0a0d12"/>')
    expect(inline.indexOf('rx="3"')).toBeLessThan(inline.indexOf('font-size="9.5"'))
  })

  test('a label with lines but no box draws no text', () => {
    const svg = render(scene({ edges: [edge({ label: 'go', labelLines: ['go'], labelBox: null })] }))
    expect(svg).not.toContain('font-size="9.5"')
  })

  test('a horizontal line hops a crossing with an arc that bows north, either way it travels', () => {
    const right = edge({ points: [{ x: 0, y: 50 }, { x: 40, y: 50 }, { x: 80, y: 50 }], hops: [{ x: 40, y: 50 }] })
    expect(render(scene({ edges: [right] }))).toContain('d="M0,50 L35,50 A5,5 0 0 1 45,50 L80,50"')
    const left = edge({ points: [{ x: 80, y: 50 }, { x: 40, y: 50 }, { x: 0, y: 50 }], hops: [{ x: 40, y: 50 }] })
    expect(render(scene({ edges: [left] }))).toContain('d="M80,50 L45,50 A5,5 0 0 0 35,50 L0,50"')
  })

  test('a vertical line hops a crossing with an arc that bows east', () => {
    const down = edge({ points: [{ x: 50, y: 0 }, { x: 50, y: 40 }, { x: 50, y: 80 }], hops: [{ x: 50, y: 40 }] })
    expect(render(scene({ edges: [down] }))).toContain('d="M50,0 L50,35 A5,5 0 0 1 50,45 L50,80"')
    const up = edge({ points: [{ x: 50, y: 80 }, { x: 50, y: 40 }, { x: 50, y: 0 }], hops: [{ x: 50, y: 40 }] })
    expect(render(scene({ edges: [up] }))).toContain('d="M50,80 L50,45 A5,5 0 0 0 50,35 L50,0"')
  })

  test('a hop on the first or last point is not drawn: there is no line on both sides of it', () => {
    const e = edge({ points: [{ x: 0, y: 50 }, { x: 80, y: 50 }], hops: [{ x: 0, y: 50 }, { x: 80, y: 50 }] })
    expect(render(scene({ edges: [e] }))).toContain('d="M0,50 L80,50"')
  })

  test('the column bands are hidden unless asked for, and shade every even column', () => {
    const hidden = render(scene())
    expect(hidden).toContain('<g id="debug-columns" style="display:none">')
    expect(hidden).toContain('<rect x="30" y="0" width="40" height="220" fill="#ff5ca8" opacity="0.08"/>')
    expect(hidden).toContain('<rect x="124" y="0" width="40" height="220"')
    expect(hidden).not.toContain('<rect x="84" y="0"')
    expect(render(scene(), true)).toContain('<g id="debug-columns" style="display:block">')
  })
})
