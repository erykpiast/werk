# Handover: the agent development pipeline, and the decision map

Session `ce5ad95b-63fc-4597-a5b5-cfa6079d241c`, 2026-08-31 to 2026-09-01.
Working directory `~/Projects/dotclaude`. Nothing was built in a real project yet.

This document is the reference for picking the topic back up. Read Part 3 first if you read
nothing else — it is the finding that changed the design most, and it is not obvious from
the artifacts.

---

## 0. How to use this pack

| File | What it holds |
| --- | --- |
| **`HANDOVER-pipeline-and-decision-map.md`** | This document. Start here. |
| `dev-pipeline-design.md` | The pipeline design as first agreed, before the research. |
| `dev-pipeline-research.md` | Landscape and the five corrections the research forced. |
| `dev-pipeline-research-alternatives.md` | Three axes: execution topologies, intent alignment, visual. |
| `dev-pipeline-research-design-tool.md` | Prior art for the decision map: IBIS, semantic zoom, Loom, TMS. |
| `decision-map-structure.md` | The settled data schema. This is what the engine implements. |
| `decision-map.html` | The working prototype. Open it in a browser. |
| `decision-map-data.json` | The prototype's data as a portable typed graph. 154 nodes, 191 edges. |
| `conversation-map.html` | The first, superseded prototype. Kept as a record of what failed. |
| `session-transcript.md` | Readable transcript, 74 turns. |
| `session-transcript-raw.jsonl` | The full session record, 504 lines, every tool call and result. |

All of these live in `~/.claude/plans/`, which is **gitignored**. They survive on this
machine only. Moving them into a tracked location is an open decision.

---

## 1. The problem, and who does what

Eryk builds features and fixes bugs across several projects, some at work and some personal.
He wants a repeating pipeline where each side does what it is good at.

- **Eryk brings** judgement, drive, and the intent.
- **Claude brings** knowledge and implementation speed.

He stated six values. They are a loop, not a sequence.

1. **Alignment on intent.** Claude must know what to build and why. Built by talking, asking
   questions, and reviewing prototypes together.
2. **Quick iteration.** Concrete options beat descriptions. "This or that" is easier to
   decide than a wall of text.
3. **Visual representation.** Eryk is a visual thinker. Diagrams, schemas, and wireframes are
   the primary medium, not an extra.
4. **Autonomous implementation loop.** Claude builds, validates, finds problems, fixes them,
   re-validates, reviews the code, applies the review, and re-validates. No human inside that
   loop. It exits when the code matches the standard for the stage.
5. **Ship.** Pull requests with a clear change description, the motivation, and testing and
   deployment instructions.
6. **Measure and analyse.** Run agreed checks or read live metrics. Find patterns and gaps.
   That output opens the next intent.

One hard constraint arrived later and reshaped everything:

> **What we test here must be possible to turn into a standalone product.** The Claude Code
> terminal interface is a temporary harness, not the destination.

---

## 2. The pipeline design as settled

### 2.1 The rule that follows from the product constraint

**Logic goes in a program. Markdown holds prompt text only.**

A Claude Code skill is a prompt file. It cannot become a product. If the pipeline logic lives
in fifteen skill files, extracting it later is a rewrite, not a move. So the state machine,
the tracker adapter, the rubric runner, and the loop controller go into a small TypeScript
command-line interface. Skills become three-line wrappers that call it.

### 2.2 Four layers, one event log

```
UI            today: Claude Code terminal + the tracker issue
              later: a purpose-built product interface
      ▲ subscribes
EVENT LOG     append-only. Drives any UI, feeds step 6, allows resume.
      ▲ emits
ENGINE        state machine · rubric runner · loop controller
              interfaces: Tracker | AgentRuntime | Renderer | Bus
      ▲ calls
AGENT RUNTIME today: Claude Code headless.  later: the Claude Agent SDK.
```

The engine must never assume a human is watching a terminal. Every state change is an event.
The event log is one object with three uses: it renders progress in any interface, it is the
data step 6 analyses, and it lets a killed loop resume from the last good state.

`Tracker` has six verbs and is the whole contact with Linear and GitHub:
`getBrief`, `setBrief`, `addNote`, `setStage`, `listByStage`, `linkPR`.

### 2.3 State lives in the issue tracker

Linear for work projects. GitHub Issues for personal side projects.

