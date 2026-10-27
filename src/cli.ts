#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ago, findQuote, listConvos, rawPath, recall, resolveConvo } from './convos.ts'
import { append, appendMany, readEvents } from './log.ts'
import { findRoot, hasMap, paths, projectRoot } from './project.ts'
import { addProject, devMode, SELF_ROOT } from './projects.ts'
import { foldLog } from './fold-time.ts'
import { serve } from './server.ts'
import { runChild, watchParent } from './hot-child.ts'
import { serveRole } from './hot-reexec.ts'
import { findForks, sample } from './sample.ts'
import { prototype } from './prototype.ts'
import { plan } from './plan.ts'
import { findVerb, loadVerbs, verbHelp } from './verbs.ts'
import { decidedClosure, loop } from './loop.ts'
import { build } from './build.ts'
import { failReport, renderFailReport } from './fails.ts'
import { foldPasses, readPipeline } from './pipeline.ts'
import { RUN_PARALLEL, runPlan } from './run.ts'
import { MAIN_LINE, mainLineTip } from './merge.ts'
import { setTarget, targetFor } from './target.ts'
import { appendBoard, endUnfinishedWork, foldBoard, readBoard, restartLines, restartPlan, signalBuild, startRefusal } from './board.ts'
import { alive } from './board-routes.ts'
import { planBlockers } from './plan-tickets.ts'
import { psProbe } from './overseer.ts'
import { renderOpsMarkdown, splitBlocks } from '../web/diff.js'
import { buildCriterion, describe as describeKill, type KillInput } from './kill.ts'
import { amendRefusal, contractProblems, pendingChange, type Change } from './amend.ts'
import { acceptClosure, ancestorsOf, discardClosure, planRemoval } from './stage.ts'
import { MARK_KINDS, markList, renderMarks, type MarkKind } from './stale-list.ts'
import { importMissingSessions, importPipelineCosts, importPlanTurns } from './cost-history.ts'
import { foldPlanCost } from './cost.ts'
import { greenMerges, reworkedCards, reworkReport } from './outcomes.ts'
import { reworkedCode } from './rework-code.ts'
import { brokenByMoves, lineageRefusal, parentRefusal } from './lineage.ts'
import type { PrototypeResult } from './prototype.ts'
import type { BodyOp, EdgeType, Graph, GraphNode, Pending, Rollup } from './types.ts'

type Removal = ReturnType<typeof planRemoval>

const HELP = `werk — a visual layer over Claude Code.

The log is ${paths.log}. Every command appends one event. Nothing is deleted.

  werk serve [--port 4000]            open the map in a browser, live
                                      "npm run dev" hot-reloads a change under src/ without
                                      restarting (see #werk-hmr), and reloads the page on a
                                      change under web/
       [--allow "Read,Edit,Bash"]     tools the chat pane's agent may use
       [--new]                        forget the stored conversation and start a fresh one.
                                      Without it, serve resumes where it left off.
  werk add <id> --title "..."         propose a card. It does NOT enter the map: it shows as a
                                      ghost until Eryk accepts it — see #werk-propose-new
       [--kind card|source|option] [--why "..."] [--body "..."]
       [--status open|proto] [--who you|me|prototype]
       [--no-basis]                   on record: this card needs no depends_on (a root, a source)
       [--unchallenged]               on record: who:you, decided with no option weighed against it
       [--parent <id>]                also adds a refines edge to <id>
       [--url ...] [--finding ...]    for --kind source
       [--obligation <id>]            this card answers a build's card obligation
                                      (#st-build-card)
                                      cannot set --status decided directly — see "werk status"
                                      a ghost is frozen: no edit, no retitle, no re-add.
                                      To change one, discard it and propose it again.
  werk link <from> <to> --type <t>    t = refines|depends_on|supported_by|alternative_to
       [--why "..."]                  required for depends_on: what <from> takes from <to>.
                                      Linking an existing depends_on again sets its reason.
                                      See #vi-prop-linkwhy
  werk unlink <from> <to> --type <t>
  werk status <id> <status>           decided | open | proto
                                      decided requires, checked against the log, not the prose:
                                        - who is set
                                        - a depends_on edge, or --no-basis (see "werk edit")
                                        - if who:you, an alternative_to option, or --unchallenged
                                        - a kill criterion on record (see "werk kill")
                                      each missing fact fails with the command that fixes it
  werk kill <id> --form metric|manual|no-metric|revisit   record when to revisit a decision.
                                      See #kill. One call adds one criterion.
       [--source ... --metric ... --threshold ... --window ... --min-sample N]   metric
       [--text "..."]                 manual test, or the reason words for no-metric
       [--reason unclear|cheap|slow|values|constraint] [--review-date YYYY-MM-DD]
       [--fallback <opt-id>]          the rejected option to fall back to when it fires
       [--clear]                      drop every criterion on the card
  werk kill-state <id> <n> monitored|unmonitored|fired [--detail "..."]
                                      the state of criterion n (1 is the first)
  werk reopen <id>                    marks the reverse depends_on closure stale
       [--reason postponed|invalidated|rejected]   default invalidated. postponed
                                      marks the closure postponed, not stale — still true,
                                      just not being worked on
  werk rederive <id> [--confirm <id>,<id>...] [--status decided]
                                      clears the stale mark of one card. --confirm lists the
                                      depends_on targets whose link reasons were read; a link made
                                      before the change and missing from the list refuses the
                                      confirm and prints it again with the full list. A card with
                                      no stale mark writes nothing and exits 0. --status decided
                                      runs the same contract check as "werk status"
                                      (#vi-prop-confirm-names, #werk-cli-reopen-flags)
  werk move <id> --parent <id>        promote or demote in the refines tree
  werk retitle <id> "new title"
  werk edit <id> --body "..." [--why "..."] [--who ...] [--no-basis "<why>"] [--unchallenged "<why>"]
  werk propose <id> [--title ..] [--why ..] [--ops '[{"tag":..}]'] [--who ..]
                      [--no-basis "<why>"] [--unchallenged "<why>"]
                                      stage a change, not applied yet — see #al-diff-cli
                                      ops tag: elaborated {old,new} | new {new} | removed {old}
                                      old must quote a real block verbatim or it is
                                      demoted to new+removed; never trusted silently
  werk accept <id>                    commit the pending proposal, or make a ghost real.
                                      Yours alone: it needs --actor you, or the ✓ in the map
                                      a ghost brings its ghost refines parents and its own
                                      options and sources with it, never a depends_on target
  werk discard <id>                   drop it — tell the agent what to fix instead.
                                      A ghost takes its ghost children with it
  werk remove <id> [--reparent]       take a card out of the map. The log keeps everything,
                                      so this is reversible — see #werk-remove
                                      an agent's remove is a proposal: the card shows it
                                      pending, and the ✓ (or accept --actor you) runs it
                                      the refines subtree goes too, unless --reparent lifts
                                      the direct children to the grandparent first
  werk restore <id>                   put a removed card back
  werk removed                        what is out of the map, newest first
  werk say <id> "..."                 add a note to one card's thread
  werk followed <obligation-id>       close a build's card obligation with "no new decision" —
       --cards <id>,<id>...           see #werk-cli-followed. Each card must be decided and in
                                      the map. Refused when the obligation is unknown or closed
  werk inbox [--since <seq>] [-n 20]  read the notes you typed in the map
  werk convos                         every conversation: home card, session id, last activity
  werk recall <card|session|name>     read another conversation's transcript
       [--grep "term" ...]            only messages matching every term, plus context
       [--context 2] [--tail 20] [--max-chars 2000]
       [--tools] [--thinking]         include tool calls and results, or thinking
       [--raw]                        read Claude Code's own transcript instead, losing
                                      nothing and gaining its noise
  werk quote <card-id> <card|session|name> --text "..."
                                      find --text verbatim in that transcript and add it as
                                      an excerpt node, supported_by <card-id>, with a real
                                      msgIndex and span — not a paraphrase. Fails if the text
                                      is not an exact match, or matches more than one message.
  werk show [<id>]                    print one node and its neighbours
  werk find [<id>] [--status s]        open or proto cards under <id>'s refines subtree
                                      (default root), excluding stale and postponed ones.
                                      --status open|proto narrows to just one.
  werk sample --brief-file <path>     fan out N samples of one brief, find where they diverge
       [--n 3] [--tier plan|output]   see #al-sample-runner. plan (default) is read-only;
       [--timeout 300]                output gives each sample a private scratch directory
                                      (see #al-sample-build-isolation) — worktree is rejected,
                                      that tier is "werk prototype"'s. n caps at 5, timeout at
                                      900s, enforced in code. Prints JSON
                                      {forks, rejected, samples} on stdout; a human-readable
                                      summary of each fork on stderr
  werk prototype --fork <question-id> build one artifact per option of a fork, in parallel —
       [--fork-file <path>]           see #al-sample-proto-agent. --fork reads the options off
       [--tier output|worktree]       the map and proposes each result as a source,
       [--timeout 600]                supported_by its option, copied into .werk/prototypes/.
                                      --fork-file holds JSON {field, options:[{label, brief,
                                      id?}]}; only an option with a real "id" gets evidence.
                                      output (default)
                                      gives each option a scratch directory; worktree gives
                                      each a throwaway git worktree (#al-ephem), diffed to a
                                      .patch and removed after, even on error or timeout.
                                      timeout caps at 900s. Prints JSON per option: artifact
                                      directory, patch path if any, error if any
  werk sample-options <target-id> "<brief>"
       [--n 3] [--timeout 300]        same run, but writes each fork straight to the map: one
                                      open card per fork under <target-id>, one option per
                                      sampled choice — #al-two's rules. "I do not care" is
                                      offered live when you are asked, never written as a node
  werk plan <subtree-id>               turn a decided subtree into a spec, then tickets — see
       [--timeout 600]                 #st-spec, #st-ticket. The spec goes to
       [--silence 60]                  seconds a writer may stay silent before it is cancelled
                                       .werk/specs/<subtree-id>.md, one file per ticket to
                                       .werk/tickets/<subtree-id>/NN.md, and each ticket that
                                       passes its own checks onto the board as
                                       "<subtree-id>/NN". A second plan of the same subtree
                                       extends the first (#st-plan-extend): it updates the
                                       spec, rewrites the open tickets under their ids, never
                                       touches a ticket that started to build, and archives an
                                       open ticket the spec no longer needs. A decision
                                       no card gives is proposed as a card under the subtree.
                                       The scope is the subtree plus every card it links, one
                                       hop out: depends_on targets and #card-id references
                                       (#st-spec-linked). An open or proto card in the scope stops the
                                       run before any agent call. Exit 1 when a check fails.
                                       Prints JSON {ok, run, spec, tickets, planned, archived,
                                       checks, proposed} on stdout
  werk loop "<brief>" --check "..."    build one ticket in a throwaway worktree until the checks
       [--brief-file <path>]           pass — see #lp-stateless. --check repeats. The worktree
       [--card <id> ...]               is a snapshot of the working tree; branch
       [--cap 5] [--timeout 600]       werk-loop/<run> is kept. One new agent per pass, the
                                       repo is the only memory. --card adds the decided cards
                                       in its depends_on closure. One line per pass goes to
                                       .werk/runs/<run>.jsonl
  werk target [<path>]                set the project's target repository, or print it — see
                                       #st-build-target. Every build, run, gate and board
                                       trigger works there: git, the worktrees and the checks.
                                       The board, the tickets and the logs stay in werk's
                                       store. Recorded on the board (project.target). Refused
                                       when the path is not a directory, has no main line, or
                                       holds or lies inside werk's store. There is no default
  werk build <ticket-id>              build one planned ticket — see #st-build-ticket. Fresh
       [--cap 5] [--timeout 600]       passes in a worktree off the tip of the target's main
       [--silence 60]                  line, the branch main (#st-plan-main), until the checks,
       [--check-timeout 300]           the grader and the review pass. Refused when no target
       [--loop-run <id>]               is set (werk target) or main does not exist.
                                       Appends a card obligation to the log first
                                       (#st-build-card), then the board's started, pass and
                                       ended events; green moves the ticket to merging.
                                       Branch werk-build/<loop run> is kept. A started and an
                                       ended event per build, pass, session and check in
                                       .werk/pipeline.jsonl, or $WERK_PIPELINE (#ms-store);
                                       every session's transcript and check's output in
                                       .werk/runs/<loop run>/. SIGTERM ends it as
                                       'stopped'. Exit 0 only on green
       [--progress 300]                the overseer (#lp-overseer): a classifier checks for a
       [--classify-timeout 60]         loop every --progress seconds; a running tool call whose
       [--inflight 60]                 process tree uses no CPU for --inflight seconds is
       [--probe-every 5]               killed (ps, sampled every --probe-every seconds); a
       [--no-asks]                     classifier answers every permission ask, logged as a
                                       werk_overseer event. --no-asks turns the asks off
  werk run <plan-run>                 the merge loop over one planned run — see #st-build-run.
       [same flags as build]           Every build, merge and held-out run happens in the
                                       target's main line (werk target). Records the feature
                                       tier (run.tier). Up to 3 tickets build at once, and two
                                       whose touches: lines share a module never do
                                       (#st-build-parallel). Builds a ticket once every blocker
                                       is done, with a step author beside the builder writing
                                       held-out steps to .werk/heldout/<run>/; merges it onto
                                       the main line,
                                       the branch main (#st-plan-main, #werk-base-branch), in
                                       a temporary tree with its checks, each run once (ticket.merge).
                                       A red check does not stop the merge: it files a follow-up
                                       ticket to fix the check (#ms-merge-red-follow-up). A merge
                                       git cannot make is a conflict (#st-build-conflict): the
                                       next build starts fresh from main's tip, that pass does
                                       not count against --cap, and ten conflicts in a row
                                       stop the run as stuck. Where main
                                       is checked out, its worktree fast-forwards; a local
                                       change that blocks it stops the run ('checkout') and
                                       moves nothing. Then a binder runs every held-out step
                                       on the main line (ticket.heldout). A red step files a
                                       follow-up ticket in ready; the merge stands. A step the
                                       binder could not run is not run (#st-heldout-notrun):
                                       no follow-up, and not green. Ends at G2
                                       (gate.waiting) when every ticket is merged and every
                                       step is green. Stops, exit 1, on a ticket at its cap,
                                       a deadlock, a step the binder cannot bind, or a
                                       missing main. Every stop moves the tickets left in
                                       building or merging back to ready with the reason
                                       (#st-build-stop-ready). Run it again to resume: those
                                       tickets build first. Refused, like plan and restart,
                                       while a run is in progress on the subtree or on an
                                       ancestor of it; the refusal names that run
                                       (#st-run-start-guard)
  werk restart <subtree-id> [--yes]   end the subtree's unfinished work, then plan and run it
                                       again — see #werk-board-restart. Without --yes it
                                       prints what it ends and changes nothing: each running
                                       build it cancels (the branch stays), each ready,
                                       blocked, building or merging ticket it archives, and
                                       the done tickets it keeps. With --yes it does that,
                                       then runs werk plan and werk run in the foreground
  werk gate <plan-run> [approve]      show G2, or pass it for the main line tip it waits on
                                       (gate.passed). The tip is read from the target
                                       repository (werk target); approve is refused when the
                                       target's main has moved past the tree G2 waits on.
                                       approve needs --actor you: a gate is a
                                       person's call (#st-gates, #werk-loop-tier)
  werk fails [--json]                 the builder loop's failed passes, over every build in
                                       the pipeline log — see #ms-fail. Each fail by gate
                                       and cause, first-pass green and cap-hit rates, passes
                                       per build, and the signals over the thresholds
  werk stale [<id>]                   every marked card in fix order, with the origin, reason
       [--kind stale|paused|waiting]  and date of each mark. <id> keeps its refines subtree
  werk rework [--json]                the rework per ticket: cited cards reopened after the
                                      build started, and merged lines a later commit changed
                                      within 14 days. Reads the board log, the decision log
                                      and the target repository, writes nothing — see
                                      #werk-cli-rework
  werk import <file.json>             seed the log from a decision-map/v1 dump
  werk events [-n 20]                 tail the log
  werk cost [--top 15] [--json]       plan cost per card and per day, folded from the
                                      pipeline log's plan turns — see #ms-cost-history
  werk cost import                    append every finished turn in this checkout's
                                      transcripts that the pipeline log does not hold yet,
                                      and correct every pipeline session whose cost left out
                                      its subagents and forks. Safe to run again

Every command takes --actor you|agent (default agent).`

