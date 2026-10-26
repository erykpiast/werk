# Personal software development pipeline — design v0

Status: draft, agreed in conversation on 2026-09-01. Not built yet.
Destination: this document becomes the first issue in the tracker of the `pipeline` project.

## Purpose

Build a loop where Eryk supplies judgement, drive, and intent, and Claude supplies
knowledge and implementation speed. The loop must run without repeated human prompting
between the gates.

## Core values (source: Eryk)

1. **Alignment on intent.** Claude must know what to build and why. Built by talking,
   asking questions, and reviewing prototypes together.
2. **Quick iteration.** Concrete options beat descriptions. "This or that" is easier to
   decide than a wall of text.
3. **Visual representation.** Eryk is a visual thinker. Diagrams, schemas, and wireframes
   are the primary medium, not an extra.
4. **Autonomous implementation loop.** Claude builds, validates, finds problems, fixes
   them, re-validates, reviews the code, applies the review, and re-validates again. No
   human in that loop. It exits when the code matches the standard for the stage.
5. **Ship.** Pull requests with a clear change description, the motivation, and testing
   and deployment instructions.
6. **Measure and analyse.** Run agreed checks or read live metrics. Find patterns, find
   gaps, propose improvements. That output opens the next intent.

Steps 1 to 6 are a loop.

## Constraint: the result must become a standalone product

The Claude Code terminal user interface (TUI) is good, but it is a temporary harness.
What we test here must be extractable into a standalone product. This constraint decides
the architecture.

**Rule: logic goes in a program. Markdown holds prompt text only.**

A Claude Code skill is a prompt file. It cannot become a product. If the pipeline logic
lives in 15 skill files, extracting it later is a rewrite, not a move.

## Architecture

```
┌─ UI  (swappable) ───────────────────────────────────────┐
│  today: Claude Code TUI  +  the Linear / GitHub issue   │
│  later: a purpose-built product UI                      │
└───────────────▲─────────────────────────────────────────┘
                │ subscribes
┌───────────────┴─ EVENT LOG  (append-only) ──────────────┐
│  one stream. Drives the UI, feeds step 6, allows resume.│
└───────────────▲─────────────────────────────────────────┘
                │ emits
┌───────────────┴─ ENGINE  (this is the product) ─────────┐
│  state machine · rubric runner · loop controller        │
│  interfaces: Tracker | AgentRuntime | Renderer | Bus    │
└───────────────▲─────────────────────────────────────────┘
                │ calls
┌───────────────┴─ AGENT RUNTIME  (swappable) ────────────┐
│  today: Claude Code, headless   later: Agent SDK direct │
└─────────────────────────────────────────────────────────┘
```

### The event log

The engine must never assume a human watches a terminal. Every state change is an event
on an append-only log. Today the TUI reads it. Later a product UI reads the same log, and
nothing in the engine changes.

The log is one object with three uses:

1. It renders progress in any user interface.
2. It is the data that step 6 analyses to improve the pipeline itself.
3. It lets a killed loop resume from the last good state.

### The four interfaces

Nothing else in the engine touches the outside world.

| Interface | Today | Later |
| --- | --- | --- |
| `Tracker` | Linear GraphQL API, `gh` | the same, plus others |
| `AgentRuntime` | Claude Code, headless | Claude Agent SDK, direct |
| `Renderer` | Mermaid to PNG, Playwright screenshot | the same |
| `Bus` | append to a JSONL file | a real event store |

`Tracker` has six verbs: `getBrief`, `setBrief`, `addNote`, `setStage`, `listByStage`,
`linkPR`. That is the whole contact with Linear and GitHub. A third tracker later costs
one file.

## State lives in the issue tracker

Linear for work projects. GitHub Issues for personal side projects.

The tracker gives three things a local folder cannot: the record outlives the branch,
Eryk can read it on a phone, and step 6 can query across every past work item to find
patterns.

### The seam

**If Eryk must judge it, or it must outlive the branch, it goes to the tracker. If the
loop must run it, it stays local.**

| Tracker | Local |
| --- | --- |
| issue body = the brief: intent, why, success signal | rubric files (committed) |
| workflow state = the pipeline stage. The gates live here. | prototype worktrees (deleted after G2) |
| comments = options, decision, verdicts, PR link, metrics | the event log |
| attachments = diagrams, wireframes, screenshots | caches |

The local folder is a cache. Delete it at any time. The engine rebuilds it from the issue.

### Repository layout per project

```
<project>/.pipeline/
  rubrics/prototype.md     committed. Project truth, useful to the team.
  rubrics/production.md    committed.
  run/                     gitignored. Cache, worktrees, event log.
```

## The state machine

```
 intent ──[G1]──▶ options ──[G2]──▶ building ──[G3]──▶ merging ──▶ measuring ──▶ done
   ▲                                    │                                          │
   │                                    │ 3 identical failures                     │
   │                                    ▼                                          │
   │                                 blocked (posts to the issue, waits)           │
   └───────────────────────────────────────────────────────────────────────────────┘
                        step 6 opens the next intent
```

