/**
 * Where a conversation lives, and what a fork is called. Pure: a name in, a path or a name
 * out. Split from convo-manager.ts so the 90% line gate can hold these two functions without
 * holding the class around them — see #werk-test-scope-src0-pure-scope.
 */
import { join } from 'node:path'
import { MAIN } from './convos.ts'
import { paths } from './project.ts'

/** `.werk` itself for `main`, `.werk/conversations/<name>` for every other conversation. */
export function dirFor(name: string): string {
  return name === MAIN ? paths.werk : join(paths.convos, name)
}

/** The shape of a card id. Anything else — a slash, a dot, `..` — could name a directory
 *  outside the conversations folder, because the name becomes a path under it. */
const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9_:-]*$/

/** A card id, made unique as a directory name / tab label: `<card>`, then `<card>-2`, `-3`…
 *  Throws on a string that is not a card id. */
export function nameForCard(card: string, taken: Set<string>): string {
  if (!CARD_ID.test(card)) throw new Error(`not a card id: ${JSON.stringify(card)}`)
  let n = 2
  let name = card
  while (taken.has(name)) name = `${card}-${n++}`
  return name
}
