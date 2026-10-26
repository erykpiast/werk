import { foldLog } from '../fold-time.ts'
import { mapIndex, searchMap } from '../search.ts'
import type { Status } from '../types.ts'
import { registerVerb } from '../verbs.ts'

const STATUSES: Status[] = ['decided', 'open', 'proto']
const flagStr = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined)

registerVerb({
  name: 'search',
  summary: 'search ["term" ...] [--status s] [--under <id>]   the index of decided cards, or the cards that hold every term (#werk-cli-search)',
  run: ({ positional, flags }) => {
    const status = flagStr(flags.status)
    if (status !== undefined && !STATUSES.includes(status as Status)) throw new Error(`--status must be one of ${STATUSES.join(', ')}`)
    const under = flagStr(flags.under)?.replace(/^#/, '')
    const g = foldLog('werk search')
    if (under && !g.nodes.has(under)) throw new Error(`no node with the id "${under}"`)
    // No term and no filter: the index a builder pass reads.
    if (positional.length === 0 && !status && !under) return mapIndex(g).map((n) => `${n.id}  ${n.title}`)
    const hits = searchMap(g, positional, { status: (status as Status | undefined) ?? (positional.length ? undefined : 'decided'), under })
    if (hits.length === 0) return ['no card matches']
    return hits.map((h) => `${h.id}  [${h.status ?? 'open'}]  ${h.title}`)
  },
})