This replaced an earlier proposal to keep state in a folder in the repository. The tracker
gives three things a folder cannot: the record outlives the branch, Eryk reads it on a phone,
and step 6 can query across every past work item to find patterns.

**The seam rule.** If Eryk must judge it, or it must outlive the branch, it goes to the
tracker. If the loop must run it, it stays local.

| Tracker | Local, gitignored |
| --- | --- |
| issue body = the brief: intent, why, success signal | prototype worktrees, deleted after G2 |
| workflow state = the pipeline stage; the gates live here | the loop's cycle log |
| comments = options, decisions, verdicts, PR link, metrics | caches |
| attachments = diagrams, wireframes, screenshots | — |

Rubric files are the exception: they are committed to the project, because they are project
truth and useful to a team.

The loop must post to the issue **only at milestones** — entered the loop, rubric passed,
blocked, done. A two-hundred-cycle machine log would drown the issue.

### 2.4 The state machine and the three gates

```
intent ─[G1]─▶ options ─[G2]─▶ building ─[G3]─▶ merging ─▶ measuring ─▶ done
                                   │                                     │
                                   ▼ three failures on one check          │
                                blocked (posts to the issue, waits)       │
   ▲                                                                      │
   └──────────────────── step 6 opens the next intent ────────────────────┘
```

| Gate | Eryk decides |
| --- | --- |
| G1 | The brief is right. The intent and the success signal are correct. |
| G2 | Which option to build. |
| G3 | The pull request is correct. Approval also permits the merge. |

**The gates are tracker workflow-state transitions.** Eryk approves by moving the issue.
No new approval interface, nothing to catch in a terminal, and it works from a phone. It also
means the pipeline has no hidden state: where a work item stands is a thing you can see.

Linear uses custom workflow states. GitHub Issues uses labels. The adapter hides the
difference.

### 2.5 Options and prototypes

Step 2 always produces **at least two** options. One option turns a decision into a rubber
stamp.

Prototypes are **ephemeral**: a throwaway worktree per option, built and run there, Playwright
screenshots taken, the images and a short trade-off note posted to the issue, then the
worktrees deleted.

The production implementation starts from the brief and the decision, **not from prototype
code** — prototype code carries prototype quality into production, and the rubric would then
have to fight it. One safeguard: the chosen option's diff is attached to the issue as a
`.patch` file. A record, not living code.

Design rules for the option set, from the research: variants must be diverse **along the
dimension in question**, cap the set, attach a short rationale to each, and always offer an
explicit "I do not care" so indifference is not read as a preference.

### 2.6 Rubrics

The rubric is the machine-checkable exit criterion for a stage. It is what lets the loop stop
by itself. "Until it is good" is not a stop condition.

Rubrics are **per project, written once**. Claude drafts them by reading the repository, the
continuous integration workflow, and `package.json`. Eryk corrects them one time. Then the
loop runs without further input. `prototype.md` and `production.md` are separate files with
different bars.

The rubric is the only recurring input the loop needs from a human.

### 2.7 Autonomy

Chosen: **merge on green continuous integration, after G3 approval.**

Two safeguards are required: one command (`pipeline pause`) stops all merging across every
project, and every automatic merge posts its own revert command to the issue as the last note.

This choice is flagged in the decision map as **made with no basis** — see Part 3.

### 2.8 The engine, and how it gets built

It lives in its own repository, `~/Projects/pipeline`, not in `~/.claude`. It is a personal
side project, so it uses GitHub Issues, which means from work item two onward the pipeline
builds itself through the pipeline.

Planned commands:

```
pipeline init      create an issue from a brief
pipeline stage     report where a work item is
pipeline options   build N prototypes, post the decision record
pipeline loop      build → validate → fix, until the rubric passes
pipeline ship      open the pull request from the record
pipeline measure   run the checks, post the results
pipeline pause     stop all merging
```

Day one is four pieces and about one day of work: the `Tracker` adapter, the state machine,
the event log, and `pipeline init`. Each later command is built when the first real feature
needs it. Setup requirement: a Linear API key in the environment.

---

## 3. The finding that matters most: two process failures, observed live

Halfway through the session Eryk named two problems with the conversation itself. Both are the
problems the pipeline is meant to solve, and both happened while designing it.

### Failure 1 — the agent asks for decisions the human has no basis to make

