import { readBoard } from '../board.ts'
import { readEvents } from '../log.ts'
import { greenMerges, reworkedCards, REWORK_DAYS } from '../outcomes.ts'
import { reworkedCode } from '../rework-code.ts'
import { targetFor } from '../target.ts'
import { registerVerb } from '../verbs.ts'

/** `werk rework` (#werk-cli-rework): both kinds of rework of #ms-outcome-rework, per ticket. */
registerVerb({
  name: 'rework',
  summary: 'rework [--json]   cited cards reopened and merged code changed, per ticket (#werk-cli-rework)',
  run: ({ flags }) => {
    const board = readBoard()
    const t = targetFor()
    if ('error' in t) throw new Error(t.error)
    const merges = greenMerges(board)
    const code = reworkedCode(t.repo, merges)
    const cards = reworkedCards(board, readEvents())
    const missing = merges.filter((m) => !code.some((c) => c.commit === m.commit)).map((m) => m.ticket)
    if (flags.json) return [JSON.stringify({ code, cards, missing }, null, 2)]
    const tickets = [...new Set([...cards.map((c) => c.ticket), ...code.filter((c) => c.changed > 0).map((c) => c.ticket)])].sort()
    const rows = tickets.map((id) => {
      const reopened = cards.filter((c) => c.ticket === id).map((c) => `#${c.card}`)
      const lines = code.filter((c) => c.ticket === id).reduce((a, c) => ({ changed: a.changed + c.changed, of: a.of + c.lines }), { changed: 0, of: 0 })
      return `  ${id.padEnd(16)} ${String(lines.changed).padStart(5)} of ${String(lines.of).padStart(5)} lines changed   ${reopened.length ? `reopened: ${reopened.join(', ')}` : ''}`.trimEnd()
    })
    return [
      `Rework over ${merges.length} merged tickets, window ${REWORK_DAYS} days`,
      `  cited cards reopened after the build started: ${cards.length}`,
      `  merged lines changed in the window: ${code.reduce((n, c) => n + c.changed, 0)} of ${code.reduce((n, c) => n + c.lines, 0)}, in ${code.filter((c) => c.changed > 0).length} tickets`,
      `  merges whose window is still open: ${code.filter((c) => c.open).length}`,
      ...(missing.length ? [`  merges the repository no longer holds the commits of: ${missing.join(', ')}`] : []),
      ...(rows.length ? ['', ...rows] : []),
    ]
  },
})
