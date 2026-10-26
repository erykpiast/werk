import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { specStories } from '../spec-text.ts'
import { checkTicketFiles } from '../ticket.ts'
import { registerVerb } from '../verbs.ts'

const flagStr = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined)

registerVerb({
  name: 'ticket-check',
  summary: 'ticket-check <folder> [--cards a,b] [--spec file]   run the ticket checks on a folder of ticket files (#werk-ticket-check-verb)',
  run: ({ positional, flags }) => {
    const dir = positional[0]
    if (!dir) throw new Error('ticket-check needs a folder of ticket files')
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`"${dir}" is not a folder`)
    const files = readdirSync(dir)
      .filter((f) => /^\d+\.md$/.test(f))
      .sort()
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
    if (files.length === 0) throw new Error(`no ticket files (NN.md) in ${dir}`)

    const cards = flagStr(flags.cards)
    const spec = flagStr(flags.spec)
    if (spec && !existsSync(spec)) throw new Error(`no spec file at ${spec}`)
    // A coverage check needs the thing it covers. Without --cards or --spec it does not run.
    const checks = checkTicketFiles(files, {
      cardIds: cards ? cards.split(',').map((c) => c.trim().replace(/^#/, '')).filter(Boolean) : [],
      stories: spec ? specStories(readFileSync(spec, 'utf8')) : [],
    }).filter((c) => (c.check !== 'cards-cited' || cards) && (c.check !== 'stories' || spec))

    const failed = checks.filter((c) => !c.ok)
    if (failed.length > 0) {
      throw new Error(`${failed.length} check(s) failed in ${files.length} ticket(s):\n${failed.map((c) => `  ${c.file}  ${c.check}: ${c.detail}`).join('\n')}`)
    }
    return [`${files.length} ticket(s), ${checks.length} checks, all pass`]
  },
})