The tracker already has workflow states, so the gates need no new user interface. Eryk
approves by moving the issue. That works from a phone. It also means the pipeline has no
hidden state: where a work item stands is a thing you can see.

Linear uses custom workflow states. GitHub Issues uses labels, for example
`pipeline:options`. The `Tracker` adapter hides the difference.

### The three gates

| Gate | Eryk decides |
| --- | --- |
| G1 | The brief is right. The intent and the success signal are correct. |
| G2 | Which option to build. |
| G3 | The pull request is correct. Approval also permits the merge. |

## The loop controller

This is step 4. It must run with no human input.

```
build      the agent implements against the brief and the decision
validate   run every rubric check
  pass  ─► review (code-review agent)
            findings? ─► fix ─► validate again
            clean?    ─► done, open the draft pull request
  fail  ─► diagnose ─► fix ─► validate again

stop rule: 3 failures on the same check ─► state = blocked,
           post the check, the error, and the 3 attempts to the issue
```

The stop rule is what prevents a runaway loop. Without it, autonomy is a risk instead of
a feature.

## Rubrics

The rubric is the machine-checkable exit criterion for a stage. It is what lets the loop
stop by itself. "Until it is good" is not a stop condition.

Rubrics are per project, written once. Claude drafts them by reading the repository, the
continuous integration workflow, and `package.json`. Eryk corrects them one time. Then the
loop runs without further input.

`prototype.md` and `production.md` are different files with different bars.

Example `production.md`:

```
1. `CI=true pnpm test` exits 0
2. `pnpm typecheck` exits 0
3. `pnpm lint` exits 0
4. the code-review agent reports 0 high-severity findings
5. every item in the brief has a test
6. the screenshot matches the chosen option
```

## Options and prototypes

Step 2 always produces at least two options. One option turns a decision into a rubber
stamp. Judgement needs contrast.

Prototypes are ephemeral:

1. The engine creates a throwaway git worktree per option.
2. Each option is built and run there.
3. Playwright takes the screenshots.
4. The screenshots and a short trade-off note go to the issue as the G2 decision record.
5. Eryk picks.
6. The worktrees are deleted.

The production implementation starts from the brief and the decision, not from prototype
code. Prototype code carries prototype quality into production, and the rubric would then
have to fight it.

One safeguard: the chosen option's diff is attached to the issue as a `.patch` file. It is
a record, not living code. Nothing depends on it.

## Visual output

Every diagram is rendered to an image and attached to the issue. Claude does not post
Mermaid source. GitHub renders Mermaid in issue text; Linear may not. Rendering to an
image is one code path, it works in both trackers, and it works on a phone.

The Mermaid source is kept in the local folder so the engine can redraw it.

## Autonomy limit

Chosen: **merge on green continuous integration**, after G3 approval.

Two safeguards are required:

1. `pipeline pause` — one command stops all merging across every project.
2. Every automatic merge posts the revert command to the issue as its last note.

## The engine builds itself

The command-line interface (CLI) lives in its own repository, `~/Projects/pipeline`, not
in `~/.claude`. It is a personal side project, so it uses GitHub Issues. From work item
two onward, the pipeline builds itself through the pipeline. Every gap Eryk feels becomes
an issue in the same system.

### Planned command surface

```
pipeline init      # create an issue from a brief
pipeline stage     # report where a work item is
pipeline options   # build N prototypes, post the decision record
pipeline loop      # build → validate → fix, until the rubric passes
pipeline ship      # open the pull request from the record
pipeline measure   # run the checks, post the results
pipeline pause     # stop all merging
```

### Day one: the skeleton

About one day of work. Four pieces, nothing more.

| Piece | What it is |
| --- | --- |
| `Tracker` | Six verbs. The Linear GraphQL API and `gh` behind one interface. |
| State machine | The states above. Linear workflow states, GitHub labels. |
| Event log | Append-only JSONL. `pipeline events` prints it. |
| `pipeline init` | Turn a conversation into an issue with a brief, in `intent`. |

Each later command is built when the first real feature needs it. No guessing.

Setup requirement: a Linear API key in the environment. `gh` is already installed.

## Path from here

1. Build the skeleton. About one day.
2. Run one real feature end to end. Claude fills gaps by hand where the CLI is missing.
   This tells us what to build next.
3. From work item three, the pipeline runs itself.

Expect the loop to be hands-off after about five work items in a given project. The first
two teach the rubric.

## Open questions

- Which project and which feature go first.
- How step 6 reads live metrics. Which sources: PostHog, Sentry, continuous integration
  timings, the event log itself.
- Whether the review stage needs several reviewers with different viewpoints, or one.
- How the pipeline handles a work item that spans more than one repository.
```