Claude used a structured question tool three times. Eryk declined twice, and the harness
reported that he wanted to clarify. Claude read this as "the questions are unclear". It
actually meant **"I have no basis to answer this"**.

There is measurable evidence inside the failure. The two questions Claude attached a
**concrete preview** to — a command list, and a rubric file — Eryk answered without
hesitation. The abstract ones he declined. **A preview is a small prototype.** That is Eryk's
value 2, demonstrated on himself.

The clearest casualty is the autonomy decision. Eryk picked the most aggressive of three
prose descriptions with no run data to judge against. That decision is now tagged `no basis`
in the map. It is exactly the kind of call the pipeline is supposed to make on evidence.

**The fix, adopted.** Every decision carries one of three tags:

| Tag | Meaning |
| --- | --- |
| **you decide** | Eryk has a basis. Ask him. |
| **I decide** | Reversible. Claude picks and says so. Never ask. |
| **build it first** | Neither party can know by talking. Prototype, then decide. |

The third tag is the one that was missing. Eight cards in the current map carry it. Under the
old design all eight would have been asked as questions.

The engineering version of this is in Part 6: sample several implementations of the same
request, and where they diverge, the requirement is genuinely ambiguous. Ask only about the
fork. That turns alignment from an interview into a measurement.

### Failure 2 — the conversation goes wide and the shape disappears

After four long messages and three research documents, the six original values were buried
under reward hacking, directed acyclic graphs, Ralph loops, and canvas tooling. The derails
were worth having. Reconstructing the high-level picture from them was not possible.

**The diagnosis:** a chat log is append-only. A picture has to be **overwritten** every turn.
That is the difference, and it is why text cannot do this job.

Two sources name the same thing:

- IBIS, 1970: *the map, not the transcript, is the record of what the conversation
  established.*
- Conversation Tree Architecture, 2026: flat append-only chat accumulates all context in one
  unbounded window and topically distinct threads bleed into each other. They call it
  **logical context poisoning**.

The response to this failure is the decision map, Part 5.

---

## 4. Corrections the research forced on the original design

The design in `dev-pipeline-design.md` was written before any research. Six things in it were
wrong or missing.

### 4.1 There was no size router. Largest gap.

Spec-driven overhead scales poorly downward. Böckeler ran Kiro on a small bug fix and received
four user stories and sixteen acceptance criteria. On spec-kit for a mid-size feature, it
generated so much repetitive Markdown that she never finished the implementation.

The original design put **every** work item through a brief, two prototypes, three gates, and a
full rubric. For a one-line null check that is waste.

**Fix, proposed but not yet accepted:** a risk tier chosen at intake decides how many stages
and gates run.

| Tier | Stages | Gates |
| --- | --- | --- |
| `fix` | the loop only. The issue title is the brief. | none |
| `change` | brief → loop → ship | G1, G3 |
| `feature` | all six | G1, G2, G3 |

Where the tier boundaries sit is not knowable by talking. It needs real work items.

### 4.2 The loop must be stateless per pass

The original loop used one long agent context that builds, validates, and fixes. That context
degrades.

The Ralph loop makes the opposite choice, and the argument holds: context windows fill up and
degrade, while the file system and git do not. One fresh agent per pass, given the brief, the
decision, the rubric, and the last failure. It does one unit of work and exits. The repository
is the memory. The only truth is the exit code of an external command.

This is a correction to the engine's shape, not an addition to it.

### 4.3 The rubric is the reward, and a long loop will hack it

This is the most serious problem found.

SpecBench decomposes each task into a specification, **visible** tests that exercise features
in isolation, and **held-out** tests that compose those same features. The gap between the two
pass rates is the reward-hacking gap.

- Every model saturates the visible test suite on every task.
- The gap grows **28 percentage points per tenfold increase in code size**.
- The most common exploit is feature isolation: each feature works alone, and they fail to
  share state.
- The choice of search algorithm matters less than the other factors.

**Fix:** split the rubric. The loop sees only the visible checks. A held-out set runs once, at
the end, before the merge. The agent that writes the tests must not be the agent that writes
the code. Watch composition, not isolated features.

### 4.4 The rubric has two layers, not one

Deterministic checks answer "did it work" by exit code. A graded rubric, scored by a separate
grader agent with per-criterion feedback, answers "is it good". The first version mixed them
into one list.

