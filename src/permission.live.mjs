// Drives the real Agent against a real claude child. `node src/permission.live.mjs`.
//
// Not part of permission.test.ts: it spends tokens and needs a login. It is the only thing
// that proves the control-request wiring, so it stays in the repository.
//
// Runs in a scratch working directory with its own .werk, so it cannot touch the real map,
// transcript or allow.json.
//
// The mode is `auto` and there is no flag for it (see #werk-perm-mode), so these cases are
// the ones `auto` actually produces. Under `auto` no ask has yet carried a widening
// suggestion, so the "always" button is not exercised here. permission.test.ts covers the
// translation that would build it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch = mkdtempSync(join(tmpdir(), 'werk-live-'))
writeFileSync(join(scratch, 'inside.txt'), 'a\nb\nc\n')
mkdirSync(join(scratch, 'doomed'), { recursive: true })
// WERK_LOG moves the whole .werk directory: allow.json, asks.jsonl, chat.jsonl and the
// session id all sit next to the log. Set before the import, or LOG_PATH is already fixed.
process.env.WERK_LOG = join(scratch, '.werk', 'log.jsonl')

const { Agent } = await import('./agent.ts')
const { Asks } = await import('./permission.ts')

let bad = 0
const check = (ok, what) => {
  if (!ok) {
    bad++
    console.log(`FAIL  ${what}`)
  } else console.log(`ok    ${what}`)
}

const asks = new Asks()
const seen = []
asks.onChange((open) => {
  for (const ask of open) {
    seen.push(ask)
    console.log(`  ask: ${ask.tool} · ${ask.label} · reason=${ask.reason} · always=${ask.always?.label ?? 'none'}`)
    asks.answer(ask.id, 'allow')
  }
})

const agent = new Agent(scratch, ['Read', 'Grep', 'Glob'], true, asks)

const turn = (agent, text) =>
  new Promise((resolve) => {
    const off = agent.onMessage((m) => {
      if (m.from === 'system' && m.done) {
        off()
        resolve()
      }
    })
    agent.send(text)
  })

const one = (cmd) => `Run exactly this one Bash command and nothing else: \`${cmd}\``

// 1. A read must never reach the pane. This is the job the deleted READ_ONLY list was doing
//    by hand, and the whole complaint that started #werk-perm-native. `cat /etc/hosts` is
//    the case the list got wrong in both directions: Bash(cat:*) covered it whatever it
//    read, and a read the list did not name asked even when it changed nothing.
for (const cmd of ['cat inside.txt | wc -l', 'grep -c . inside.txt', 'cat /etc/hosts | wc -l']) {
  await turn(agent, one(cmd))
}
check(seen.length === 0, `a read asks nothing (asked ${seen.length}: ${seen.map((a) => a.label).join(' | ')})`)

// 2. A network call does ask, and carries nothing to widen. It is the only stop `auto` was
//    measured to make, so it is the only live proof that the control request arrives at all.
let before = seen.length
await turn(agent, one('curl -sS -o /dev/null -w "%{http_code}" https://example.com'))
let asked = seen.slice(before)
check(asked.length === 1, `a network call asks (asked ${asked.length})`)
check(asked[0]?.always === undefined, `a network call offers nothing to widen (got ${asked[0]?.always?.label})`)

// 3. Answering allow has to let the call run, in the same turn. A hook that timed out or a
//    response written with the wrong request_id would leave the child blocked instead.
const ran = []
agent.onMessage((m) => {
  if (m.from === 'result') ran.push(m)
})
before = seen.length
await turn(agent, one('curl -sS -o /dev/null -w "%{http_code}" https://example.com'))
check(seen.length === before + 1, 'the same network call asks again — nothing was widened')
check(ran.some((r) => /200/.test(r.text)), `an allowed call runs in the same turn (${ran.map((r) => r.text.slice(0, 40)).join(' | ') || 'no tool result'})`)

// 4. Deny has to reach the model as a refusal, not as silence.
const second = new Asks()
second.onChange((open) => {
  for (const ask of open) second.answer(ask.id, 'deny')
})
const denied = new Agent(scratch, ['Read'], true, second)
const refusals = []
denied.onMessage((m) => {
  if (m.from === 'result') refusals.push(m)
})
await turn(denied, one('curl -sS -o /dev/null -w "%{http_code}" https://example.com'))
check(
  refusals.some((r) => /denied/i.test(r.text)),
  `a denial reaches the model (${refusals.map((r) => r.text.slice(0, 60)).join(' | ') || 'no tool result at all'})`,
)

// 5. What `auto` allows without a question. Not an assertion about what is safe — a record
//    of the mode's reach, so a future CLI release that starts asking about one of these is
//    caught here rather than in the pane.
const quiet = ['mkdir -p sub/one', 'rm -rf doomed', 'chmod -R 777 sub', 'echo hi > /private/tmp/werk-live-out.txt']
before = seen.length
for (const cmd of quiet) await turn(agent, one(cmd))
check(
  seen.length === before,
  `auto still asks nothing for a write, a delete or a chmod (asked ${seen.length - before}: ${seen
    .slice(before)
    .map((a) => a.label)
    .join(' | ')})`,
)

agent.stop()
denied.stop()
rmSync(scratch, { recursive: true, force: true })
rmSync('/private/tmp/werk-live-out.txt', { force: true })
console.log(bad === 0 ? 'permission live: all pass' : `permission live: ${bad} FAIL`)
process.exit(bad === 0 ? 0 : 1)
