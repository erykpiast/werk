import { describe, expect, test } from 'bun:test'
import { Asks, type Ask } from './permission.ts'

const ask = (id: string, convo: string): Ask => ({ id, at: '2026-10-03T00:00:00.000Z', tool: 'Bash', label: id, input: {}, convo })

describe('Asks.clear', () => {
  test('with a conversation name, denies only that conversation’s asks', async () => {
    const asks = new Asks()
    const a = asks.put(ask('1', 'main'))
    asks.put(ask('2', 'other'))
    asks.clear('main')
    expect(await a).toEqual({ decision: 'deny', message: undefined })
    expect(asks.open().map((x) => x.id)).toEqual(['2'])
  })

  test('without a name, denies every ask', () => {
    const asks = new Asks()
    asks.put(ask('1', 'main'))
    asks.put(ask('2', 'other'))
    asks.clear()
    expect(asks.open()).toEqual([])
  })
})