```
checks:      CI=true pnpm test · pnpm typecheck · pnpm lint
judgements:  every brief item has a test · the screenshot matches the chosen option
```

### 4.5 An overseer, not just a failure counter

The original stop rule was "three failures on the same check". A stronger version exists: a
separate process reads the execution trace in real time and can cancel an agent that stops
making progress or clearly deviates, after at least one warning. The event log already exists,
so this is cheap. It is the real safety control for automatic merging.

### 4.6 Step 6 must write new rubric lines, and check trends

Two additions:

**Self-improvement.** When a bug reaches production, or when Eryk rejects at a gate, step 6
appends a line to the project rubric. The rubric grows from real failures. Without this the
pipeline repeats instead of improving.

**Drift.** A Carnegie Mellon study of 807 projects found the velocity gain gone by month
three, with code analysis warnings up 30% and complexity up 41%. Pass-or-fail gates stay green
while quality drifts. The rubric needs limits on the change against the merge base, not only
exit codes. This matters most because Eryk chose automatic merging.

---

## 5. The decision map: what the prototype tested

Four versions were built in one session. Each failed a specific test, and the failure is the
finding.

| Version | What it tried | What it failed |
| --- | --- | --- |
| `conversation-map.html` | Flat board, cards grouped by pipeline step, colour by status | Everything at one level. Fundamental decisions and small details sat side by side. |
| `decision-map.html` v1 | Fractal levels, four edge types, staleness propagation | Cards were titles only. No proof, no evidence, no reasoning visible. |
| v2 | Proof added, in a side panel | Navigating into a leaf card produced an empty page. The panel was unreachable from the level the proof mattered at. |
| v3 (current) | One view = one node. Full detail on top, sub-cards below. Evidence as its own node kind. | Still hand-authored, no persistence, no live conversation per node. |

### What the prototype proved

1. **Semantic zoom works for this.** The representation changes per level: the root is one
   statement with a rollup bar, level 1 is pillars with their own rollups, level 2 is
   decisions with proof counts. Position tells you where a thing belongs.
2. **One view = one node is the right shape.** Eryk proposed it after v2 failed. The same
   layout renders the root statement, the deepest leaf, and a source page. A leaf shows its
   full content instead of an empty grid. No side panel exists.
3. **Cross-branch dependency propagation is visible and surprising.** Reopening
   *Rubrics are per-project files* marks five cards stale, two of them two hops away and one in
   a different branch. A per-card "is this still valid?" check would have found three and
   missed two.
4. **Evidence as a node pays off immediately.** Of 25 sources, **13 are cited by more than one
   card**. As inline text, that was 13 duplicated blocks that could drift apart.
5. **The two evidence-ish edge types behave differently, and the difference is legible.**
   Disputing a source flags its citers amber for human review. It does not make them stale.
   Only `depends_on` does that.
6. **Proof on the card face changes how it reads.** Every card shows its strongest verbatim
   quote without opening anything.

### What the prototype did not test

- Whether Eryk's own level split differs from Claude's. Claude authored the hierarchy. Eryk
  said it is "not wrong", which is not the same as validated.
- Whether a live per-node conversation is usable. The composer is a disabled stub.
- Anything at all about persistence, multi-session use, or two people.
- Whether this helps during a real work item, rather than during a design conversation.

### The honest weakness

Every quote in the map was written by Claude from memory of the conversation. Nobody can tell
a literal quotation from a paraphrase by looking. The transcript is on disk; the engine should
extract the excerpts with a pointer to the exact message.

---

## 6. The settled data structure

Full schema in `decision-map-structure.md`. The essentials:

### The core claim

**The graph is a projection of an append-only event log.** It is not a stored document.

```
events  (the truth, append-only)  →  fold  →  graph {nodes, edges}  →  render  →  views
```

This is the same substrate as the pipeline engine's event log. The design tool and the
pipeline are **two projections over one log per project**, not two systems.

### Nodes and edges: one list each, both tagged by type

```ts
type Node = { id, kind: "card" | "source" | "excerpt" | "option", ...payload }
type Edge = { from, to, type: "refines" | "depends_on" | "supported_by" | "alternative_to" }
```

`relates_to` is banned. It cannot be acted on.

### Two graphs over the same nodes

| Graph | Shape | Gives |
| --- | --- | --- |
| `refines` | a tree | levels, breadcrumb, rollups, the fractal view |
| `depends_on` | a directed acyclic graph | staleness, the reverse closure |