type Flags = Record<string, string | true>

function parse(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = []
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--') || /^-[a-z]$/.test(arg)) {
      const name = arg.replace(/^--?/, '')
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[name] = true
      else {
        flags[name] = next
        i++
      }
    } else positional.push(arg)
  }
  return { positional, flags }
}

const EDGE_TYPES: EdgeType[] = ['refines', 'depends_on', 'supported_by', 'alternative_to']

function edgeType(flags: Flags, code = 1): EdgeType {
  const t = flags.type
  if (typeof t !== 'string' || !EDGE_TYPES.includes(t as EdgeType)) {
    fail(`--type must be one of ${EDGE_TYPES.join(', ')}`, code)
  }
  return t as EdgeType
}

function fail(message: string, code = 1): never {
  console.error(`werk: ${message}`)
  process.exit(code)
}

function str(flags: Flags, name: string): string | undefined {
  const v = flags[name]
  return typeof v === 'string' ? v : undefined
}

/** A werk already answering on the port takes the folder and opens it in the browser. False
 *  when nothing, or something other than werk, answers there. */
async function handOff(port: number, root: string): Promise<boolean> {
  const base = `http://localhost:${port}`
  try {
    const list = await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(1000) })
    if (!list.ok || !Array.isArray((await list.json()).projects)) return false
  } catch {
    return false
  }
  const r = await fetch(`${base}/api/projects/add`, { method: 'POST', body: JSON.stringify({ root }) })
  const body = await r.json()
  if (!body.ok) fail(`werk on port ${port} did not add ${root}: ${body.error}`)
  const url = `${base}/p/${encodeURIComponent(body.project.name)}/map`
  console.log(`werk is already running on port ${port}. ${body.project.name} is on its list: ${url}`)
  // A person at a terminal gets the browser. A script only gets the address.
  if (process.stdout.isTTY) spawnSync('open', [url])
  return true
}

/** The folder werk starts in becomes a project, so it opens at once. A folder werk cannot
 *  take — no git repository — leaves the server running with the list as it is. */
function addHere(root: string): string | undefined {
  try {
    return addProject(root).root
  } catch (err) {
    console.error(`werk: ${(err as Error).message} Open werk in the browser to add a project.`)
    return undefined
  }
}

// #al-sample-budget: budget lives in code, not in a prompt. Every verb that runs
// claude calls reads n and its wall-clock cap through these two, so no verb can skip the cap.
const MAX_N = 5
const MAX_TIMEOUT_SEC = 900

function budgetN(flags: Flags, fallback = 3): number {
  const raw = Number(str(flags, 'n') ?? fallback)
  if (Number.isFinite(raw) && raw > MAX_N) console.error(`note: --n ${raw} capped to ${MAX_N}`)
  return Math.min(Math.max(1, Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback), MAX_N)
}

function budgetTimeoutSec(flags: Flags, fallback: number): number {
  const raw = Number(str(flags, 'timeout') ?? fallback)
  if (Number.isFinite(raw) && raw > MAX_TIMEOUT_SEC) console.error(`note: --timeout ${raw} capped to ${MAX_TIMEOUT_SEC}s`)
  return Math.min(Math.max(1, Number.isFinite(raw) && raw > 0 ? raw : fallback), MAX_TIMEOUT_SEC)
}

function actor(flags: Flags): 'you' | 'agent' {
  return str(flags, 'actor') === 'you' ? 'you' : 'agent'
}

/**
 * Every value given for a flag that may repeat. `parse` keeps one value per name, which is
 * right for every other command; `recall --grep a --grep b` needs both.
 */
function multi(argv: string[], name: string): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== `--${name}`) continue
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) out.push(next)
  }
  return out
}

