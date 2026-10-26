#!/usr/bin/env bun
import { parseArgs, USAGE } from './args.ts'
import { describeEvent } from './map/events.ts'
import { changesSinceDecided, fold } from './map/fold.ts'
import { appendEvent, logPath, readLog } from './map/log.ts'
import { describeMark } from './map/marks.ts'
import { listMarked, pageOf } from './map/view.ts'
import { startServer } from './server/start.ts'

const command = parseArgs(process.argv.slice(2))

switch (command.kind) {
  case 'help':
    console.log(USAGE)
    break
  case 'error':
    console.error(`werk: ${command.message}\n\n${USAGE}`)
    process.exit(1)
    break
  case 'show': {
    const events = readLog(logPath(process.cwd()))
    const map = fold(events)
    const page = pageOf(map, command.id)
    if (!page) {
      console.error(`werk: no card #${command.id} in the map`)
      process.exit(1)
    }
    // The root page carries the refused log lines; a card page carries what changed since its decide.
    const extra = command.id === undefined ? { problems: map.problems } : { changedSinceDecided: changesSinceDecided(events, command.id).map(describeEvent) }
    console.log(JSON.stringify({ ...page, ...extra }, null, 2))
    break
  }
  case 'stale': {
    const marked = listMarked(fold(readLog(logPath(process.cwd()))), { id: command.id, only: command.only })
    if (!marked) {
      console.error(`werk: no card #${command.id} in the map`)
      process.exit(1)
    }
    if (marked.length === 0) console.log('nothing is marked')
    for (const { card, kind, marks } of marked) {
      console.log(`${kind.padEnd(6)}  #${card.id}  ${card.title}`)
      for (const mark of marks) console.log(`        ${describeMark(mark)}`)
    }
    break
  }
  case 'write': {
    const result = appendEvent(logPath(process.cwd()), command.event)
    if (!result.ok) {
      console.error(`werk: ${result.message}`)
      process.exit(1)
    }
    console.log(describeEvent(result.event))
    break
  }
  case 'serve':
    await startServer({ projectDir: process.cwd(), port: command.port })
    break
}
