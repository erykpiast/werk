#!/usr/bin/env bun
import { parseArgs, USAGE } from './args.ts'
import { describeEvent } from './map/events.ts'
import { changesSinceDecided, fold, nextExcerptId } from './map/fold.ts'
import { appendEvent, logPath, readLog } from './map/log.ts'
import { describeMark } from './map/marks.ts'
import { listMarked, pageOf } from './map/view.ts'
import { describeFailure, findQuote } from './quote/find.ts'
import { readTranscript } from './quote/transcript.ts'
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
    if (!page) fail(`no card #${command.id} in the map`)
    // The root page carries the refused log lines; a card page carries what changed since its decide.
    const extra = command.id === undefined ? { problems: map.problems } : { changedSinceDecided: changesSinceDecided(events, command.id).map(describeEvent) }
    console.log(JSON.stringify({ ...page, ...extra }, null, 2))
    break
  }
  case 'stale': {
    const marked = listMarked(fold(readLog(logPath(process.cwd()))), { id: command.id, only: command.only })
    if (!marked) fail(`no card #${command.id} in the map`)
    if (marked.length === 0) console.log('nothing is marked')
    for (const { card, kind, marks } of marked) {
      console.log(`${kind.padEnd(6)}  #${card.id}  ${card.title}`)
      for (const mark of marks) console.log(`        ${describeMark(mark)}`)
    }
    break
  }
  case 'write': {
    const result = appendEvent(logPath(process.cwd()), command.event)
    if (!result.ok) fail(result.message)
    console.log(describeEvent(result.event))
    break
  }
  case 'quote': {
    // The quote is checked against the transcript before anything is written: a miss or a
    // second match fails with the case named, and the log stays as it was (#werk-excerpt).
    const transcript = readTranscript(command.session, process.cwd())
    if (!transcript.ok) fail(transcript.message)
    const found = findQuote(transcript.text, command.text)
    if (!found.ok) fail(describeFailure(found, command.session))
    const path = logPath(process.cwd())
    const { msgIndex, span, speaker } = found
    const id = nextExcerptId(fold(readLog(path)), command.cites)
    const result = appendEvent(path, { type: 'quoted', id, cites: command.cites, text: command.text, session: command.session, msgIndex, span, speaker })
    if (!result.ok) fail(result.message)
    console.log(describeEvent(result.event))
    console.log(`#${id} is proposed: ${speaker}, message ${msgIndex} of session ${command.session}. It waits for the ✓.`)
    break
  }
  case 'serve':
    await startServer({ projectDir: process.cwd(), port: command.port })
    break
}

function fail(message: string): never {
  console.error(`werk: ${message}`)
  process.exit(1)
}