/** A fork's field name, made safe as an id suffix. */
function slug(field: string): string {
  return field
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** A fork's field name, as a question a human reads. */
function humanize(field: string): string {
  const words = field.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The limits `werk build` and `werk run` share. #st-build-seam: every time limit is a
 *  parameter, so a test can set it to milliseconds. */
function buildFlags(flags: Flags) {
  const capRaw = Number(str(flags, 'cap') ?? 5)
  const cap = Math.min(Math.max(1, Number.isFinite(capRaw) ? Math.floor(capRaw) : 5), 10)
  const seconds = (name: string, fallback: number) => {
    const raw = Number(str(flags, name) ?? fallback)
    return Number.isFinite(raw) && raw > 0 ? raw : fallback
  }
  // SIGTERM ends the build as 'stopped', with the board told so — not a dead process.
  const stop = new AbortController()
  process.on('SIGTERM', () => stop.abort())
  process.on('SIGINT', () => stop.abort())
  return {
    cap,
    passTimeoutMs: budgetTimeoutSec(flags, 600) * 1000,
    silenceMs: seconds('silence', 60) * 1000,
    checkTimeoutMs: seconds('check-timeout', 300) * 1000,
    signal: stop.signal,
    // #lp-overseer: the starting values the cards give, each a flag.
    overseer: {
      asks: flags['no-asks'] !== true,
      progressMs: seconds('progress', 300) * 1000,
      classifyTimeoutMs: seconds('classify-timeout', 60) * 1000,
      inflight: { probe: psProbe, flatMs: seconds('inflight', 60) * 1000, everyMs: seconds('probe-every', 5) * 1000 },
    },
  }
}

function graph() {
  return foldLog(`werk ${process.argv[2] ?? ''}`.trim())
}

/**
 * #st-run-start-guard: a plan, a run or a restart refuses while a run is in progress on the
 * subtree or on an ancestor of it. This process and its parent are not a blocking run: the
 * Build button starts `werk plan` and `werk run` under its own process.
 */
function refuseWhileRunInProgress(subtree: string) {
  const busy = startRefusal(foldBoard(readBoard()), subtree, ancestorsOf(graph(), subtree), alive, [process.pid, process.ppid])
  if (busy) fail(`${busy.why}. Nothing started.`)
}

/**
 * The rollup as one line. A leaf card gets nothing: its status already says it.
 * A zero count is left out, so what prints is what is left to do.
 */
function rollupLine(r: Rollup | undefined): string | undefined {
  if (!r) return undefined
  const parts = [`${r.cards} ${r.cards === 1 ? 'card' : 'cards'}`]
  for (const [n, label] of [
    [r.open, 'open'],
    [r.proto, 'proto'],
    [r.decided, 'decided'],
    [r.unchallenged, 'unchallenged'],
    [r.stale, 'stale'],
  ] as const) {
    if (n > 0) parts.push(`${n} ${label}`)
  }
  return parts.join(', ')
}

/**
 * #al-sample-fork-options: a built option becomes evidence on its option card. The artifact
 * directory is copied out of the OS temp dir into .werk/prototypes/, because #al-ephem keeps
 * the .patch and the artifact while the worktree goes. Proposed, not added: it is a ghost
 * until accepted, like every other node an agent writes. Returns the source id, or undefined
 * when the option has no card behind it.
 */
function linkEvidence(
  optionId: string | undefined,
  r: PrototypeResult,
  tier: string,
  runId: string,
  flags: Flags,
): string | undefined {
  const g = graph()
  const opt = optionId ? g.nodes.get(optionId) : undefined
  if (!opt || opt.kind !== 'option') return undefined
  const kept = join('.werk', 'prototypes', `${slug(opt.id)}-${runId}`)
  cpSync(r.artifactDir, kept, { recursive: true })
  const patch = r.patchPath ? join(kept, 'option.patch') : undefined
  let k = 0
  while (g.nodes.has(`${opt.id}:src${k}`)) k++
  const id = `${opt.id}:src${k}`
  append(
    'node.proposed',
    {
      id,
      kind: 'source',
      title: `Prototype: ${opt.title}`,
      url: patch ?? kept,
      finding: r.error ? `build failed: ${r.error}` : `built, tier ${tier}, run ${runId}`,
      body: [`Artifact: ${kept}`, patch ? `Patch: ${patch}` : '', r.error ? `Error: ${r.error}` : ''].filter(Boolean).join('\n\n'),
    },
    { actor: actor(flags) },
  )
  append('edge.added', { from: opt.id, to: id, type: 'supported_by' }, { actor: actor(flags) })
  return id
}

function requireNode(id: string) {
  const g = graph()
  const node = g.nodes.get(id)
  if (!node) {
    if (g.removed.some((r) => r.id === id)) {
      fail(`"${id}" was removed from the map. Put it back first: werk restore ${id}`)
    }
    fail(`no node with the id "${id}". Run "werk events" to see what exists.`)
  }
  return { g, node }
}

/**
 * A ghost's words cannot be rewritten in place — #werk-propose-new. The map shows what the
 * ✓ will commit, so nothing may change between the reading and the click. The correction
 * path is discard, then propose again, which leaves both events in the log.
 */
function frozen(id: string, what: string): void {
  // An excerpt's words are the transcript's, so they never change, before or after the
  // accept. A note does not touch them, so `say` still works — #werk-excerpt-event.
  if (graph().nodes.get(id)?.kind === 'excerpt') {
    fail(`"${id}" is an excerpt, and its words are a verbatim quote, so "${what}" cannot change them.`)
  }
  if (!graph().proposed.has(id)) return
  fail(
    `"${id}" is proposed and not accepted yet, so "${what}" cannot change it.\n` +
      `  Discard it and propose it again, with the new wording in the add call:\n` +
      `    werk discard ${id}`,
  )
}

/** A decided card's words change by an amend, so by a proposal — #map-frozen. */
function decidedWords(id: string, what: string): void {
  const n = graph().nodes.get(id)
  if (n?.kind === 'card' && n.status === 'decided' && !n.proposed) {
    fail(
      `"${id}" is decided, so "${what}" would change it in place. A change to a decided card is an amend. Stage it:\n` +
        `      werk propose ${id} --title "..." --why "..." --ops '[...]'`,
    )
  }
}

/**
 * The contract check — #werk-contract. Every path that sets a card to decided runs it:
 * `status` and `rederive --status decided` (#werk-contract-when). Fails with the command
 * that fixes each missing fact.
 */
function contract(id: string): void {
  requireNode(id)
  const problems = contractProblems(graph(), id)
  if (problems.length > 0) {
    fail(`"${id}" cannot become decided:\n  - ${problems.join('\n  - ')}`)
  }
}

/** #werk-contract-amend-scope: refuse a change that leaves a decided card missing a fact. */
function amendCheck(id: string, change: Change, all: boolean): void {
  requireNode(id)
  const refusal = amendRefusal(graph(), id, change, all)
  if (refusal) fail(refusal)
}

/** Refuse a refines parent that breaks the chain of real parents up to the root, before
 *  anything is written — #werk-propose-new-real-under-ghost. `asGhost` is for an id that is
 *  about to be proposed and is not in the graph yet. */
function refuseParent(id: string, parent: string, asGhost = false): void {
  const g = graph()
  const refusal = parentRefusal([...g.edges, ...g.ghostEdges], (x) => g.proposed.has(x) || (asGhost && x === id), id, parent)
  if (refusal) fail(`refused: ${refusal} Nothing was written.`)
}

/** Append one removal and say what left. Only Eryk's actions reach here: `remove --actor
 *  you`, or `accept` on a proposed removal. */
function commitRemoval(g: Graph, id: string, removal: Removal): void {
  const { moves, ids } = removal
  for (const m of moves) append('level.moved', m, { actor: 'you' })
  if (moves.length) console.log(`moved ${moves.length} card(s) up to ${moves[0].parent}: ${moves.map((m) => m.id).join(', ')}`)
  for (const each of ids) append('node.removed', { id: each }, { actor: 'you' })
  console.log(`removed ${id} — ${g.nodes.get(id)?.title ?? ''}`)
  for (const each of ids.filter((x) => x !== id)) {
    console.log(`  and ${each} — ${g.nodes.get(each)?.title ?? ''}`)
  }
  console.log(`Nothing left the log. Put it back with: werk restore ${id}`)
}

/**
 * #werk-cli-hash-id: an argument that names a card takes `#auth` as `auth`, because an agent
 * copies a reference out of a card or a note as it is written. Only the arguments that name a
 * card lose one leading `#`. Text keeps it, and so does a conversation reference (`recall
 * '#card'`, the second argument of `quote`), which reads the `#` itself.
 */
const ID_POSITIONS: Record<string, number[]> = {
  add: [0], link: [0, 1], unlink: [0, 1], status: [0], kill: [0], 'kill-state': [0], reopen: [0],
  rederive: [0], move: [0], retitle: [0], edit: [0], propose: [0], accept: [0], discard: [0],
  remove: [0], restore: [0], say: [0], quote: [0], show: [0], find: [0], stale: [0],
  'sample-options': [0], plan: [0], ticket: [1], followup: [0],
}
const ID_FLAGS = ['parent', 'under', 'obligation', 'fallback', 'fork', 'card']
const unhash = (s: string) => s.replace(/^#/, '')

const [command, ...rawRest] = process.argv.slice(2)
const rest = rawRest.map((arg, i) => {
  const flag = rawRest[i - 1]
  return flag?.startsWith('--') && ID_FLAGS.includes(flag.slice(2)) ? unhash(arg) : arg
})
const { positional, flags } = parse(rest)
for (const i of ID_POSITIONS[command ?? ''] ?? []) if (positional[i] !== undefined) positional[i] = unhash(positional[i])
await loadVerbs()

// #werk-cli-name: a command works on the map of the nearest folder at or above this one that
// holds one. With none, it refuses instead of starting a new map in a random folder.
const NO_MAP = new Set([undefined, 'help', '--help', '-h', 'serve'])
if (!NO_MAP.has(command) && !process.env.WERK_LOG && !hasMap()) {
  fail(`no werk map in ${process.cwd()} or in any folder above it. Add the folder as a project in werk first.`)
}

switch (command) {
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(`${HELP}\nVerbs that register themselves (src/verbs/):\n${verbHelp()}`)
    break

  case 'serve': {
    const port = Number(str(flags, 'port') ?? 4000)
    const allow = str(flags, 'allow')
    const here = findRoot(process.cwd()) ?? process.cwd()
    // #werk-projects-one-process: with a werk already on the port, this folder joins it and
    // opens in the browser. A dev server runs its own checkout's code, so it never hands off.
    if (!devMode() && (await handOff(port, here))) break
    // #werk-hmr-swap-serve-reexec: a plain serve waits on one child that runs with hot reload
    // on. The child holds the lock and the port, and stops when this process is gone.
    const role = serveRole({ execPath: process.execPath, execArgv: process.execArgv, argv: process.argv, env: process.env, pid: process.pid, isBun: !!process.versions.bun })
    if (role.role === 'parent') {
      process.exit(await runChild(role.command, role.env))
    }
    const g = globalThis as unknown as { __werkWatch?: boolean }
    if (role.role === 'child' && !g.__werkWatch) {
      g.__werkWatch = true
      watchParent(role.parent, () => process.exit(1))
    }
    const start = devMode() && here === SELF_ROOT ? here : addHere(here)
    // serve waits for the lock, so it is async. Without this catch a failure is silent.
    serve(port, allow ? allow.split(',').map((t) => t.trim()) : undefined, flags.new === true, start).catch((err) =>
      fail((err as Error).message),
    )
    break
  }

  case 'add': {
    const id = positional[0] ?? fail('add needs an id')
    const title = str(flags, 'title') ?? fail('add needs --title')
    const before = graph()
    if (before.proposed.has(id)) {
      fail(
        `"${id}" is already proposed and a ghost is frozen. To change it:\n` +
          `    werk discard ${id}\n` +
          `  then propose it again, in one add call.`,
      )
    }
    if (before.nodes.has(id)) fail(`"${id}" already exists. Use "werk retitle" or "werk edit".`)
    if (before.removed.some((r) => r.id === id)) {
      fail(`"${id}" was removed from the map. Bring it back with "werk restore ${id}", or pick another id.`)
    }
    if (str(flags, 'status') === 'decided') {
      fail(
        'add cannot set --status decided directly. Add it as open or proto, link its facts, then run:\n' +
          `    werk status ${id} decided`,
      )
    }
    // An excerpt has a transcript match behind it or it does not exist — #werk-excerpt-event.
    if (str(flags, 'kind') === 'excerpt') {
      fail(`an excerpt cannot be added by hand. Quote it from the transcript:\n    werk quote <card-id> <card|session|name> --text "..."`)
    }
    const payload: Record<string, unknown> = { id, kind: str(flags, 'kind') ?? 'card', title }
    for (const key of ['why', 'body', 'status', 'who', 'url', 'finding', 'why_not', 'text', 'context', 'obligation']) {
      const v = str(flags, key)
      if (v !== undefined) payload[key] = v
    }
    if (flags['no-basis'] === true) payload.noBasis = true
    if (flags.unchallenged === true) payload.noAlternative = true
    if (payload.kind === 'card' && !payload.status) payload.status = 'open'
    // The parent is checked before anything is written, and travels inside the one event:
    // the card and its place succeed or fail together — #pr-log-one-event. Fold holds the
    // edge back while either end is a ghost. No second accept for an edge.
    const parent = str(flags, 'parent')
    if (parent) {
      requireNode(parent)
      if (payload.kind === 'option') fail(`an option has no parent. Link it to its card instead: werk link ${id} ${parent} --type alternative_to`)
      // The new card is a ghost, so only a loop can refuse here. Checked the same way anyway.
      refuseParent(id, parent, true)
      payload.parent = parent
    } else if (payload.kind === 'card' && id !== 'root' && before.nodes.get('root')?.kind === 'card') {
      // A card with no parent would sit on no page, so it goes under the root — #werk-write-add-root.
      payload.parent = 'root'
    }
    // Not `node.added`. Nothing enters the map that Eryk did not accept — #werk-propose-new.
    append('node.proposed', payload, { actor: actor(flags) })
    console.log(
      `proposed ${payload.kind} ${id}${payload.parent ? ` under ${payload.parent}` : ''} — not in the map yet.\n` +
        `  Eryk accepts it with the ✓ on the card, or: werk accept ${id} --actor you`,
    )
    break
  }

  case 'link':
  case 'unlink': {
    const [from, to] = positional
    if (!from || !to) fail(`${command} needs <from> and <to>`, 2)
    requireNode(from)
    requireNode(to)
    const type = edgeType(flags, 2)
    // #vi-prop-linkwhy: a depends_on link says what `from` takes from `to`. Without it, the
    // reader of a stale mark sees a path but cannot judge if the reopen reaches this card.
    const why = command === 'link' ? str(flags, 'why')?.trim() : undefined
    if (command === 'link' && type === 'depends_on' && !why) {
      fail(
        `a depends_on link needs --why: one sentence on what "${from}" takes from "${to}".\n` +
          `      werk link ${from} ${to} --type depends_on --why "..."`,
        2,
      )
    }
    if (why && type !== 'depends_on') fail(`--why is only for depends_on links, not ${type}`, 2)
    // #vi-edges: an option sits beside its card through alternative_to only. A refines link
    // as well would list it twice, under the children and under Options.
    if (command === 'link' && (type === 'refines' || type === 'depends_on') && graph().nodes.get(from)?.kind === 'option') {
      fail(`"${from}" is an option. An option links to its card with alternative_to only, not ${type}.`)
    }
    if (command === 'link' && type === 'depends_on' && from === to) {
      fail(`a depends_on link cannot point a card at itself: "${from}" is its own ancestor. See #vi-prop-nolineage.`)
    }
    if (command === 'link' && type === 'depends_on') {
      const g = graph()
      const refusal = lineageRefusal([...g.edges, ...g.ghostEdges], from, to)
      if (refusal) fail(`a depends_on link cannot point to an ancestor or a descendant: ${refusal} See #vi-prop-nolineage.`)
    }
    if (command === 'link' && type === 'refines') refuseParent(from, to)
    // A link that a decided card stands on goes only while the card keeps its facts —
    // #werk-contract-amend-scope. Its depends_on link is a change of the card's links, so every
    // fact must hold after. An option leaving a card is the removal of an option.
    if (command === 'unlink' && type === 'depends_on') amendCheck(from, { dropEdge: { from, to, type } }, true)
    if (command === 'unlink' && type === 'alternative_to') amendCheck(to, { dropEdge: { from, to, type } }, false)
    append(command === 'link' ? 'edge.added' : 'edge.removed', { from, to, type, ...(why ? { why } : {}) }, { actor: actor(flags) })
    console.log(`${command === 'link' ? 'linked' : 'unlinked'} ${from} ${command === 'link' ? '--' : 'x-'}${type}--> ${to}${why ? `\n  why: ${why}` : ''}`)
    // An edge on a ghost is drawn but derives nothing. It goes live with the card, so this
    // is a note, not a warning: the link is recorded, it just is not load-bearing yet.
    const ghosts = [from, to].filter((x) => graph().proposed.has(x))
    if (command === 'link' && ghosts.length) {
      console.log(`  held until ${ghosts.join(' and ')} ${ghosts.length > 1 ? 'are' : 'is'} accepted`)
    }
    break
  }

  case 'status': {
    const [id, status] = positional
    if (!id || !['decided', 'open', 'proto'].includes(status)) fail('status needs <id> decided|open|proto')
    const { node } = requireNode(id)
    if (node.kind === 'excerpt') frozen(id, `status ${status}`)
    if (status === 'decided' && node.kind === 'card') contract(id)
    append('status.set', { id, status }, { actor: actor(flags) })
    console.log(`${id} is ${status}`)
    break
  }

  // Kill criteria — #kill. Recorded on an open card, before the decision. Works on a ghost
  // like link and status do: a criterion is a contract fact, not words a person reads.
  case 'kill': {
    const id = positional[0] ?? fail('kill needs an id')
    const { g, node } = requireNode(id)
    if (node.kind !== 'card') fail(`"${id}" is a ${node.kind}. Kill criteria belong on a card.`)
    if (flags.clear === true) {
      append('kill.cleared', { id }, { actor: actor(flags) })
      console.log(`${id}: kill criteria cleared`)
      break
    }
    const input: KillInput = {}
    for (const k of ['form', 'text', 'source', 'metric', 'threshold', 'window', 'min-sample', 'review-date', 'reason', 'fallback'] as const) {
      const v = str(flags, k)
      if (v !== undefined) input[k] = v
    }
    const c = buildCriterion(input)
    if ('error' in c) fail(c.error)
    if (c.fallback) {
      // A new option is a ghost until Eryk accepts it, and its edge is held with it.
      const edges = [...g.edges, ...g.ghostEdges]
      if (!edges.some((e) => e.from === c.fallback && e.to === id && e.type === 'alternative_to')) {
        fail(`--fallback "${c.fallback}" is not an option of "${id}". Link it first: werk link ${c.fallback} ${id} --type alternative_to`)
      }
    }
    append('kill.added', { id, criterion: c }, { actor: actor(flags) })
    console.log(`${id}: kill criterion ${(node.kill?.length ?? 0) + 1} recorded — ${describeKill(c)}`)
    if (c.form === 'no-metric' && c.reason === 'unclear') {
      console.log(`  The hypothesis is unclear. Say once why this beat the alternatives before you decide.`)
    }
    break
  }

  case 'kill-state': {
    const [id, n, state] = positional
    const { node } = requireNode(id ?? fail('kill-state needs <id> <n> <state>'))
    const index = Number(n) - 1
    if (!['monitored', 'unmonitored', 'fired'].includes(state)) fail('state must be monitored, unmonitored, or fired')
    if (!Number.isInteger(index) || !node.kill?.[index]) fail(`"${id}" has no kill criterion ${n}`)
    append('kill.state', { id, index, state, detail: str(flags, 'detail') }, { actor: actor(flags) })
    console.log(`${id}: kill criterion ${n} is ${state}`)
    break
  }

  case 'reopen': {
    const id = positional[0] ?? fail('reopen needs an id')
    const { g: before, node: target } = requireNode(id)
    // A card that is open with no postponed mark was never decided, so there is nothing to
    // reopen — #vi-prop-reopen-scope. A postponed card may be reopened to change its reason.
    if (target.status !== 'decided' && !before.postponedOrigins.has(id)) {
      fail(`"${id}" is ${target.status ?? 'not decided'} and not postponed, so there is nothing to reopen.`)
    }
    const reason = str(flags, 'reason') ?? 'invalidated'
    if (!['postponed', 'invalidated', 'rejected'].includes(reason)) {
      fail('--reason must be postponed, invalidated, or rejected')
    }
    append('reopened', { id, reason, why: str(flags, 'why') }, { actor: actor(flags) })
    const g = graph()
    // Only the marks this reopen made. A card flagged earlier by another reopen is not news.
    const marked = (kind: 'stale' | 'postponed') =>
      [...g.flagWhy].filter(([, traces]) => traces.some((t) => t.kind === kind && t.origin === id)).map(([card]) => card)
    if (reason === 'postponed') {
      const postponed = marked('postponed')
      console.log(`${id} is open again, postponed. ${postponed.length} card(s) went postponed, not stale:`)
      for (const p of postponed) console.log(`  ${p}`)
    } else {
      const stale = marked('stale')
      console.log(`${id} is open again. ${stale.length} card(s) went stale:`)
      for (const s of stale) console.log(`  ${s}`)
    }
    break
  }

  case 'rederive': {
    const id = positional[0] ?? fail('rederive needs an id')
    const { g, node } = requireNode(id)
    const status = str(flags, 'status')
    if (status !== undefined && status !== 'decided') fail('--status takes only decided')
    // #vi-prop-confirm-names: a confirm of a stale card lists every link it read.
    const stale = g.stale.has(id)
    if (stale) {
      const outgoing = g.edges.filter((e) => e.type === 'depends_on' && e.from === id).map((e) => e.to)
      const read = (str(flags, 'confirm') ?? '').split(',').map((s) => unhash(s.trim())).filter(Boolean)
      const unknown = read.filter((t) => !outgoing.includes(t))
      if (unknown.length > 0) fail(`"${id}" has no depends_on link to ${unknown.map((t) => `"${t}"`).join(', ')}. It depends on: ${outgoing.join(', ') || 'nothing'}.`)
      const missing = (g.unread.get(id) ?? []).filter((l) => !read.includes(l.to))
      if (missing.length > 0) {
        const all = [...new Set([...read, ...missing.map((l) => l.to)])].join(',')
        fail(
          `rederive of "${id}" is refused. These links were made before the change and the confirm does not list them:\n` +
            missing.map((l) => `  ${id} -> ${l.to}: ${l.why ?? '(no reason on record)'}`).join('\n') +
            `\nRead each reason, then run: werk rederive ${id} --confirm ${all}`,
        )
      }
    } else if (status === undefined) {
      console.log(`${id} has no stale mark. Nothing was written.`)
      break
    }
    if (status === 'decided' && node.kind === 'card') contract(id)
    append('rederived', { id, status }, { actor: actor(flags) })
    console.log(`${id} is up to date. ${graph().stale.size} card(s) still stale.`)
    break
  }

  case 'move': {
    const id = positional[0] ?? fail('move needs an id')
    const parent = str(flags, 'parent') ?? fail('move needs --parent')
    const { g, node } = requireNode(id)
    requireNode(parent)
    if (node.kind === 'option') fail(`"${id}" is an option. An option has no place in the refines tree, only an alternative_to link.`)
    refuseParent(id, parent)
    // #vi-prop-nolineage: the move goes ahead, and takes out each link it puts in one line.
    const broken = brokenByMoves([...g.edges, ...g.ghostEdges], [{ id, parent }])
    append('level.moved', { id, parent }, { actor: actor(flags) })
    console.log(`${id} now refines ${parent}`)
    for (const e of broken) {
      append('edge.removed', { from: e.from, to: e.to, type: e.type }, { actor: actor(flags) })
      console.log(`  removed ${e.from} --depends_on--> ${e.to}: the move put one under the other`)
    }
    break
  }

  case 'retitle': {
    const [id, title] = positional
    if (!id || !title) fail('retitle needs <id> "new title"')
    requireNode(id)
    frozen(id, 'retitle')
    decidedWords(id, 'retitle')
    append('node.retitled', { id, title }, { actor: actor(flags) })
    console.log(`${id}: ${title}`)
    break
  }

  case 'edit': {
    const id = positional[0] ?? fail('edit needs an id')
    requireNode(id)
    const patch: Record<string, string | boolean> = {}
    for (const key of ['body', 'why', 'finding', 'why_not', 'url', 'text', 'context', 'who']) {
      const v = str(flags, key)
      if (v !== undefined) patch[key] = v
    }
    // who, no-basis and unchallenged are contract facts, not words on the card. They may
    // still be set on a ghost; anything a person reads may not — see #werk-propose-new.
    const words = ['body', 'why', 'finding', 'why_not', 'url', 'text', 'context'].filter((k) => k in patch)
    // An excerpt takes no change at all, not only a change of its words — #werk-excerpt-event-frozen-all.
    if (requireNode(id).node.kind === 'excerpt' && (Object.keys(patch).length || flags['no-basis'] !== undefined || flags.unchallenged !== undefined)) {
      frozen(id, 'edit')
    }
    if (words.length) {
      frozen(id, `edit --${words[0]}`)
      decidedWords(id, `edit --${words[0]}`)
    }
    // A waiver needs a written reason, so each of these two flags takes one as its value.
    for (const k of ['no-basis', 'unchallenged'] as const) {
      if (flags[k] === true) fail(`--${k} needs the reason as its value: --${k} "<why>"`)
    }
    if (typeof flags['no-basis'] === 'string') patch.noBasis = true
    if (typeof flags.unchallenged === 'string') patch.noAlternative = true
    if (Object.keys(patch).length === 0) {
      fail('edit needs at least one of --body --why --finding --why_not --url --who --no-basis --unchallenged')
    }
    // Who decides and a waiver of a decided card change by an amend, so through a proposal —
    // #werk-contract-amend-who.
    const facts: NonNullable<Change['patch']> = {}
    if (patch.who !== undefined) facts.who = patch.who as GraphNode['who']
    if (patch.noBasis) facts.noBasis = true
    if (patch.noAlternative) facts.noAlternative = true
    if (Object.keys(facts).length && requireNode(id).node.status === 'decided') {
      fail(
        `"${id}" is decided, so a change to who decides or to a waiver is an amend. Stage it:\n` +
          `      werk propose ${id} ${Object.entries(patch).filter(([k]) => k === 'who').map(([, v]) => `--who ${v} `).join('')}${patch.noBasis ? `--no-basis ${JSON.stringify(flags['no-basis'])} ` : ''}${patch.noAlternative ? `--unchallenged ${JSON.stringify(flags.unchallenged)}` : ''}`.trimEnd(),
      )
    }
    append('node.bodyEdited', { id, patch }, { actor: actor(flags) })
    console.log(`${id} edited: ${Object.keys(patch).join(', ')}`)
    break
  }

  case 'propose': {
    const id = positional[0] ?? fail('propose needs an id')
    requireNode(id)
    frozen(id, 'propose')
    const title = str(flags, 'title')
    const why = str(flags, 'why')
    const opsRaw = str(flags, 'ops')
    let ops: BodyOp[] | undefined
    if (opsRaw !== undefined) {
      try {
        ops = JSON.parse(opsRaw)
      } catch {
        fail('--ops must be JSON: an array of {"tag":"elaborated","old":"...","new":"..."}')
      }
    }
    const facts: NonNullable<Pending['facts']> = {}
    const who = str(flags, 'who')
    if (who !== undefined) {
      if (who !== 'you' && who !== 'me' && who !== 'prototype') fail('--who must be you, me or prototype')
      facts.who = who
    }
    // A waiver needs a written reason, so each of these two flags takes one as its value.
    for (const k of ['no-basis', 'unchallenged'] as const) {
      if (flags[k] === true) fail(`--${k} needs the reason as its value: --${k} "<why>"`)
    }
    if (typeof flags['no-basis'] === 'string') facts.noBasis = true
    if (typeof flags.unchallenged === 'string') facts.noAlternative = true
    if (title === undefined && why === undefined && ops === undefined && !Object.keys(facts).length) {
      fail('propose needs at least one of --title --why --ops --who --no-basis --unchallenged')
    }
    // applyOps rebuilds the body from the ops alone, so a block nobody mentions is a block
    // that silently disappears on accept. An intended deletion is a `removed` op, which
    // shows in the diff as struck through. Losing a paragraph must never be the quiet case.
    if (ops) {
      const { node } = requireNode(id)
      // Two equal blocks are two blocks: each needs its own op, so a claim uses one up.
      const claimed = new Map<string, number>()
      for (const op of ops) if ('old' in op && op.old) claimed.set(op.old, (claimed.get(op.old) ?? 0) + 1)
      const dropped = splitBlocks(node.body ?? '').filter((b) => {
        const left = claimed.get(b) ?? 0
        if (left > 0) claimed.set(b, left - 1)
        return left === 0
      })
      if (dropped.length) {
        fail(
          `these ${dropped.length} block(s) of "${id}" are in no op, so accepting would delete them:\n` +
            dropped.map((b) => `    "${b.slice(0, 70)}${b.length > 70 ? '...' : ''}"`).join('\n') +
            `\n  Keep one with {"tag":"elaborated","old":"<the block>","new":"<the block>"},\n` +
            `  or drop it on purpose with {"tag":"removed","old":"<the block>"}.`,
        )
      }
    }
    append('change.proposed', { id, title, why, ops, ...(Object.keys(facts).length ? { facts } : {}) }, { actor: actor(flags) })
    const n = graph().nodes.get(id)!
    console.log(`${id}: proposed`)
    for (const r of n.pending?.rejected ?? []) {
      console.log(`  REJECTED (${r.reason}): "${'old' in r.op ? r.op.old : ''}"`)
    }
    if (n.pending?.ops?.length) console.log(`\n${renderOpsMarkdown(n.pending.ops)}`)
    break
  }

  case 'accept': {
    const id = positional[0] ?? fail('accept needs an id')
    const { g, node } = requireNode(id)
    if (!node.pending && !node.proposed) fail(`"${id}" has no pending proposal.`)
    // The gate is the whole point. An agent that can accept its own proposal has not been
    // gated, it has been given a longer path to the same silent append — #werk-propose-new.
    if (actor(flags) !== 'you') {
      fail(
        `accept is Eryk's. Click the ✓ on the card in the map.\n` +
          `  If he asked you to do it from here, say so and pass --actor you.`,
      )
    }
    if (node.pending?.remove) {
      let removal: Removal
      try {
        removal = planRemoval(g, id, node.pending.reparent)
      } catch (err) {
        fail((err as Error).message)
      }
      append('change.accepted', { id }, { actor: 'you' })
      commitRemoval(g, id, removal)
      break
    }
    // The accept of a change to a decided card is an amend, so the card must hold every fact
    // after it — #werk-contract-amend-scope. A ghost's accept is not a change of a decided card.
    if (!node.proposed) amendCheck(id, pendingChange(node.pending), true)
    const ids = node.proposed ? acceptClosure(g, id) : [id]
    // One write: a failure leaves none of the events in the log — #werk-propose-new-node-events.
    appendMany(ids.map((each) => ({ type: 'change.accepted' as const, payload: { id: each }, actor: 'you' as const })))
    console.log(`${id}: accepted`)
    for (const each of ids.filter((x) => x !== id)) {
      console.log(`  and ${each} — ${g.nodes.get(each)?.title ?? ''}`)
    }
    break
  }

  case 'discard': {
    const id = positional[0] ?? fail('discard needs an id')
    const { g, node } = requireNode(id)
    if (!node.pending && !node.proposed) fail(`"${id}" has no pending proposal.`)
    const ids = node.proposed ? discardClosure(g, id) : [id]
    // A child leaves before its parent, all in one write — #werk-propose-new-node-events.
    appendMany([...ids].reverse().map((each) => ({ type: 'change.discarded' as const, payload: { id: each }, actor: actor(flags) })))
    console.log(`${id}: discarded`)
    for (const each of ids.filter((x) => x !== id)) {
      console.log(`  and ${each} — ${g.nodes.get(each)?.title ?? ''}`)
    }
    break
  }

  case 'remove': {
    const id = positional[0] ?? fail('remove needs an id')
    const { g, node } = requireNode(id)
    if (id === 'root') fail('the root card cannot be removed. Every other card hangs off it.')
    if (node.proposed) fail(`"${id}" is only proposed, so there is nothing to remove. Run: werk discard ${id}`)
    const reparent = flags.reparent === true
    // Checked now, so a removal that cannot run is refused here, not at the ✓.
    let removal: Removal
    try {
      removal = planRemoval(g, id, reparent)
    } catch (err) {
      fail((err as Error).message)
    }
    // An agent never removes a card directly. It proposes the removal, and the card shows it
    // pending until the ✓ — #werk-remove.
    if (actor(flags) !== 'you') {
      append('change.proposed', { id, remove: true, reparent }, { actor: actor(flags) })
      console.log(
        `${id}: removal proposed — ${removal.ids.length} node(s) would leave the map${reparent ? `, ${removal.moves.length} child card(s) move up` : ''}.\n` +
          `  Eryk accepts it with the ✓ on the card, or: werk accept ${id} --actor you`,
      )
      break
    }
    commitRemoval(g, id, removal)
    break
  }

  case 'restore': {
    const id = positional[0] ?? fail('restore needs an id')
    const g = graph()
    if (!g.removed.some((r) => r.id === id)) {
      if (g.nodes.has(id)) fail(`"${id}" is already in the map.`)
      fail(`"${id}" was never removed. Run "werk removed" to see what is out.`)
    }
    // A card under a parent that is still out would sit in no tree — #werk-remove-restore-undo-parent-out.
    const outParent = g.removed.find((r) => r.id === id)?.parent
    if (outParent && g.removed.some((r) => r.id === outParent)) {
      fail(`"${id}" sits under "${outParent}", which is still removed. Restore "${outParent}" first: werk restore ${outParent}`)
    }
    append('node.restored', { id }, { actor: actor(flags) })
    const after = graph()
    console.log(`restored ${id} — ${after.nodes.get(id)?.title ?? ''}`)
    // A subtree removal took the children too, and restoring the parent alone leaves them
    // out. Nothing on the restored card would say so, so say it here.
    if (after.removed.length) {
      console.log(`${after.removed.length} card(s) still out: ${after.removed.map((r) => r.id).join(', ')}`)
    }
    break
  }

  case 'removed': {
    const g = graph()
    if (g.removed.length === 0) {
      console.log('Nothing is removed. The map holds every card in the log.')
      break
    }
    for (const r of g.removed) {
      console.log(`${r.at.slice(0, 10)}  ${r.id.padEnd(24)} ${r.title}`)
    }
    console.log(`\nPut one back with: werk restore <id>`)
    break
  }

  case 'show': {
    const g = graph()
    const rootCard = () => {
      const child = new Set(g.edges.filter((e) => e.type === 'refines').map((e) => e.from))
      return [...g.nodes.values()].find((n) => n.kind === 'card' && !n.proposed && !child.has(n.id))?.id
    }
    const id = positional[0] ?? rootCard() ?? fail('the map has no card')
    const node = g.nodes.get(id)
    if (!node) {
      if (g.removed.some((r) => r.id === id)) {
        // The removal's own card is the first node.removed of the run of events it appended.
        const log = readEvents()
        let i = log.map((e) => e.type === 'node.removed' && e.payload.id === id).lastIndexOf(true)
        while (i > 0 && (log[i - 1].type === 'node.removed' || log[i - 1].type === 'level.moved')) i--
        while (log[i] && log[i].type === 'level.moved') i++
        const root = log[i]?.payload.id as string | undefined
        if (root && root !== id) fail(`#${id} is removed with #${root}; restore #${root} to bring it back`)
        fail(`#${id} is removed; restore #${id} to bring it back`)
      }
      fail(`no node #${id} in the map`)
    }
    const flag = g.stale.has(id) ? '  STALE' : g.postponed.has(id) ? '  PAUSED' : g.postponedOrigins.has(id) ? '  POSTPONED' : ''
    const ghost = node.proposed ? '  PROPOSED — not in the map until it is accepted' : ''
    console.log(`${node.kind} ${node.id}  [${node.status ?? '-'}]${flag}${ghost}`)
    console.log(node.title)
    if (node.why) console.log(`why: ${node.why}`)
    if (node.kind === 'excerpt') {
      const where = [
        node.speaker ?? '?',
        node.conversation ? `conversation ${node.conversation}` : '',
        `session ${node.session ?? '?'}`,
        `msg ${node.msgIndex ?? '?'}`,
        node.span ? `span ${node.span[0]}-${node.span[1]}` : '',
        node.saidAt ? node.saidAt : '',
      ]
      console.log(where.filter(Boolean).join(' · '))
      if (node.text) console.log(`"${node.text}"`)
      if (node.context) console.log(`  …${node.context}…`)
    }
    const line = rollupLine(g.rollup.get(id))
    if (line) console.log(`subtree: ${line}`)
    // #vi-prop-bornstale: the mark alone never says which reopen reached here, or how far
    // away it is. A card four hops downstream turned red with nothing on it naming the cause.
    for (const t of g.flagWhy.get(id) ?? []) {
      const tag = t.kind === 'postponed' ? 'PAUSED' : 'STALE'
      const hops = t.via.length <= 1 ? 'a direct dependency' : `${t.via.length} hops: ${[id, ...t.via].join(' -> ')}`
      console.log(`${tag} from #${t.origin}, ${t.reason} on ${t.at.slice(0, 10)} — ${hops}`)
      if (t.why) console.log(`  ${t.why}`)
      // #vi-prop-linkwhy: each hop's reason, so the reader can judge where the chain stops mattering.
      t.via.forEach((to, i) => {
        console.log(`    ${i === 0 ? id : t.via[i - 1]} -> ${to}: ${t.whys[i] ?? '(no reason recorded)'}`)
      })
      const read = (g.unread.get(id) ?? []).map((l) => l.to).join(',')
      console.log(`  This card's link predates the reopen, so re-read it before: werk rederive ${id}${read ? ` --confirm ${read}` : ''}`)
    }
    if (node.body) console.log(`\n${node.body}\n`)
    if (node.pending) {
      console.log(`PENDING — not yet accepted:`)
      if (node.pending.remove) console.log(`  remove this card${node.pending.reparent ? ', children move up' : ' and its subtree'}`)
      if (node.pending.title) console.log(`  title: ${node.pending.title}`)
      if (node.pending.why) console.log(`  why: ${node.pending.why}`)
      for (const r of node.pending.rejected ?? []) {
        console.log(`  REJECTED (${r.reason}): "${'old' in r.op ? r.op.old : ''}"`)
      }
      if (node.pending.ops?.length) console.log(`\n${renderOpsMarkdown(node.pending.ops)}\n`)
    }
    // A ghost's edges are all held, so reading only the live list would print a card with
    // no parent and no basis — the opposite of what was proposed.
    const visible = [...g.edges, ...g.ghostEdges]
    const out = visible.filter((e) => e.from === id)
    const inc = visible.filter((e) => e.to === id)
    for (const e of out) {
      console.log(`  -> ${e.type.padEnd(15)} ${e.to}  ${g.nodes.get(e.to)?.title ?? ''}`)
      if (e.type !== 'depends_on') continue
      console.log(`       why: ${e.why ?? '(no reason recorded)'}`)
      // The target itself may be the origin of a reopen (never in stale/postponed — those hold
      // only its dependents), or it may only be flagged because something further upstream
      // was reopened. Either way, say why.
      const r = g.reopens.get(e.to)
      if (r) {
        const tag = r.reason === 'postponed' ? 'POSTPONED' : 'STALE'
        console.log(`       ${tag} — ${r.reason} on ${r.at.slice(0, 10)}${r.why ? `: ${r.why}` : ''}`)
      } else if (g.stale.has(e.to) || g.postponed.has(e.to)) {
        const tag = g.stale.has(e.to) ? 'STALE' : 'PAUSED'
        console.log(`       ${tag} — from a reopen further upstream, open #${e.to} to trace it`)
      }
    }
    for (const e of inc) {
      // A child's rollup tells you which branch is heavy before you open it.
      const child = e.type === 'refines' ? rollupLine(g.rollup.get(e.from)) : undefined
      console.log(`  <- ${e.type.padEnd(15)} ${e.from}  ${g.nodes.get(e.from)?.title ?? ''}${child ? `  (${child})` : ''}`)
    }
    // #vi-detail-cli-proof: the proof with its words, so the agent never needs a second
    // query to learn why an option was rejected or what was said.
    const proposedTag = (n: GraphNode) => (n.proposed ? '  proposed' : '')
    const options = inc.filter((e) => e.type === 'alternative_to').map((e) => g.nodes.get(e.from)).filter((n) => n !== undefined)
    const cited = out.filter((e) => e.type === 'supported_by').map((e) => g.nodes.get(e.to)).filter((n) => n !== undefined)
    const excerpts = cited.filter((n) => n.kind === 'excerpt')
    const sources = cited.filter((n) => n.kind === 'source')
    if (options.length) {
      console.log('Options')
      for (const o of options) {
        console.log(`  ${o.id}  ${o.title}${proposedTag(o)}`)
        if (o.why_not) console.log(`    why not: ${o.why_not}`)
      }
    }
    if (excerpts.length) {
      console.log('Say')
      for (const x of excerpts) console.log(`  ${x.id}  ${x.speaker ?? '?'}: "${x.text ?? x.title}"${proposedTag(x)}`)
    }
    if (sources.length) {
      console.log('Ev')
      for (const s of sources) {
        console.log(`  ${s.id}  ${s.title}${proposedTag(s)}`)
        if (s.finding) console.log(`    finding: ${s.finding}`)
      }
    }
    break
  }

  case 'convos': {
    const all = listConvos()
    if (all.length === 0) {
      console.log('No conversation has run yet. Start one with "werk serve".')
      break
    }
    const g = graph()
    for (const c of all) {
      const title = c.home ? (g.nodes.get(c.home)?.title ?? '?') : ''
      const drift = c.at && c.at !== c.home ? `  now at #${c.at}` : ''
      console.log(
        `${(c.home ? `#${c.home}` : c.name).padEnd(20)} ${(c.sessionId ?? 'no session').slice(0, 8)}  ` +
          `${String(c.turns).padStart(3)} turns  ${ago(c.lastAt).padEnd(9)}  ${title}${drift}`,
      )
    }
    console.log(`\nRead one with: werk recall <#card|session|${all[0].name}> --grep "term"`)
    break
  }

  case 'recall': {
    const ref = positional[0] ?? fail('recall needs a conversation: a #card, a session id, or a name')
    const found = resolveConvo(ref)
    if (!found) fail(`no conversation matches "${ref}". Run "werk convos" to see them.`)
    if ('ambiguous' in found) {
      fail(
        `"${ref}" matches ${found.ambiguous.length} conversations: ` +
          `${found.ambiguous.map((c) => c.name).join(', ')}. Name one.`,
      )
    }
    const { convo } = found
    const grep = multi(rest, 'grep')
    const context = Number(str(flags, 'context') ?? 2)

    // The full fidelity path. Claude Code's own transcript keeps a tool call's whole input,
    // which werk's chat.jsonl flattens to one line. convo-search.py already parses that
    // format and strips its noise, so shell out rather than write a second parser.
    if (flags.raw === true) {
      if (!convo.sessionId) fail(`${convo.name} has no session id on disk, so --raw has nothing to read.`)
      const script = join(homedir(), '.claude', 'skills', 'prior-conversations', 'scripts', 'convo-search.py')
      if (!existsSync(script)) {
        fail(`--raw needs ${script}, which is not installed. The transcript itself is at ${rawPath(convo.sessionId)}.`)
      }
      const args = [script, 'show', convo.sessionId, '--include-tools']
      if (grep.length) args.push('--grep', ...grep, '--context', String(context))
      else args.push('--tail', str(flags, 'tail') ?? '20')
      const run = spawnSync('python3', args, { stdio: 'inherit' })
      process.exit(run.status ?? 0)
    }

    const lines = recall(convo, {
      grep,
      context,
      tail: Number(str(flags, 'tail') ?? 20),
      tools: flags.tools === true,
      thinking: flags.thinking === true,
      maxChars: Number(str(flags, 'max-chars') ?? 2000),
    })
    console.log(`# ${convo.name}${convo.home ? ` — home #${convo.home}` : ''}  session ${convo.sessionId ?? '?'}`)
    if (lines.length === 0) {
      console.log(
        grep.length
          ? `\nNothing in this transcript matches ${grep.map((t) => `"${t}"`).join(' and ')}. ` +
              'Add --tools to search tool calls, or --raw for the full Claude Code transcript.'
          : '\nThis conversation has no messages yet.',
      )
      break
    }
    console.log()
    console.log(lines.join('\n\n'))
    break
  }

  case 'quote': {
    const [id, ref, wordsArg] = positional
    if (!id || !ref) fail('quote needs <card-id> <card|session|name> "the words"')
    requireNode(id)
    if (wordsArg !== undefined && str(flags, 'text') !== undefined) fail('give the text once, as an argument or with --text')
    const text = wordsArg ?? str(flags, 'text') ?? fail('needs the text to quote')
    const found = resolveConvo(ref)
    if (!found) fail(`no conversation matches "${ref}". Run "werk convos" to see them.`)
    if ('ambiguous' in found) {
      fail(
        `"${ref}" matches ${found.ambiguous.length} conversations: ` +
          `${found.ambiguous.map((c) => c.name).join(', ')}. Name one.`,
      )
    }
    const { convo } = found
    const match = findQuote(convo, text)
    if (!match) {
      fail(
        `"${text}" does not appear verbatim in ${convo.name}'s transcript. Copy it exactly, ` +
          `or run "werk recall ${ref} --grep ..." to find the real wording.`,
      )
    }
    if ('ambiguous' in match) {
      fail(`"${text}" appears in ${match.ambiguous} messages in ${convo.name}. Quote more of the sentence so it is unique.`)
    }
    if ('repeated' in match) {
      fail(`"${text}" appears ${match.repeated} times in one message in ${convo.name}. Quote more of the sentence so it is unique.`)
    }
    // A pointer with a part missing cannot be followed, so the quote refuses before it writes — #werk-excerpt-event-shape.
    const lacking = [['speaker', match.speaker], ['time', match.at], ['session', convo.sessionId]].filter(([, v]) => !v).map(([k]) => k)
    if (lacking.length) fail(`the matched message in ${convo.name} has no ${lacking.join(', ')}, so the excerpt's pointer would be incomplete.`)
    // An id stays taken while its card is out of the map, ghost or removed — #werk-write-remove-links.
    const g = graph()
    const taken = (k: string) => g.nodes.has(k) || g.removed.some((r) => r.id === k)
    const exId = str(flags, 'id') ?? `${id}:ex${(() => { let n = 0; while (taken(`${id}:ex${n}`)) n++; return n })()}`
    if (taken(exId)) fail(`"${exId}" is already taken. Pick another --id.`)
    // An excerpt is verified verbatim against a real transcript, and it still stages: every
    // kind does, so there is one rule and no list of exceptions to remember. The excerpt and
    // its link from the citing card are one event — #werk-excerpt-event.
    append(
      'node.proposed',
      {
        id: exId,
        kind: 'excerpt',
        // An excerpt is a fixed copy of words, not a choice: decided from the start, so it
        // is never an open card — #werk-excerpt-event-status.
        status: 'decided',
        title: text.length > 60 ? `${text.slice(0, 57)}...` : text,
        conversation: convo.name,
        session: convo.sessionId,
        msgIndex: match.msgIndex,
        span: match.span,
        text: match.text,
        speaker: match.speaker,
        saidAt: match.at,
        context: match.context,
        pointerWhole: true,
        citedBy: id,
      },
      { actor: actor(flags) },
    )
    console.log(`${exId}: proposed, supports ${id}: conversation ${convo.name}, message ${match.msgIndex}, span ${match.span[0]}..${match.span[1]}`)
    break
  }

  case 'sample': {
    const briefFile = str(flags, 'brief-file') ?? fail('sample needs --brief-file <path> — briefs are multi-line, so they do not fit a shell-quoted flag')
    if (!existsSync(briefFile)) fail(`no file at "${briefFile}"`)
    const brief = readFileSync(briefFile, 'utf8')
    if (!brief.trim()) fail(`"${briefFile}" is empty`)

    const tierRaw = str(flags, 'tier') ?? 'plan'
    if (tierRaw === 'worktree') {
      fail(
        '--tier worktree is not built for "sample" — a plan-rung sample never edits tracked files.\n' +
          '  A fork that needs a worktree is a built option: run "werk prototype --tier worktree" on it instead.',
      )
    }
    if (tierRaw !== 'plan' && tierRaw !== 'output') fail('--tier must be plan or output')
    const tier = tierRaw as 'plan' | 'output'

    const n = budgetN(flags)
    const timeoutSec = budgetTimeoutSec(flags, 300)
    const timeoutMs = timeoutSec * 1000

    const runId = String(Date.now())
    console.error(`running ${n} ${tier} sample(s) of ${briefFile}, up to ${timeoutSec}s each (run ${runId})...`)

    sample(projectRoot(), brief, { n, timeoutMs, tier, runId }).then(async (results) => {
      for (const r of results) console.error(`  sample ${r.id}${r.error ? `  ERROR: ${r.error}` : '  ok'}`)
      const { forks, rejected } = await findForks(projectRoot(), results, { timeoutMs })
      console.error(`\n${forks.length} fork(s) found:`)
      for (const f of forks) {
        console.error(`\n  ${f.field}`)
        for (const c of f.choices) console.error(`    [${c.sampleIds.join(',')}] ${c.choice} — ${c.reason}`)
      }
      if (rejected.length) {
        console.error(`\n${rejected.length} proposed fork(s) rejected by verification:`)
        for (const r of rejected) console.error(`  ${r.field} — ${r.reason}`)
      }
      console.log(
        JSON.stringify(
          {
            forks,
            rejected,
            samples: results.map((r) => ({
              id: r.id,
              manifest: r.manifest,
              error: r.error,
              ...(r.outputDir ? { outputDir: r.outputDir } : {}),
            })),
          },
          null,
          2,
        ),
      )
    })
    break
  }

  case 'prototype': {
    // Two ways in. --fork reads the options straight off the map, so each result can be
    // linked back to its option card as evidence. --fork-file is a free-standing fork with no
    // card behind it; an option there is linked only if it names a real option "id".
    const forkId = str(flags, 'fork')
    const forkFile = str(flags, 'fork-file')
    if (!forkId && !forkFile) fail('prototype needs --fork <question-id> or --fork-file <path>')
    let field: string
    let options: Array<{ label: string; brief: string; id?: string }>
    if (forkId) {
      requireNode(forkId)
      const g = graph()
      const q = g.nodes.get(forkId)!
      options = [...g.edges, ...g.ghostEdges]
        .filter((e) => e.to === forkId && e.type === 'alternative_to')
        .map((e) => g.nodes.get(e.from))
        .filter((o): o is GraphNode => o?.kind === 'option')
        .map((o) => ({
          id: o.id,
          label: o.id,
          brief: `${q.title}\n\n${q.body ?? q.why ?? ''}\n\nBuild this option, and only this one: ${o.title}\n\n${o.body ?? ''}`,
        }))
      field = q.title
    } else {
      if (!existsSync(forkFile!)) fail(`no file at "${forkFile}"`)
      let parsed: { field?: unknown; options?: unknown }
      try {
        parsed = JSON.parse(readFileSync(forkFile!, 'utf8'))
      } catch {
        fail(`"${forkFile}" is not valid JSON. It needs {"field": "...", "options": [{"label": "...", "brief": "..."}]}`)
      }
      options = (Array.isArray(parsed.options) ? parsed.options : []).filter(
        (o: any): o is { label: string; brief: string; id?: string } => typeof o?.label === 'string' && typeof o?.brief === 'string',
      )
      field = typeof parsed.field === 'string' ? parsed.field : '(unnamed fork)'
    }
    // #al-two: never build one option alone.
    if (options.length < 2) {
      fail(`${forkId ? `#${forkId}` : `"${forkFile}"`} needs at least two options — #al-two: never build one option alone`)
    }

    const tierRaw = str(flags, 'tier') ?? 'output'
    if (tierRaw !== 'output' && tierRaw !== 'worktree') fail('--tier must be output or worktree')
    const tier = tierRaw as 'output' | 'worktree'

    const timeoutSec = budgetTimeoutSec(flags, 600)
    const timeoutMs = timeoutSec * 1000
    const runId = String(Date.now())

    console.error(`building ${options.length} option(s) for "${field}", tier ${tier}, up to ${timeoutSec}s each (run ${runId})...`)
    prototype(projectRoot(), { field, options }, { tier, timeoutMs, runId }).then((results) => {
      for (const r of results) {
        console.error(`\n  ${r.label}${r.error ? `  ERROR: ${r.error}` : ''}`)
        console.error(`    artifact: ${r.artifactDir}`)
        if (r.patchPath) console.error(`    patch: ${r.patchPath}`)
      }
      const evidence = results.map((r, i) => linkEvidence(options[i]?.id, r, tier, runId, flags))
      for (const ev of evidence) if (ev) console.error(`  evidence #${ev} proposed, supported_by its option`)
      console.log(JSON.stringify({ field, options: results.map((r, i) => ({ ...r, evidence: evidence[i] })) }, null, 2))
    })
    break
  }

  case 'sample-options': {
    const target = positional[0] ?? fail('sample-options needs <target-id> "<brief>"')
    const brief = positional.slice(1).join(' ')
    if (!brief) fail('sample-options needs a brief: werk sample-options <target-id> "..."')
    requireNode(target)
    const n = budgetN(flags)
    const timeoutSec = budgetTimeoutSec(flags, 300)
    const timeoutMs = timeoutSec * 1000
    console.log(`running ${n} samples against #${target}, up to ${timeoutSec}s each...`)
    sample(projectRoot(), brief, { n, timeoutMs }).then(async (results) => {
      for (const r of results) {
        console.log(`\n--- sample ${r.id} ${r.error ? `(ERROR: ${r.error})` : ''} ---`)
        console.log(r.manifest || '(no manifest)')
      }
      console.log('\nclustering manifests into forks...')
      const { forks, rejected } = await findForks(projectRoot(), results, { timeoutMs })
      if (rejected.length) {
        console.log(`\n${rejected.length} proposed fork(s) rejected by verification:`)
        for (const r of rejected) console.log(`  ${r.field} — ${r.reason}`)
      }
      if (forks.length === 0) {
        console.log('\nNo fork found. The samples agreed on every point — nothing to ask.')
        return
      }
      console.log(`\n${forks.length} fork(s) — proposing question + option cards under #${target}:\n`)
      for (const fork of forks) {
        const qId = `${target}-${slug(fork.field)}`
        if (graph().nodes.has(qId)) {
          console.log(`  skipping "${fork.field}": #${qId} already exists`)
          continue
        }
        append(
          'node.proposed',
          {
            id: qId,
            kind: 'card',
            status: 'open',
            title: humanize(fork.field),
            why: `Found by sampling #${target}: the samples disagreed here.`,
            parent: target,
          },
          { actor: actor(flags) },
        )
        append(
          'edge.added',
          { from: qId, to: target, type: 'depends_on', why: `The fork is a question inside #${target}'s requirement.` },
          { actor: actor(flags) },
        )
        append(
          'edge.added',
          {
            from: qId,
            to: 'al-sample-fork-options',
            type: 'depends_on',
            why: 'Its options are the samples, turned into option cards the way that card says.',
          },
          { actor: actor(flags) },
        )
        fork.choices.forEach((c, i) => {
          const optId = `${qId}:opt${i}`
          append(
            'node.proposed',
            {
              id: optId,
              kind: 'option',
              title: c.choice,
              body: `${c.reason}\n\nSample(s): ${c.sampleIds.join(', ')}`,
            },
            { actor: actor(flags) },
          )
          append('edge.added', { from: optId, to: qId, type: 'alternative_to' }, { actor: actor(flags) })
        })
        // #al-two's "I do not care" is a live-question affordance, offered when the fork is
        // actually asked — not a graph node. A card can only become decided by naming what
        // was picked; "I do not care" names nothing, so it must never be a competing option
        // an actor could pick their way into "deciding". If the human is indifferent, tag
        // the card who:me and let the agent pick from the real options instead.
        console.log(`  #${qId} — ${humanize(fork.field)}  (${fork.choices.length} option(s))`)
      }
    })
    break
  }

  case 'plan': {
    const subtreeId = positional[0] ?? fail('plan needs <subtree-id>')
    requireNode(subtreeId)
    const timeoutSec = budgetTimeoutSec(flags, 600)
    if (str(flags, 'run')) fail('plan takes no --run: the subtree id is the key of its spec and tickets (#st-plan-extend)')
    refuseWhileRunInProgress(subtreeId)

    // The same silence limit as `werk build --silence` (#lp-overseer-silence).
    const silenceRaw = Number(str(flags, 'silence'))
    const silenceMs = Number.isFinite(silenceRaw) && silenceRaw > 0 ? silenceRaw * 1000 : undefined

    console.error(`planning #${subtreeId}, up to ${timeoutSec}s...`)
    plan(projectRoot(), graph(), subtreeId, { timeoutMs: timeoutSec * 1000, silenceMs }).then((result) => {
      if (!result.ok && result.reason === 'blocked') {
        console.error(`blocked: ${result.blockedBy.length} open or proto card(s) in the subtree:`)
        for (const id of result.blockedBy) console.error(`  #${id}`)
      } else if (!result.ok && result.reason === 'spec-invalid') {
        console.error(`the spec at ${result.spec} is not usable: ${result.error}`)
      } else if (!result.ok) {
        console.error(`${result.step} agent error: ${result.error}`)
      } else {
        console.error(`spec: ${result.spec}`)
        for (const p of result.proposed) console.error(`  ${p.ok ? 'proposed' : 'NOT proposed'}  #${p.id}  ${p.detail}`)
        console.error(`wrote ${result.tickets.length} ticket(s) to ${result.dir}, ${result.planned.length} on the board`)
        for (const id of result.archived) console.error(`  archived  ${id}  the spec no longer needs it`)
        for (const c of result.checks) console.error(`  ${c.ok ? 'ok' : 'FAIL'}  ${c.file}  ${c.detail}`)
      }
      if (!result.ok || !result.checks.every((c) => c.ok)) process.exitCode = 1
      console.log(JSON.stringify(result, null, 2))
    })
    break
  }

  case 'loop': {
    const briefFile = str(flags, 'brief-file')
    const brief = briefFile
      ? existsSync(briefFile)
        ? readFileSync(briefFile, 'utf8')
        : fail(`no file at "${briefFile}"`)
      : (positional[0] ?? fail('loop needs "<brief>" or --brief-file <path>'))
    const checks = multi(rest, 'check')
    if (checks.length === 0) fail('loop needs at least one --check "<command>"')
    const cardIds = multi(rest, 'card')
    for (const id of cardIds) requireNode(id)
    const capRaw = Number(str(flags, 'cap') ?? 5)
    const cap = Math.min(Math.max(1, Number.isFinite(capRaw) ? Math.floor(capRaw) : 5), 10)
    const timeoutSec = budgetTimeoutSec(flags, 600)
    const cards = decidedClosure(graph(), cardIds)

    console.error(`loop, cap ${cap}, up to ${timeoutSec}s per pass, ${cards.length} decided card(s)...`)
    loop(projectRoot(), { brief, cards, checks, cap, passTimeoutMs: timeoutSec * 1000, run: str(flags, 'run') }).then((r) => {
      console.error(`${r.green ? 'green' : 'not green'} after ${r.passes} pass(es), ${Math.round(r.ms / 1000)}s, $${r.costUsd.toFixed(2)}`)
      if (r.error) console.error(`error: ${r.error}`)
      if (r.base) console.error(`diff: git diff ${r.base} ${r.branch}`)
      console.log(JSON.stringify(r, null, 2))
      if (r.error) process.exitCode = 1
    })
    break
  }

  case 'target': {
    // #st-build-target: one target repository per project, with no default.
    const given = positional[0]
    if (given === undefined) {
      const t = targetFor()
      if ('error' in t) fail(t.error)
      console.log(t.repo)
      break
    }
    setTarget({ given, cwd: projectRoot() }).then((t) => {
      if ('error' in t) fail(t.error)
      console.log(`the project builds in ${t.repo}`)
    })
    break
  }

  case 'build': {
    const id = positional[0] ?? fail('build needs <ticket-id>, for example "st-build-steps/03"')
    const o = buildFlags(flags)
    console.error(`building ${id}, cap ${o.cap}, up to ${o.passTimeoutMs / 1000}s per session, silence ${o.silenceMs / 1000}s...`)
    // The board spawns a build detached and says so in WERK_BUILD_GROUP: this process then
    // leads its own process group, and a stop signals the whole group (board-routes.ts).
    const owner = { pid: process.pid, group: process.env.WERK_BUILD_GROUP === '1' }
    // #st-build-target: the project's target, with no default.
    const t = targetFor()
    if ('error' in t) fail(t.error)
    build(projectRoot(), graph(), id, { ...o, repo: t.repo, loopRun: str(flags, 'loop-run'), owner })
      .then((r) => {
        // #st-build-ticket-hand-off: a build of one ticket that the merge loop did not start
        // leaves no session on the ticket when it ends red at the retry cap, so the ticket goes
        // back to ready with the reason. A green end moved it to merging in the build itself.
        if (r.result === 'cap' || r.result === 'silence') appendBoard('ticket.moved', { id, to: 'ready', reason: 'red at the retry cap' })
        if (r.result === 'refused') console.error(`werk: ${r.error}`)
        else console.error(`${r.result} after ${r.passes} pass(es)${r.branch ? `, branch ${r.branch}` : ''}${r.error ? `: ${r.error}` : ''}`)
        console.log(JSON.stringify(r, null, 2))
        process.exitCode = r.result === 'green' ? 0 : 1
      })
    break
  }

  case 'run': {
    const run = positional[0] ?? fail('run needs <plan-run>, the run name "werk plan" printed')
    const o = buildFlags(flags)
    const t = targetFor()
    if ('error' in t) fail(t.error)
    refuseWhileRunInProgress(run)
    console.error(`running ${run} in ${t.repo}: up to ${RUN_PARALLEL} tickets at once, cap ${o.cap} passes per ticket...`)
    runPlan(projectRoot(), graph, run, { ...o, repo: t.repo })
      .then((r) => {
        console.error(`${r.end}${r.detail ? `: ${r.detail}` : ''} — ${r.merges.filter((m) => m.green).length} merged, $${r.costUsd.toFixed(2)}`)
        console.log(JSON.stringify(r, null, 2))
        process.exitCode = r.end === 'done' || r.end === 'gate' ? 0 : 1
      })
    break
  }

  case 'restart': {
    // #werk-board-restart, #st-run-start-guard: a restart ends the subtree's unfinished work,
    // then plans and runs it again. It prints what it ends, and does it only with --yes.
    const id = positional[0] ?? fail('restart needs <subtree-id>')
    requireNode(id)
    const t = targetFor()
    if ('error' in t) fail(t.error)
    refuseWhileRunInProgress(id)
    const blocked = planBlockers(graph(), id)
    if (blocked.length) fail(`open or proto cards in the scope: ${blocked.join(', ')}. Nothing was ended.`)
    const lines = restartLines(id, restartPlan(foldBoard(readBoard()), id))
    if (flags.yes !== true) {
      for (const l of lines) console.error(l)
      fail(`nothing was ended. Run "werk restart ${id} --yes" to end this work and plan again.`)
    }
    const ended = endUnfinishedWork(foldBoard(readBoard()), id, { actor: actor(flags), stop: (x) => signalBuild(x, alive) })
    for (const x of ended.cancelled) console.error(`  cancelled the build of ${x}; its branch stays`)
    for (const x of ended.archived) console.error(`  archived ${x}; "werk ticket restore ${x}" puts it back`)
    // The plan and the run are this command's children, so the start guard does not see this
    // process as a run in progress.
    const self = [process.execPath, process.argv[1]]
    const step = (verb: string) => spawnSync(self[0], [self[1], verb, id], { stdio: 'inherit' }).status ?? 1
    process.exitCode = step('plan') === 0 ? step('run') : 1
    break
  }

  case 'gate': {
    const [run, verb] = positional
    if (!run) fail('gate needs <plan-run>')
    const g2 = foldBoard(readBoard()).runs.get(run)?.gates.G2
    if (verb && verb !== 'approve') fail(`unknown gate verb "${verb}". Use: werk gate <run> approve --actor you`)
    // A gate is a pause for a person (#st-gates). Like accept, it needs the claim that one asked.
    if (verb && actor(flags) !== 'you') fail('gate approve is a person\'s call: it needs --actor you')
    // #st-build-target: G2 belongs to the tip of the target's main line.
    const t = targetFor()
    if ('error' in t) fail(t.error)
    ;(async () => {
      const tip = await mainLineTip(t.repo).catch((e: Error) => fail(`${t.repo}: ${e.message}`))
      const moved = g2?.waiting && tip !== g2.waiting ? ` ${MAIN_LINE} of ${t.repo} has moved on to ${tip.slice(0, 8)}: run "werk run ${run}" to open G2 for it.` : ''
      if (!verb) {
        console.log(
          (!g2?.waiting ? `G2 of ${run} is not open.` : g2.passed === g2.waiting ? `G2 of ${run} is passed for ${g2.passed.slice(0, 8)}.` : `G2 of ${run} waits for ${g2.waiting.slice(0, 8)}: ${g2.reason}`) + moved,
        )
        return
      }
      if (!g2?.waiting) fail(`G2 of ${run} is not waiting. Run "werk run ${run}" until it stops at the gate.`)
      if (g2.passed === g2.waiting) fail(`G2 of ${run} is already passed for ${g2.waiting.slice(0, 8)}`)
      // A pass is for the tree a person looked at. A tree that is no longer the tip is not it.
      if (moved) fail(`G2 of ${run} waits for ${g2.waiting.slice(0, 8)}, but${moved}`)
      appendBoard('gate.passed', { run, gate: 'G2', tip: g2.waiting }, { actor: 'you' })
      console.log(`G2 of ${run} passed for ${MAIN_LINE} at ${g2.waiting.slice(0, 8)}`)
    })()
    break
  }

  case 'fails': {
    const report = failReport(foldPasses(readPipeline()))
    if (flags.json) console.log(JSON.stringify(report, null, 2))
    else for (const l of renderFailReport(report)) console.log(l)
    break
  }

  case 'stale': {
    // #werk-cli-stale. Reads the log, writes nothing, exits 0 when nothing is marked.
    const g = graph()
    const under = positional[0]
    if (under && !g.nodes.has(under)) fail(`no node with the id "${under}"`)
    const kind = str(flags, 'kind')
    if (kind !== undefined && !MARK_KINDS.includes(kind as MarkKind)) fail(`--kind must be one of ${MARK_KINDS.join('|')}`)
    for (const line of renderMarks(markList(g, { under, kind: kind as MarkKind | undefined }))) console.log(line)
    break
  }

  case 'find': {
    const g = graph()
    const root = positional[0]
    if (root) requireNode(root)
    const wantStatus = str(flags, 'status')
    if (wantStatus && wantStatus !== 'open' && wantStatus !== 'proto') {
      fail('--status must be open or proto')
    }
    const children = new Map<string, string[]>()
    for (const e of g.edges) {
      if (e.type !== 'refines') continue
      const list = children.get(e.to) ?? []
      list.push(e.from)
      children.set(e.to, list)
    }
    const found: string[] = []
    // #werk-find-scope-cli: with no id, read each tree of the map in turn.
    const hasParent = new Set(g.edges.filter((e) => e.type === 'refines').map((e) => e.from))
    const queue = root ? [root] : [...g.nodes.keys()].filter((id) => !hasParent.has(id))
    const seen = new Set(queue)
    while (queue.length > 0) {
      const current = queue.shift()!
      const n = g.nodes.get(current)
      if (
        n?.kind === 'card' &&
        (n.status === 'open' || n.status === 'proto') &&
        (!wantStatus || n.status === wantStatus) &&
        !g.stale.has(current) &&
        !g.postponed.has(current) &&
        !g.postponedOrigins.has(current)
      ) {
        found.push(current)
      }
      for (const child of children.get(current) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        queue.push(child)
      }
    }
    if (found.length === 0) {
      console.log(root ? `There is no open or proto card to work on under ${root}.` : 'There is no open or proto card to work on.')
      break
    }
    for (const id of found) {
      const n = g.nodes.get(id)!
      console.log(`${id}  ${n.status}  ${n.title}`)
    }
    break
  }

  case 'rework': {
    // #werk-cli-rework. Reads the board log, the decision log and the target repository.
    const t = targetFor()
    if ('error' in t) fail(t.error)
    const board = readBoard()
    const report = reworkReport(reworkedCards(board, readEvents()), reworkedCode(t.repo, greenMerges(board)))
    if (flags.json) {
      console.log(JSON.stringify(report, null, 2))
      break
    }
    for (const r of report.rows) {
      const parts = []
      if (r.cards.length) parts.push(`cards reopened: ${r.cards.map((c) => `#${c}`).join(', ')}`)
      if (r.changed) parts.push(`lines changed: ${r.changed} of ${r.lines}`)
      console.log(`${r.ticket}  ${parts.join('  ')}`)
    }
    console.log(`${report.totals.tickets} tickets with rework: ${report.totals.cards} cards reopened, ${report.totals.changed} lines changed`)
    console.log(`${report.open.length} merges with the window still open${report.open.length ? `: ${report.open.join(', ')}` : ''}`)
    console.log(`${report.gone.length} merges whose commits the repository no longer holds${report.gone.length ? `: ${report.gone.join(', ')}` : ''}`)
    break
  }

  case 'followed': {
    // #werk-cli-followed: the other way a pass closes its obligation (#st-build-card). Every
    // refusal comes before the append, so a refused call writes nothing.
    const id = positional[0] ?? fail('followed needs an obligation id')
    const list = str(flags, 'cards')
    if (!list) fail('--cards is required')
    const cards = list.split(',').map((c) => unhash(c.trim())).filter(Boolean)
    if (cards.length === 0) fail('--cards is required')
    const g = graph()
    const o = g.obligations.get(id) ?? fail(`no obligation "${id}"`)
    if (o.followed) fail(`${id} is already closed by a record`)
    if (o.cards.length) fail(`${id} is already closed by a card: #${o.cards[0]}`)
    for (const c of cards) {
      const n = g.nodes.get(c)
      if (!n || n.proposed || n.kind !== 'card' || n.status !== 'decided') fail(`${c} is not a decided card`)
    }
    append('obligation.followed', { id, cards }, { actor: actor(flags) })
    console.log(`${id} closed: no new decision, follows ${cards.map((c) => `#${c}`).join(', ')}`)
    break
  }

  case 'say': {
    const [id, ...words] = positional
    const text = words.join(' ')
    if (!id || !text) fail('say needs <id> "your message"')
    requireNode(id)
    append('note.added', { node: id, text }, { actor: actor(flags) })
    console.log(`noted on ${id}`)
    break
  }

  case 'inbox': {
    const g = graph()
    const since = Number(str(flags, 'since') ?? 0)
    const all = readEvents()
    // A note above a later proposal of the same id was about the earlier words — #werk-propose-new-discard-thread-inbox.
    const reproposed = (node: string, seq: number) => all.some((x) => x.type === 'node.proposed' && x.payload.id === node && x.seq > seq)
    const notes = all
      .filter((e) => e.type === 'note.added' && e.seq > since && e.actor === 'you')
      .slice(-Number(str(flags, 'n') ?? 20))
    if (notes.length === 0) {
      console.log('The inbox is empty.')
      break
    }
    for (const e of notes) {
      const n = g.nodes.get(e.payload.node)
      console.log(`\n[${e.seq}] #${e.payload.node} — ${n?.title ?? '?'}${g.stale.has(e.payload.node) ? '  STALE' : ''}${reproposed(e.payload.node, e.seq) ? '  (on earlier words, proposed again since)' : ''}`)
      console.log(`  ${e.payload.text}`)
    }
    break
  }

  case 'import': {
    const file = positional[0] ?? fail('import needs a file')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const events = [
      ...data.nodes.map((n: any) => ({ type: 'node.added' as const, payload: n })),
      ...data.edges.map((e: any) => ({ type: 'edge.added' as const, payload: e })),
    ]
    const n = appendMany(events)
    console.log(`imported ${data.nodes.length} nodes and ${data.edges.length} edges as ${n} events`)
    break
  }

  case 'cost': {
    if (positional[0] === 'import') {
      const { added, skipped } = importPlanTurns()
      console.log(`${added} turns added to ${paths.pipeline}. ${skipped} were already there.`)
      const m = importMissingSessions()
      console.log(`${m.added} pipeline sessions with no event written from their transcripts. ${m.unclassified} (${m.unclassifiedUsd.toFixed(0)}) have no known role and were left out.`)
      const s = importPipelineCosts()
      console.log(`${s.corrected} pipeline sessions corrected. ${s.unchanged} were right, ${s.skipped} already corrected, ${s.notRebuilt} have no transcript left.`)
      break
    }
    const h = foldPlanCost(readPipeline(), readEvents())
    if (h.cards.length === 0 && Object.keys(h.reasons).length === 0) {
      console.log('The pipeline log holds no plan turns yet. Run "werk cost import" first.')
      break
    }
    if (flags.json) {
      console.log(JSON.stringify(h, null, 2))
      break
    }
    const usd = (n: number) => `$${n.toFixed(2)}`
    const dist = (d: { n: number; median: number; p90: number; max: number }) =>
      `n=${d.n}  median ${usd(d.median)}  p90 ${usd(d.p90)}  max ${usd(d.max)}`
    console.log(`Plan cost from the pipeline log — API prices valid from ${h.prices.join(', ')}`)
    console.log(`sessions: ${h.sessions.chatPane} chat pane, ${h.sessions.terminal} terminal`)
    console.log(
      `plan ${usd(h.dollars.plan)} (chat pane ${usd(h.dollars.planChatPane)}, terminal ${usd(h.dollars.planTerminal)})` +
        `   not plan ${usd(h.dollars.notPlan)}`,
    )
    console.log(`  of plan: refinement ${usd(h.dollars.plan - h.dollars.prototype)}, prototype ${usd(h.dollars.prototype)}`)
    for (const [reason, r] of Object.entries(h.reasons)) {
      console.log(`  ${reason.padEnd(13)} ${String(r.turns).padStart(5)} turns  ${usd(r.dollars).padStart(10)} before the split`)
    }
    if (h.unpricedResponses) console.log(`  ${h.unpricedResponses} responses from a model with no price: counted as $0`)
    console.log(`\nper card:              ${dist(h.perCard)}`)
    console.log(`per decided card, /day: ${dist(h.perDecidedCardPerDay)}`)
    const top = Number(str(flags, 'top') ?? 15)
    console.log(`\ntop ${top} cards: plan, of it prototype, wall time, turns`)
    for (const c of h.cards.slice(0, top)) {
      console.log(
        `  ${usd(c.dollars).padStart(9)}  ${usd(c.prototype).padStart(9)}  ${(c.wallSec / 60).toFixed(0).padStart(5)} min  ${String(c.turns).padStart(4)} turns  #${c.card}`,
      )
    }
    console.log('\nper day: plan  of it prototype  not plan  decided  plan per decided card')
    for (const d of h.days) {
      console.log(
        `  ${d.day}  ${usd(d.plan).padStart(9)}  ${usd(d.prototype).padStart(9)}  ${usd(d.notPlan).padStart(9)}  ${String(d.decided).padStart(4)}  ${d.perDecided === null ? '—' : usd(d.perDecided)}`,
      )
    }
    break
  }

  case 'events': {
    const n = Number(str(flags, 'n') ?? 20)
    for (const e of readEvents().slice(-n)) {
      console.log(`${String(e.seq).padStart(4)} ${e.at.slice(11, 19)} ${e.actor.padEnd(5)} ${e.type.padEnd(16)} ${JSON.stringify(e.payload).slice(0, 90)}`)
    }
    break
  }

  default: {
    // A verb in its own module under src/verbs/ (#werk-verb-registry).
    const verb = findVerb(command)
    if (!verb) fail(`unknown command "${command}". Run "werk help".`)
    // #werk-hmr-entry-settles: the start-up does not wait for the verb. A callback prints its
    // lines and ends the process, so the first evaluation finishes at once and a hot reload can run.
    void Promise.resolve()
      .then(() => verb.run({ positional, flags, actor: actor(flags) }))
      .then(
        (lines) => {
          for (const l of lines) console.log(l)
        },
        (err: Error) => fail(err.message),
      )
  }
}
