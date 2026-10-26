import { describe, expect, test } from 'bun:test'
import { brokenByMoves, lineageRefusal } from './lineage.ts'
import type { Edge } from './types.ts'

// root
// ├── a ── a1 ── a11
// └── b ── b1
const tree: Edge[] = [
  { from: 'a', to: 'root', type: 'refines' },
  { from: 'a1', to: 'a', type: 'refines' },
  { from: 'a11', to: 'a1', type: 'refines' },
  { from: 'b', to: 'root', type: 'refines' },
  { from: 'b1', to: 'b', type: 'refines' },
]

describe('lineageRefusal', () => {
  test('allows a link to another subtree', () => {
    expect(lineageRefusal(tree, 'a1', 'b1')).toBeNull()
  })

  test('refuses a link to the parent, and names the path', () => {
    expect(lineageRefusal(tree, 'a1', 'a')).toContain('a1 -> a')
  })

  test('refuses a link to an ancestor further up', () => {
    expect(lineageRefusal(tree, 'a11', 'root')).toContain('a11 -> a1 -> a -> root')
  })

  test('refuses a link to a descendant', () => {
    expect(lineageRefusal(tree, 'a', 'a11')).toContain('descendant')
  })

  test('allows a link between siblings', () => {
    expect(lineageRefusal(tree, 'a', 'b')).toBeNull()
  })
})

describe('brokenByMoves', () => {
  test('a move under the target removes the link it turns into a parent link', () => {
    const edges: Edge[] = [...tree, { from: 'a1', to: 'b', type: 'depends_on', why: 'x' }]
    expect(brokenByMoves(edges, [{ id: 'a1', parent: 'b' }])).toEqual([{ from: 'a1', to: 'b', type: 'depends_on', why: 'x' }])
  })

  test('a move reaches links from the moved card\'s descendants too', () => {
    const edges: Edge[] = [...tree, { from: 'a11', to: 'b', type: 'depends_on' }]
    expect(brokenByMoves(edges, [{ id: 'a', parent: 'b' }]).map((e) => e.from)).toEqual(['a11'])
  })

  test('a move that keeps the link across subtrees removes nothing', () => {
    const edges: Edge[] = [...tree, { from: 'a1', to: 'b1', type: 'depends_on' }]
    expect(brokenByMoves(edges, [{ id: 'a1', parent: 'root' }])).toEqual([])
  })
})