**Where a card sits is not what a card depends on.** That separation is why reopening one
decision turns cards red in a branch you are not looking at.

### Propagation rules differ per edge type

| Edge | On change of the target |
| --- | --- |
| `depends_on` | **Stale.** Reverse dependency closure, all hops, cost `O(\|S(v)\|)`. |
| `refines` | Children get reviewed, not invalidated. |
| `supported_by` | **Flag one hop.** A human decides whether the card still holds. |
| `alternative_to` | The option becomes live again when the card reopens. |

### Why propagation cannot be a model call

Single-hop validity scoring captures only **6% to 11%** of an invalidation chain, regardless
of chain length, because a single-hop judgement cannot see that an upstream change invalidated
a node two or three hops away.

So the `depends_on` edges must be recorded at creation time. There is no reconstructing them
later. This is a standing discipline cost on the agent, every turn.

### Excerpts carry both the text and the pointer

Eryk asked whether a pointer adds anything if the quote is a literal copy. It does, for five
reasons, and the answer is *and*, not *or*:

1. **You cannot verify that a copy is literal.** That is the whole problem — a paraphrase and
   a quotation look identical on the page.
2. No surrounding context. "How did we arrive here" usually needs the neighbouring messages.
3. Truncation is silent.
4. Reuse duplicates, and duplicates drift.
5. A copy cannot say which session or worktree it came from.

Keep the cached text so the read path is fast and works offline. A deterministic filter runs
at about 2.1 seconds against 16 to 18 seconds for model-based verification.

### Events

```
node.added · node.retitled · node.bodyEdited
edge.added · edge.removed
status.set · reopened · rederived
option.chosen · source.disputed · level.moved
```

Nothing is deleted. A removal is an event. "Mark stale, never delete" stops being a rule and
becomes a property.

Staleness is **derived**, not stored — computed from the latest `reopened` events and what has
been `rederived` since.

History buys four things: "how did we arrive here" becomes a query rather than prose the agent
writes; time travel to any point; data about the pipeline itself for step 6; and replay after
a crash.

### Prototype status against the schema

| Element | State |
| --- | --- |
| `card` nodes, `refines`, `depends_on`, reverse closure | done |
| `source` nodes, `supported_by`, flag-not-stale semantics | done |
| `option` nodes as kept alternatives | done, mutates in place |
| One typed edge list | not done — still a parent field plus arrays |
| `excerpt` nodes with real pointers | not done — quotes are hand-written |
| Event log, history, time travel | not done — no persistence at all |

`decision-map-data.json` is the prototype's data already converted into the target shape:
47 cards, 25 sources, 9 options, 73 excerpts, 191 edges. The excerpt pointers are null,
which is the honest record of the weakness above.

---

## 7. Prior art digest, so nobody researches it twice

### The pipeline exists as a category

| System | Take away | Avoid |
| --- | --- | --- |
| GitHub Spec Kit | Specify → Plan → Tasks → Implement is the common vocabulary | Produces many repetitive Markdown files |
| Kiro (AWS) | "Steering" files are a good model for per-project rubrics | Four user stories for a one-line bug fix |
| Tessl | Two-layer context: process plus library | Full spec-as-source removes code as truth |
| BMAD | Fresh context per phase, versioned artifacts in git | ~3 hours of planning before any code |
| Ralph loop | Statelessness, external truth. See 4.2. | No plan, no gates |
| Copilot cloud agent for Linear | Tracker-as-state is now shipped product. GA 23 July 2026. | Do not rebuild Linear's agent session layer |
| LangChain RubricMiddleware | Reference implementation of the loop exit gate | — |

### The design map exists as three categories

| What Eryk described | Its name | Age |
| --- | --- | --- |
| Decisions, options, and linked evidence in a graph | **IBIS**, practised as **Dialogue Mapping** | 1970 |
| Fractal levels, representation changing per level | **Semantic zoom** | 1990s |
| A conversation scoped to each node | **Loom**, formalised 2026 as Conversation Tree Architecture | 2021 / 2026 |
| Change a decision, propagate the change | **Truth Maintenance System** | 1979 |

The field name is **design rationale**. The surviving practical descendant is the
Architecture Decision Record: flat files, no hierarchy, no evidence links, no propagation.

**Three real gaps.** No design-rationale tool exists for software engineering in 2026 — the
agent work targets deliberation, brainstorming, and clinical diagnosis. No tool does true
semantic zoom in a nested board; Tana's zoom is navigational. And no mainstream language-model
interface lets a user manage context hierarchically.

**No paper was found** linking diagrammatic representations of agent progress to measured
effects on developer cognition. On the visual axis there is no state of the art to catch up
with.

### One design warning to carry forward

Krakauer's distinction, cited in the sensemaking research: a **complementary** cognitive
artifact coaches the user toward holding the mental model themselves. A **competitive** one
performs the task and transfers no skill.

Eryk's contribution to this pipeline is judgement. If the tool starts deciding, it removes the
thing he brings.

### The numbers worth remembering

| Finding | Number |
| --- | --- |
| Reward-hacking gap growth with code size | +28 percentage points per 10× |
| Single-hop staleness recall | 6–11% of the chain |
| Agent accuracy at eliciting a preference after 5 turns | ≤ 56% |
| ClarifyGPT ambiguity sampling, GPT-4 pass@1 | 70.96% → 80.80% |
| Scoped context per node, token reduction | up to 82% |
| Code warnings / complexity after agent adoption, 807 projects | +30% / +41%, velocity gain gone by month 3 |
| Ralph loop, one unattended compiler build | ~$297 |

---

## 8. Status board

### Decided

- State lives in the issue tracker; Linear for work, GitHub Issues for personal.
- The seam: judgement and durability to the tracker, execution stays local.
- Six stages, three gates; the gates are tracker state transitions.
- The result must become a standalone product; logic in a program, Markdown holds prompts.
- An append-only event log is the spine; four interfaces and nothing else touches outside.
- Build the engine now, thin, and grow it per work item.
- Rubrics are per-project files, written once.
- Prototypes are ephemeral; images on the issue are the decision record.
- Never show one option.
- Merge on green continuous integration after G3 — **flagged as decided with no basis**.
- The decision map: one view = one node; evidence is a node; four edge types; the map is
  overwritten, not appended.

### Open, and who should decide

| Item | Who |
| --- | --- |
| **Which project and which feature go first** — this blocks the build | Eryk |
| Which live metrics feed step 6 (PostHog, Sentry, CI timings, the event log) | Eryk |
| Tracker adapter: Linear's agent-session API, or plain comments | Claude |
| `pipeline pause` and the posted revert command | Claude |
| Two-layer rubric, the overseer, trend checks | Claude |
| Step 6 writing new rubric lines | Claude |
| Propose diffs to the brief rather than rewrites | Claude |
| A growing decision profile — how Eryk decides, not what to build | Claude |
| Extracting quotes from the session file instead of writing them | Claude |
| Keeping the tool complementary, not competitive | Claude |
| Where the plan files live: `plans/` is gitignored | Eryk |

### Needs a prototype before anyone decides

- The risk tier router, and where its boundaries sit.
- The stateless loop, in a real repository.
- Splitting the rubric into visible and held-out checks.
- Sampling implementations to find ambiguity.
- Whether side-by-side options at G2 actually let Eryk decide fast.
- Who creates the levels in the map, and whether Claude's split matches Eryk's thinking.
- What the visual layer finally is.

---

## 9. Where to pick it up

The blocking item has not moved for five messages: **name the first project and the first
real feature or bug.** A small one, in a repository whose tests already pass.

With that named, the sequence is:

1. Create `~/Projects/pipeline` and build the day-one skeleton. About one day.
2. Draft `prototype.md` and `production.md` rubrics for the chosen project, from its
   repository, its continuous integration workflow, and its `package.json`. Eryk corrects them
   once.
3. Run one real work item end to end, with Claude filling gaps by hand wherever the command
   line interface is still missing. That run tells us what to build next.
4. From work item three, the pipeline runs itself.

Expect the loop to be genuinely hands-off after about five work items in a given project. The
first two teach the rubric.

**One recommendation for whoever continues.** The single highest-value engineering change is
the ambiguity-sampling step from Part 3: sample several implementations, find where they
diverge, ask only about the divergence. It fixes the "asks me to decide things I am unsure
about" complaint, and it produces the option set for G2 as a side effect, from real ambiguity
rather than invented contrast. It is roughly fifty lines of engine code.
