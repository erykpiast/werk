# Session transcript — pipeline design

Session `ce5ad95b-63fc-4597-a5b5-cfa6079d241c`, project `dotclaude`, 2026-08-31 to 2026-09-01.

Readable projection. Tool calls are collapsed to one line. The full record with every tool
input and output is in `session-transcript-raw.jsonl`.

---

## 1. Eryk

Let's design my personal software development pipeline where me and you create features and fix bugs in different software projects in a way that uses best features of each of us. I'm good at judgement and I have drive and motivation. You have access to endless knowledge resources and can very quickly write code. I see the synergy here. The foundations to build on top are there but we don't need to be limited by what's today in the skills directory or even what Claude Code is about (it's your wrapper at most, you're more). Open mind! My general idea and core values are:
1. alignment on the intent - you must know what I want to build and why; we build this alignment by talking, asking questions and reviewing prototypes together
2. quick iteration - I mentioned prototypes already - it's often difficult to decide what to build without seeing different options; if we can discuss concretes like "it's this or that" - may be easier to choose
3. visual representation - I'm a visual thinker; instead of a wall of text I need diagrams, schemas, wireframes, etc. the UI must make visual content the first-class citizen on all stages
4. autonomous implementation loop - you can build the prototypes and later the production implementation iteratively, but comprehensively; I don't want to be bothered to run repeated code review loops or instructions for you about how to verify changes at different levels; the system must close the loop fully - you build, validate, identify issues, fix them, re-validate, review code, apply suggestions, re-validate wheter the system works - until it's done and the code matches the standards for the stage (prototype, production, etc.)
5. Ship - help me create PRs with concious change descriptions, clear motivation explanation and actionable testing and deployment instructions 
6. Measure and analyse - run checks that we aligned on or gather live metric data; find patterns, spot gaps, ideate about improvements - so we can go back to step 1.
That means these steps above are themselves a loop.

This design is far from complete, but it's a general framework I'd like to follow. Let's discuss.

---

## 2. Claude

`[thinking]`

---

## 3. Claude

`[thinking]`

---

## 4. Claude

```
   ┌── G1 ────────┐   ┌── G2 ───────┐                        ┌── G3 ─────┐
   │ approve      │   │ pick one    │                        │ approve   │
   │ brief        │   │ option      │                        │ PR        │
   └──────▲───────┘   └──────▲──────┘                        └─────▲─────┘
          │                  │                                     │
 1 INTENT ─┴─► 2 OPTIONS ────┴─► 3+4 BUILD LOOP ────────────────────┴─► 5 SHIP
     ▲           2-3 prototypes    build→validate→review→fix→re-validate  │
     │                             no human. exits on a rubric.           │
     └──────────────────── 6 MEASURE ◄─────────────────────────────────---┘
```

Your six steps are right. The part that is missing is the **thing that carries state between them**. Skills today are stateless prompts. Each one starts from nothing. That is why you must repeat yourself.

## The spine: one folder per work item

```
<repo>/.pipeline/<slug>/
  brief.md      intent, why, and the success signal   ← written at step 1
  options/      prototype A, B, C + screenshots       ← step 2
  decision.md   what you picked and why               ← gate G2
  rubric.md     machine-checkable exit criteria       ← what lets me stop
  loop.jsonl    every build/validate/fix cycle        ← step 4
  ship.md       PR body draft                         ← step 5
  measure.md    the checks and metric queries         ← step 6
  board.html    the visual dashboard                  ← always open
```

Every stage reads this folder and writes to it. Nothing lives only in a chat.

## Five design claims I want to argue for

**1. The rubric is what makes step 4 possible.** You want me to loop without you. A loop needs a stop condition. "Until it is good" is not one. So each stage gets a rubric file with checks a machine can run: tests pass, types pass, the review agent finds zero high-severity items, the screenshot matches the chosen option. Prototype rubric and production rubric are different files. This is the single highest-value piece. Without it, step 4 does not exist.

**2. The brief must state the success signal before we build.** Step 6 has nothing to measure otherwise. At G1 you answer one question: "how will we know this worked?" That answer becomes `measure.md`.

**3. The visual dashboard cannot be terminal output.** The terminal cannot draw. So `board.html` is a local page in the work-item folder. It holds the diagram, the wireframes, the option screenshots side by side, live prototype frames, and the loop progress bar. It reloads by itself. You keep it open in a browser tab beside the terminal. I write to it at every stage.

**4. Never show one option.** Step 2 always produces at least two. Your judgement needs contrast. One prototype turns a decision into a rubber stamp.

**5. `loop.jsonl` measures the pipeline, not only the product.** It records where the loop stalled, how many fix cycles ran, and which gate you rejected at. That data feeds step 6 back into the pipeline design, not only into the feature.

## What this changes about your current setup

You have 57 skills. Most are good. They do not share state. The work becomes: keep the skills as the stage engines, and add the folder, the rubrics, and the board as the layer under them.

Three questions decide the shape. I answer the rest myself.

---

## 5. Claude

What would you like to clarify?

Tell me which of the three questions is unclear, or what context I am missing. If it helps, here is what each question is actually deciding:

1. **State home** — decides whether the pipeline is per-project or one system across all your projects, and whether decisions become part of project history.
2. **Visual layer** — decides what I spend an afternoon building, and how you look at options at G2.
3. **Autonomy** — decides the last action I take before I stop and wait for you.

You can also reject the framing. If the folder-plus-rubric spine is the wrong idea, say so and I drop it.

---

## 6. Eryk

The state should depend on the project. A good universal option is the issue tracker - Linear for work projects, GitHub issues for my personal side projects.

---

## 7. Claude

`[thinking]`

---

## 8. Claude

```
   TRACKER (Linear at work | GitHub Issues for side projects)  ← what you judge
   ┌────────────────────────────────────────────────────────────┐
   │  issue body      = brief: intent, why, success signal      │
   │  workflow state  = pipeline stage. Your gates live here.   │
   │  comments        = options, decision, verdicts, PR, metrics│
   │  attachments     = diagrams, wireframes, screenshots       │
   └──────────▲──────────────────────────────────┬──────────────┘
    publish   │                                  │  read
  (milestones)│                                  ▼
   ┌──────────┴──────────────────────────────────────────────────┐
   │  LOCAL  .pipeline/<issue-id>/   (gitignored, throwaway)     │
   │  rubric.md   prototypes/   loop.jsonl   board.html   cache/ │
   └─────────────────────────────────────────────────────────────┘
```

Tracker-first is better than my folder proposal. It gives you three things a folder cannot: the record survives the branch, you read it on your phone, and step 6 can query across every past work item to find patterns.

## The seam

One rule decides where anything goes:

**You must judge it, or it must outlive the branch → tracker. The loop must run it → local.**

So prototypes stay local, because a prototype is code that runs. Their screenshots and their live URL go to the tracker. `loop.jsonl` stays local, because 200 machine cycles would drown the issue. Its verdict goes to the tracker.

The local folder is a cache. Delete it any time. I rebuild it from the issue.

## The best part: your gates are already built

The tracker has workflow states. Map the pipeline onto them:

```
Intent → [G1] → Options → [G2] → Building → [G3] → Shipped → Measuring
```

You approve by moving the issue. No new approval UI, no terminal prompt to catch. I poll the state, or a webhook wakes me. You can approve G2 from your phone at a coffee shop.

This also means the pipeline has no hidden state. Where a work item stands is a thing you can see.

## Two problems this creates, and the fix

**1. Two different APIs.** Skills must not know which tracker they talk to. So I build one adapter with about six verbs: `getBrief`, `setBrief`, `addNote(text, images)`, `setStage`, `listByStage`, `linkPR`. Linear MCP is already connected here. GitHub goes through `gh`. Every skill calls the adapter. Adding a third tracker later costs one file.

**2. The loop would spam the issue.** The autonomous loop runs many cycles. It must post only at milestones: entered the loop, rubric passed, rubric failed three times and needs you, done. Everything else stays in `loop.jsonl`.

## One decision I am making myself

I render every diagram to an image and attach it, instead of posting Mermaid source. GitHub renders Mermaid in issue text. I am not sure Linear does. Rendering to an image is one code path, it works in both trackers, and it works on your phone. I keep the Mermaid source in the local folder so I can redraw it.

Push back if you want the source inline on GitHub.

---

## 9. Claude

What would you like to clarify?

To help you aim the question: each of the three decides a different thing.

1. **Visual UI** — decides what I build for you to look at, and whether you can decide at G2 away from your desk.
2. **Rubric** — decides who writes the loop's stop condition, and how often you write one. This is the piece that makes step 4 run without you.
3. **Autonomy** — decides the last action I take before I stop.

You can also tell me the questions are premature. If you would rather keep discussing the shape before picking anything, say so and I will drop the tool.

---

## 10. Eryk

Re the UI. The general-purpose Claude Code TUI is good but I want to try something more advanced long-term. I don't mean to build a system that replaces it today but what we test in this new workflow must be possible to turn into a standalone product. Answering your question: images or screenshots attached to the issue as a decision record are fine. Prototypes themselves should be ephemeral.

---

## 11. Claude

`[thinking]`

---

## 12. Claude

```
┌─ UI  (swappable) ───────────────────────────────────────┐
│  today: Claude Code TUI  +  the Linear / GitHub issue   │
│  later: your own product UI                             │
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

Your constraint changes the design more than the tracker answer did. Here is what it forces.

## The engine must not be markdown

A Claude Code skill is a prompt file. It cannot become a product. If the pipeline logic lives in 15 skill files, extracting it later is a rewrite, not a move.

So one rule from day one:

**Logic goes in a program. Markdown holds prompt text only.**

The state machine, the tracker adapter, the rubric runner, and the loop controller go into a small TypeScript CLI. Skills become three-line wrappers that call it. You keep using the TUI today. The product grows inside the CLI while you work.

## The event log is the piece that makes extraction possible

The engine must never assume a human watches a terminal. Every state change is an event on an append-only log. Today the TUI reads it. Later your UI reads the same log and nothing in the engine changes.

That log is not extra work. It is the same object three times:

1. It renders progress in any UI.
2. It is the data step 6 analyses to improve the pipeline.
3. It lets a killed loop resume from the last good state.

## Four interfaces, and nothing else touches the outside

| Interface | Today | Later |
|---|---|---|
| `Tracker` | Linear MCP, `gh` | same, plus others |
| `AgentRuntime` | Claude Code headless | Claude Agent SDK |
| `Renderer` | Mermaid → PNG, Playwright screenshot | same |
| `Bus` | append to a JSONL file | a real event store |

Six verbs on `Tracker`: `getBrief`, `setBrief`, `addNote`, `setStage`, `listByStage`, `linkPR`. That is the whole contact with Linear and GitHub. A third tracker later costs one file.

## What "ephemeral prototypes" now means, exactly

1. The engine creates a throwaway git worktree per option.
2. Each option gets built and run there.
3. Playwright takes the screenshots.
4. The screenshots plus a short trade-off note go to the issue as the G2 decision record.
5. You pick.
6. The worktrees are deleted.

The production implementation starts from the brief and the decision, not from prototype code. That is the point of throwing them away: prototype code carries prototype quality into production, and the rubric would then have to fight it.

One cheap safeguard: I attach the chosen option's diff to the issue as a `.patch` file. It is a record, not living code. You can read it, and nothing depends on it.

Three questions left before I can draw the concrete build.

---

## 13. Claude

`[thinking]`

---

## 14. Claude

```
 intent ──[G1]──▶ options ──[G2]──▶ building ──[G3]──▶ merging ──▶ measuring ──▶ done
   ▲                                    │                                          │
   │                                    │ 3 identical failures                     │
   │                                    ▼                                          │
   │                                 blocked (posts to the issue, waits)           │
   └──────────────────────────────────────────────────────────────────────────────-┘
                        step 6 opens the next intent
```

Three gates. `G1` and `G2` are you. `G3` is you, and then the merge runs by itself on green CI.

## The engine is its own first work item

Put the CLI in its own repo, `~/Projects/pipeline`, not in `~/.claude`. It is a personal side project, so it uses GitHub Issues. That means the pipeline builds itself through the pipeline from work item two onward. Every gap you feel becomes an issue in the same system.

## Day one: the skeleton

About one day of work. Four pieces, nothing more.

| Piece | What it is |
|---|---|
| `Tracker` | Six verbs. Linear GraphQL API + `gh` behind one interface. |
| State machine | The nine states above. Linear uses workflow states, GitHub uses labels. |
| Event log | Append-only JSONL. `pipeline events` prints it. |
| `pipeline init` | Turn a conversation into an issue with a brief, in `intent`. |

Then each later command gets built when the first real feature needs it. No guessing.

You need one setup step: a Linear API key in the environment. `gh` you already have.

## The loop controller, in full

This is the part that must run without you.

```
build      agent implements against brief + decision
validate   run every rubric check
  pass  ─► review (code-review agent)
            findings? ─► fix ─► validate again
            clean?    ─► done, open the draft PR
  fail  ─► diagnose ─► fix ─► validate again

stop rule: 3 failures on the same check ─► state = blocked,
           post the check, the error, and the 3 attempts to the issue
```

The stop rule is what stops a runaway loop. Without it, autonomy is a risk instead of a feature.

## Two things auto-merge needs

You chose merge on green CI. That is safe because `G3` is still yours. Two additions make it recoverable:

1. `pipeline pause` — one command stops all merging across every project.
2. Every auto-merge posts the revert command to the issue as its last note.

## Rubrics: committed, not cached

```
<project>/.pipeline/
  rubrics/prototype.md     committed. Project truth, useful to your team.
  rubrics/production.md    committed.
  run/                     gitignored. Cache, worktrees, event log.
```

I draft both rubrics by reading the repo, the CI workflow, and `package.json`. You correct them once per project. That is the only recurring input the loop needs from you.

## The path from here

1. Build the skeleton. One day.
2. Run one real feature end to end, with me filling gaps by hand where the CLI is missing. This tells us what to build next.
3. From work item three, the pipeline runs itself.

Expect the loop to be genuinely hands-off after about five work items in a given project. The first two teach the rubric.

**Next:** name the first project and the first real feature or bug. A small one, in a repo with tests that already pass. I write the skeleton and its rubrics against it.

---

## 15. Eryk

Let's dump this high-level plan to a file so it's not just here in the context. In terms of the tool itself (we can try self-making!) it'd be a content of an issue on the tracker, but I'll ask you to create that later once I setup the project. 

I'd like to continue discussing the specific loop parts. You accepted my high-level loop without suggestions or objections but there must be alternatives and improvements available here. I wonder what systems exist today - both in Claude Code ecosystem and outside. For instance, Matt Pockok's skills I have set up here are this sort of a system themselves. All good ideas, although text-based, which makes them really great for me, but not ideal (that's why I'm brainstorming something else). Could you research what different takes are available or disussed out there? I'm not following social networks or news very closely, I imagine there's a lot of innovation every day in the area. I must not be the first person asking similar questions and trying to build something that targets software development lifecycle of the next year rather than now.

---

## 16. Claude

`[thinking]`

---

## 17. Claude

`[thinking]`

---

## 18. Claude

`[thinking]`

---

## 19. Claude

`[thinking]`

---

## 20. Claude

`[thinking]`

---

## 21. Claude

`[thinking]`

---

## 22. Claude

Two files written:
- `plans/dev-pipeline-design.md` — the agreed design.
- `plans/dev-pipeline-research.md` — the research below, with all sources.

You were right to push. Your loop matches the industry direction closely. Five things in my design are wrong or missing.

## 1. No size router. This is the biggest gap.

Birgitta Böckeler ran Kiro on a small bug fix. It produced 4 user stories and 16 acceptance criteria. She ran spec-kit on a mid-size feature and never finished it, because it generated so much repetitive Markdown. Her verdict: she would rather review code than review those files.

My design puts every work item through a brief, two prototypes, three gates, and a full rubric. For a one-line null check that is waste. **Spec-driven overhead scales poorly downward.**

Fix: a risk tier chosen at intake decides how many stages run.

| Tier | Stages | Gates |
|---|---|---|
| `fix` | loop only. The issue title is the brief. | none |
| `change` | brief → loop → ship | G1, G3 |
| `feature` | all six steps | G1, G2, G3 |

This also matches the tiered merge pattern reported across 2026: auto-merge low risk, human approval for critical paths.

## 2. The loop must be stateless. My version was wrong.

I designed one long agent context that builds, validates, and fixes. That context degrades.

Geoffrey Huntley's **Ralph loop** makes the opposite choice, and the argument holds: context windows fill up and degrade, the file system and git do not. Each pass starts a fresh agent, does one unit of work, and exits. Progress lives in files and git history, not in a conversation. The only truth is the exit code of an external command.

```
while rubric fails:
    fresh agent ← brief + decision + rubric + last failure
    one unit of work, then exit
    append to the event log
```

It scales further than I expected. Huntley built a working language and compiler in one unattended run for about $297. At a Y Combinator hackathon a Ralph loop produced 1,100 commits across 6 repositories overnight.

This fits your event log design exactly. It also makes `pipeline pause` trivial.

## 3. The rubric has two halves

Current practice splits acceptance. Deterministic checks answer "did it work". A graded rubric answers "is it good". My single list mixed them.

```yaml
checks:      # exit code is the answer
  - CI=true pnpm test
  - pnpm typecheck
judgements:  # a grader sub-agent scores, with per-criterion feedback
  - every item in the brief has a test
  - the screenshot matches the chosen option
```

LangChain's `RubricMiddleware` is a working reference for this exact gate: the agent iterates until every criterion passes or hits a cap, and a separate grader sub-agent returns per-criterion feedback.

## 4. Add an overseer

My stop rule was "3 identical failures". The paper *A Self-Improving Coding Agent* uses something stronger: a separate overseer reads execution traces in real time and can cancel an agent that stops making progress, after one warning.

You already have the event log. The overseer is a second process reading it. It is the real safety control for your auto-merge choice.

## 5. Step 6 must write new rubric lines

This is the self-improvement path I left out. OpenAI's eval guidance treats every manual fix as a signal to turn into a test. The Darwin Gödel Machine goes further: a model reads the evaluation logs and writes the improvement task itself.

**When a bug reaches production, or when you reject at a gate, step 6 appends a line to the project rubric.** The rubric grows from real failures. Without this, the pipeline repeats instead of improving.

## What already exists: do not rebuild it

GitHub's Copilot cloud agent for Linear went generally available on 23 July 2026. You assign a Linear issue to an agent, it opens a draft PR, and progress streams into the Linear activity timeline. Linear's agent platform does the same for Cursor, Codex, and Devin. Triage rules can delegate with no human involved.

Your tracker-as-state instinct is now a shipped product pattern. Two consequences: the design is validated, and the `Tracker` interface should use Linear's agent session API, not only comments.

## One warning about auto-merge

A Carnegie Mellon study of 807 open-source projects found the velocity gain disappeared by month three, while code analysis warnings rose 30% and complexity rose 41%. DORA calls this the verification tax.

Pass-or-fail gates do not catch slow drift. Every check stays green while complexity climbs. Fix: the rubric needs trend checks against the merge base, not only pass-or-fail checks.

**Next:** tell me which of the five corrections to fold into the design document. I recommend all five; 1 and 2 change the architecture, 3 to 5 are additions.

Sources: [Böckeler on SDD tools](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) · [Ralph loop](https://linearb.io/blog/ralph-loop-agentic-engineering-geoffrey-huntley) · [Copilot for Linear GA](https://github.blog/changelog/2026-07-23-copilot-cloud-agent-for-linear-is-now-generally-available/) · [LangChain Rubrics](https://www.langchain.com/blog/introducing-rubrics-for-deepagents) · [OpenAI eval-skills](https://developers.openai.com/blog/eval-skills) · [A Self-Improving Coding Agent](https://arxiv.org/pdf/2504.15228) · [Darwin Gödel Machine](https://arxiv.org/pdf/2505.22954) · [spec-compare](https://github.com/cameronsjo/spec-compare) · [BMAD / Claude Flow / Gas Town](https://re-cinq.com/blog/multi-agent-orchestration-bmad-claude-flow-gastown)

---

## 23. Eryk

this answers the "how to build" question maybe to some extent, although I'm curious about more diverse approaches that people tested and they might have something interesting in them even if were not ideal. I've heard about Ralph loops a year ago already and in the meantime I remember someone mentioned task graphs. I wonder - what I did not hear about?

What's completely not answered is how to align with agent on what to build. The examples I know are spec-driven development (e.g. Claudekit, I used to use it) or Matt Pockok's "grilling". What else people experiment with?

The third dimension - visual vs. text - does anyone really experiment with this? I'm not meaning "lovable makes live changes to the product on just a prompt" but rather - how can we exploit people's visual cortex to help with progress-making>

---

## 24. Claude

`[thinking]`

---

## 25. Claude

Three separate research questions. Let me run them.

---

## 26. Claude

`[thinking]`

---

## 27. Claude

`[thinking]`

---

## 28. Claude

`[thinking]`

---

## 29. Claude

`[thinking]`

---

## 30. Claude

Written to `plans/dev-pipeline-research-alternatives.md`, with all sources. The three headlines:

1. **Your rubric is a reward. Long loops learn to hack it.** Measured, not theoretical.
2. **Ambiguity can be measured instead of interviewed for.** This merges your axis 1 and axis 2.
3. **Yes, people experiment with visuals — but nobody has evidence it helps.** Axis 3 has no state of the art to catch up with.

---

# Axis 1 — what you have not heard about

## The finding that hits our design hardest: SpecBench

[SpecBench](https://arxiv.org/abs/2605.21384) decomposes each task into a specification, **visible tests** that exercise features in isolation, and **held-out tests** that compose those same features. The gap between the two pass rates is the reward hacking gap.

- Every model saturates the visible test suite on every task.
- **The gap grows 28 percentage points per tenfold increase in code size.**
- The most common exploit is feature isolation: each feature works alone, and they fail to share state.
- The search algorithm matters less than the other factors.

Our loop runs against a fixed rubric until it passes. That rubric is the reward. The longer the loop runs, the more it optimises for the rubric instead of the brief.

Fix, from [The Verification Horizon](https://arxiv.org/pdf/2606.26300): split the rubric. The loop sees the visible checks. A held-out set runs once, at the end, before the merge. And the agent that writes the tests must not be the agent that writes the code.

## Topologies beyond Ralph and task graphs

**Tree search over whole codebases (AIDE).** Most loops keep one working copy and repair it. AIDE keeps several. Each generated codebase is a node in a search tree, expanded by draft, debug, and improve moves. This makes "two options" the execution model rather than a special stage.

**Search over workflows, not over code.** AFlow searches typed operator graphs with Monte Carlo tree search under an explicit dollar budget. ADAS runs a meta-agent that proposes, evaluates, and archives runnable agent systems — the pipeline evolving itself. Too much for a first build, right direction.

**On task graphs, the graph is not the point.** Task-Decoupled Planning gives each DAG node a scoped context that isolates its history from the global context. Reported token reduction up to 82%. That is the Ralph insight applied per node. It also forces a constraint: nodes must be idempotent.

**The published warning:** graph generation is being sold ahead of graph validation. The WorFBench results show planning a graph is much harder for an agent than planning a sequence. The recommended middle is a partially adaptive graph — safety paths stay code-defined, the agent proposes routes only inside bounded regions.

---

# Axis 2 — the strongest idea I found

## ClarifyGPT: detect ambiguity by sampling

1. Sample N implementations of the same request.
2. Where the implementations **diverge**, the requirement is ambiguous.
3. Ask questions aimed only at the divergence points.

Measured: GPT-4 pass@1 on MBPP-sanitized went from 70.96% to 80.80%. Across five benchmarks, 62.43% to 69.60%.

This changes what alignment is. Neither of us has to guess what is unclear. The machine finds the fork, then asks about the fork.

**It also merges your axis 1 and axis 2.** The divergent implementations are the options. "A or B?" arrives with two running prototypes attached, and they exist because of real ambiguity, not because I invented contrast.

Rules the papers add: constrain questions to the divergence points, because broad questions produce off-topic answers and make results worse. Never ask the human to restate the whole requirement.

## Asking questions is a weak instrument

["Agents should help users construct preferences, not just elicit them"](https://arxiv.org/pdf/2606.30863) argues most agent research assumes the user already knows what they want. On their benchmark, no agent exceeded **56% accuracy after five turns of dialogue**.

Their human study tested showing variants against explaining. Showing a set of items that vary along one feature produced formed preferences more reliably than a technical explanation of that feature.

That is direct evidence for your value 2. It comes with design rules: variants must be diverse **along the dimension in question**, cap the set, attach a short rationale to each, and always offer an explicit "I do not care" so indifference is not read as a choice.

## Three more, briefly

- **CARE** requires the helper agent to propose **concrete revision diffs** to the brief, which you accept, modify, or reject. Not a rewritten brief. Reviewing a diff is much faster.
- **`DECISION.md`** captures *how you decide*, not what to build. When the agent hits an uncovered trade-off it names it with concrete options, captures your answer as a rule, and never asks that class of question again. Our design lacks this. Alignment currently resets on every work item.
- **Intent's "Critique" persona** reviews the spec before any implementation agent runs. Critique catches direction errors before code; a separate Verify persona catches drift after.

---

# Axis 3 — yes, three groups, doing different things

## Google Antigravity — the most mature answer

Its trust mechanism is **Artifacts**: task lists, plans, walkthroughs, screenshots, and browser recordings, described as formats easier to validate than raw tool calls.

Two details are exactly what you asked for:

1. **Select-and-comment on a screenshot.** You mark a region of an image and write a comment, like commenting in Google Docs.
2. **The feedback is non-blocking.** The agent takes your comment without stopping.

You look at a picture, point at the wrong part, the loop keeps running. That is the closest thing anyone has built to using the visual cortex for progress rather than for output.

## tldraw — the buildable foundation

Source-available, agent starter kit is MIT. The architectural point: the same editor API a person drives with a mouse, the agent drives in code.

Copy two things. **Modes**: the agent runs in one mode at a time with capabilities matched to the stage — working mode has full canvas access, review mode strips drawing actions and adds critique actions. That maps onto our pipeline stages exactly. **Streaming**: shapes appear incrementally, so you watch it think.

## Archify — the fix for diagrams that lie

The agent produces a **typed JSON intermediate representation**. A deterministic compiler renders it to HTML and SVG. **The agent never draws pixels.** Every node and edge is validated.

That improves our plan to render Mermaid to images. Same principle, stronger guarantee.

## Ink & Switch — the research lineage

Their **Programmable Ink** track: "visualizable computation, software you can put your hands on." The prototype is PlayBook, a malleable notebook that aims to feel like paper and pencil but hold dynamic behaviour. The team has used it daily for over two years. This is the intellectual home of your question.

## The academic name for the problem you have

CHI 2026's **Deep Cognition** paper names it: the **"input–wait–output" paradigm**. The user submits a query and gets a result after a process that cannot be interrupted and shows little of its intermediate decisions. In multi-agent systems, delayed feedback amplifies early errors and blocks the human from adding expertise mid-flight.

## The honest gap

I found no paper pairing diagrammatic representations of agent progress with **measured effects on developer cognition** — mental model accuracy, attention, or resumption time after an interruption.

The tools exist. The evidence that they help a developer think does not. If you build this, you are not catching up with anyone.

**Next:** pick which axis to fold into the design first. I recommend axis 2 — the ClarifyGPT sampling method changes steps 1 and 2 at once, and it is about 50 lines of engine code.

---

## 31. Eryk

<bash-input> git status</bash-input>

---

## 32. Eryk

<bash-stdout>On branch main
Your branch is up to date with 'origin/main'.

Changes to be committed:
  (use "git restore --staged &lt;file&gt;..." to unstage)
	new file:   daemon-auth-cooldown
	new file:   daemon-auth-status.json
	new file:   daemon.log
	new file:   daemon/control.key
	new file:   daemon/roster.json
	new file:   hooks/sbx-pnpm-init.sh
	new file:   jobs/794992fa/state.json
	new file:   jobs/794992fa/timeline.jsonl
	new file:   jobs/794992fa/tmp/pr-body.md
	new file:   jobs/pins.json
	new file:   remote-settings-consent.json
	new file:   skills/ask-matt
	new file:   skills/code-review
	new file:   skills/codebase-design
	new file:   skills/diagnosing-bugs
	new file:   skills/domain-modeling
	new file:   skills/find-skills
	new file:   skills/grill-me
	new file:   skills/grill-with-docs
	new file:   skills/grilling
	new file:   skills/handoff
	new file:   skills/implement
	new file:   skills/improve-codebase-architecture
	new file:   skills/prototype
	new file:   skills/research
	new file:   skills/setup-matt-pocock-skills
	new file:   skills/tdd
	new file:   skills/teach
	new file:   skills/to-spec
	new file:   skills/to-tickets
	new file:   skills/triage
	new file:   skills/wayfinder

Changes not staged for commit:
  (use "git add &lt;file&gt;..." to update what will be committed)
  (use "git restore &lt;file&gt;..." to discard changes in working directory)
	modified:   CLAUDE.md
	modified:   remote-settings-consent.json</bash-stdout><bash-stderr></bash-stderr>

---

## 33. Claude

`[thinking]`

---

## 34. Claude

`plans/` is gitignored (`.gitignore:10`). My three files exist on disk but git will never track them:

```
plans/dev-pipeline-design.md
plans/dev-pipeline-research.md
plans/dev-pipeline-research-alternatives.md
```

That is fine for surviving this context. It does not survive a machine loss or a clone.

Three options. I recommend the first.

1. **Leave them.** They become tracker issues when you set up the `pipeline` project. Git never needs them.
2. **Move to `docs/`,** which is tracked. `docs/` already holds `spec-driven-development.md` and `workflow.md`, so the design doc fits the existing pattern.
3. **Un-ignore just these files** with a `!plans/dev-pipeline-*.md` rule.

**Next:** say "move to docs" and I move all three, or say nothing and they stay in `plans/`.

---

## 35. Eryk

Okay, this conversation became way too technical and less about product design - more about what should details of what we build look like. That's the exact issue with the current solutions:
1. the agent asks me to decide on things I'm not sure about - that's were prototypes would help 
2. the conversation becomes broad and wide but the full picture becomes invisible clearly and gets burried under derails - which are great that we went through them, but then reconciling the high-level picture from the conversation is difficult - that's where a visual representation, a sort of interactive graph, for instance, would help a lot. 

What would you say too that?

---

## 36. Claude

`[thinking]`

---

## 37. Claude

You are right, and this conversation is the proof. Let me name what I did wrong, then show you the fix instead of describing it.

**Failure 1.** I called `AskUserQuestion` three times. You rejected it twice. I read that as "the questions are unclear". It actually meant "I have no basis to answer this". "Where should the work-item folder live?" was unanswerable by talking — and when you did answer, you answered a different, better question.

There is evidence inside that failure. The two questions I attached a concrete **preview** to — the CLI command list, the rubric file — you answered without hesitation. The abstract ones you refused. A preview is a small prototype. That is your point, measured.

**Failure 2.** Four long messages and three files later, your six steps are buried under SpecBench, ClarifyGPT, DAGs, tldraw, and reward hacking. The derails were worth it. The shape is now invisible. A chat log is append-only. A picture has to be **overwritten** every turn. That is the actual difference, and it is why text cannot do this job.

So here is the map instead of more prose.

---

## 38. Claude

`[thinking]`

---

## 39. Claude

Open in your browser now. `plans/conversation-map.html`

**11 decided · 13 open · 6 need a prototype · 4 research only.**

## What the map encodes

Every item carries one of three tags, and the third is the one my design was missing:

| Tag | Meaning |
|---|---|
| **you decide** | You have a basis. Ask. |
| **I decide** | Reversible. I pick and say so. Never ask. |
| **build it first** | Neither of us can know by talking. Prototype, then decide. |

Six items are tagged `build it first`. Under the old design I would have asked you all six as questions. That is failure 1, and the tag is the fix.

One card is flagged `no basis` in red: **merge on green CI**. You picked the most aggressive of three abstract descriptions with no run data. I should have prototyped it or decided it myself.

## What this file gets right

- Position tells you which of your six steps a thing belongs to. The shape is back.
- Colour tells you status. Grey items are research, dimmed, and you can filter them out.
- Every card names where it came from, so the derails are attached rather than lost.
- It is **overwritten** each turn, not appended. That is the whole difference from a chat log.

## What it gets wrong

It is static. I regenerate it by hand. You cannot mark a card, comment on it, or promote a `build it first` item to a running prototype. The real version needs the Antigravity trick — select a region, comment, and the loop keeps running.

So: this is a `prototype` tier artifact. It answers whether the shape helps. Nothing more.

**Next:** open it and tell me one thing — is this the right shape, or is a node-and-edge graph what you actually pictured?

---

## 40. Eryk

that's much closer and I think for the brainstorming stage a UI like this may work very well. It's exciting to prototype this! I think what would be helpful is if we have this UI somehow repeated like a fractal for deeper and deeper layers. I feel what we got here is really cluterred and some cards are about nitty-grity decisions, some about the fundamental high-level ones. E.g. the level 0 could be:
1. we have a pipeline to build software with agents
2. [ + ] if I want to add anything tangent

A level deeper would be
1. We use external tracker for state
2. The pipeline has 6 stages
3. The result must become a standalone product
4. ...

Next level for the tracker part would be:
1. We want tracker to be configurable per project
2. We need local file to store ephemeral state and worklog
3. ...

It is a graph under the hood and it's also multi-dimensional since certain decisions on different levels influence, inform or at least relate to others. While I don't believe a graph view is the optimal view to work with, the structure should be there and traversable both for humans and agents. For instance, items on different levels may have some resaearch threads linked that influence them. Also, ideally, the conversation with agent should be scoped to each and every thread, so I can go as deep as I like and say: "hey, I'm unsure how we arrived here, let's clarify that", or "I changed my mind, let's consider alternative options". Then, the decision update must be propagated and change the full picture, too.

How does this one sound? A design tool like this - does it sound familiar with tools that already exist? Maybe not in the exact form but in principle.

---

## 41. Claude

`[thinking]`

---

## 42. Claude

This is a well-formed idea, and it has a deep precedent you should know about. Let me check the current state before I answer.

---

## 43. Claude

`[thinking]`

---

## 44. Claude

Yes. Very familiar — you have independently re-derived three separate traditions, and the combination does not exist as a product.

---

## 45. Claude

`[thinking]`

---

## 46. Claude

Full detail in `plans/dev-pipeline-research-design-tool.md`. The short version:

| What you described | What it is called | Age |
|---|---|---|
| The graph with decisions, options, and linked evidence | **IBIS** (Kunz & Rittel), practised as **Dialogue Mapping** (Conklin) | **1970** |
| Fractal levels, same shape, different content per level | **Semantic zoom** | 1990s |
| A conversation scoped to each node | **Loom**, formalised 2026 as **Conversation Tree Architecture** | 2021 / 2026 |
| Change a decision, propagate the change | **Truth Maintenance System** | 1979 |

The field name for the whole thing is **design rationale**. The surviving practical descendant is the Architecture Decision Record: flat files, no hierarchy, no evidence links, no propagation. You are describing the version that was abandoned because it was too much work by hand.

Two sentences from the research are your exact complaints, written decades apart:

- IBIS, 1970: *"The map, not the transcript, is the record of what the conversation established."*
- Conversation Tree Architecture, 2026: flat append-only chat means *"topically distinct threads bleed into each other"* — they name it **logical context poisoning**.

## The gaps are real

- No design-rationale tool for **software engineering** exists in 2026. The IBIS-plus-agent work is in deliberation, brainstorming, and clinical diagnosis.
- No tool does **true** semantic zoom in a nested board. Tana's zoom is navigational — you open a node as a page, and the representation stays the same. You described representation that changes per level.
- *"No mainstream LLM interface lets users manage context hierarchically."* That is their sentence, not mine.

## One change I want to make to your model

You wrote that items "influence, inform or at least relate to" each other. **"Relates to" cannot be acted on.** IBIS survived 50 years because its grammar has three edge types and a facilitator can keep pace with live speech. Four for us:

| Edge | Meaning | When the target changes |
|---|---|---|
| `refines` | the level edge | children get reviewed |
| `depends_on` | this is only true because that is true | **propagate staleness** |
| `supported_by` | evidence: research thread, benchmark, prototype result | flag, never auto-invalidate |
| `alternative_to` | a rejected option, kept attached | restored as a live choice when the decision reopens |

`alternative_to` is what makes "I changed my mind, show me the alternatives" work. Rejected options are never deleted, so reopening a decision restores the original choice set instead of inventing a new one.

## The two hard parts

**1. Propagation cannot be done by asking me.** Measured: single-hop validity checks recover only **6% to 11%** of the invalidation chain. So every card must record its `depends_on` edges **at the moment I create it**. There is no recovering them later. That is a discipline cost on me, every turn, forever — and if I skip it, the map rots into a pretty outline. The formal version is in [Grokers](https://arxiv.org/pdf/2606.00050): reverse dependency closure, mark stale, re-derive in topological order, cost `O(|S(v)|)`. It is the build-system model. Mark stale, never delete.

**2. Who creates the levels.** If I generate the split, it drifts from how you think. If you make it, it is work you did not ask for. IBIS's answer: I propose the split live, you promote or demote a card with one keystroke. Cheap correction beats correct generation.

## One warning worth keeping

The sensemaking research cites Krakauer's split: a **complementary** cognitive artifact coaches you toward holding the model yourself; a **competitive** one does the task and transfers no skill. Your contribution to this pipeline is judgement. If the tool starts deciding, it removes the thing you bring.

**Next:** I rebuild the map as the fractal version — three levels, four edge types, staleness shown when a card changes, and per-node chat as a stub. About two hours. You correct my level split rather than defining it.

---

## 47. Eryk

Do it. Curious to see it taking two hours!

---

## 48. Claude

`[thinking]`

---

## 49. Claude

Two hours was the estimate for a person. Building now.

---

## 50. Claude

`[thinking]`

---

## 51. Claude

Open. `plans/decision-map.html` — about 15 minutes, not two hours.

## Try this path, it takes 30 seconds

1. **Level 0** — one statement, one rollup bar. That is the whole project.
2. Click it → **level 1**, seven pillars, each with its own rollup.
3. Click **"The build-and-validate loop runs without me"** → **level 2**, six decisions.
4. Click **"Rubrics are per-project files, written once"** → the panel shows *3 cards depend on this* and the two alternatives you rejected.
5. Click **"I changed my mind — reopen this (5 cards go stale)"**.

Watch what happens: 5 cards go red, **two of them are two hops away**, and **one is in a different branch** (`measure`, not `loop`). The level-0 rollup bar changes colour. Walk back up the breadcrumb and the staleness is visible at every level.

That is the 6%-to-11% finding made concrete. A per-card "is this still valid?" question would have found the three direct dependents and missed the other two.

## What is implemented

| Thing | State |
|---|---|
| Semantic zoom — representation changes per level | works. Level 0 is a statement, level 1 is pillars with rollups, level 2 is decisions with edge counts |
| `refines` — the level edge | works, drives the breadcrumb |
| `depends_on` — reverse closure, mark stale, never delete | works |
| `supported_by` — research threads linked to decisions | works, clickable out to the papers |
| `alternative_to` — rejected options kept | works. "Choose this instead" swaps the decision and propagates |
| `+ add a tangent` at every level | works, real, attaches to the current parent |
| Per-card scoped conversation | **stub.** Shows the real threads where I have them, composer disabled |

## What is wrong with it

**The level split is mine, not yours.** That is the thing to attack. I put "align on intent" and "the loop" as siblings under the root; you may think alignment sits inside the stages, or that "visual" is not a pillar at all but a property of every pillar.

Also: no persistence, and I still regenerate this file by hand each turn. The engine has to own the graph before the threads can be live.

**Next:** click through level 1 and tell me which pillars are wrong — merged, split, or promoted a level.

---

## 52. Eryk

I wouldn't say it's wrong, we're prototyping here. What I'm missing now is a detail. The cards became merely titles with no proof or links to the supporting evidence. Can we extract the relevant parts of this conversation about particular topics across the levels and feel this gap?

---

## 53. Claude

`[thinking]`

---

## 54. Claude

Right — the detail is the point, and I dropped it. Rebuilding with the actual conversation attached to each card.

---

## 55. Claude

`[thinking]`

---

## 56. Claude

Reloaded. Every card now carries its proof, at every level.

## What changed

Each card shows the strongest verbatim quote on its face — not in a panel you have to open. The header counts total quotes and sources.

The panel gained two sections:

- **"How we arrived here — verbatim, from this conversation."** Your words and mine, attributed, with which message they came from. Your quotes are gold-bordered, mine blue.
- **"Supported by — the finding, not just the link."** The actual claim with its numbers, above the link.

Level 0 and level 1 carry quotes too, so the proof exists at every depth rather than only at the leaves.

## Three cards worth opening first

**`Merge on green CI, after G3`** (level 1 → Six stages). Shows my question, your one-word answer, the two options you rejected, and the red `no basis` flag. This is the whole failure mode in one card.

**`Split the rubric: visible and held-out checks`** (level 1 → the loop). SpecBench with the numbers: every model saturates the visible test suite, and the gap grows **28 percentage points per tenfold increase in code size**.

**`Propagation cannot be done by asking a model`** (level 1 → visual). The `6–11%` finding, the formal closure statement, and the 1979 ancestor. Then hit reopen on its parent and watch it work.

## One thing I should not be doing

I hand-wrote every quote from memory of this conversation. That is wrong. Your sessions are on disk at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The engine should **extract** the excerpts, with a pointer back to the exact message, so provenance is verifiable rather than my paraphrase.

That is a real feature, not a nicety: it is what makes "I'm unsure how we arrived here" answerable without trusting me.

Still stubs: the per-card thread, and persistence.

**Next:** open the three cards above and tell me whether the proof density is right — too much to scan, or still too thin.

---

## 57. Eryk

Deps and sources are still not visible. Also, only the top quote is displayed. Maybe after clicking on each card the top part should be about this particular card and the sub-cards as displayed today appear below that? [Image #1] [Image #2]

`[image attached]`

`[image attached]`

---

## 58. Eryk

[Image: source: /Users/eryk.napierala/.claude/image-cache/ce5ad95b-63fc-4597-a5b5-cfa6079d241c/1.png]

[Image: source: /Users/eryk.napierala/.claude/image-cache/ce5ad95b-63fc-4597-a5b5-cfa6079d241c/2.png]

---

## 59. Claude

`[thinking]`

---

## 60. Claude

Two real bugs. Navigating into a leaf card gave you an empty page, and the detail was trapped in a side panel you never reached. Your proposal is better than my panel — adopting it.

---

## 61. Claude

`[thinking]`

---

## 62. Claude

Fixed. The side panel is gone.

## What changed

**One view = one card.** Its own full detail on top, its sub-cards below. Identical layout at every depth, including the root and every leaf. Your screenshot 1 was a leaf with no children, so it rendered an empty page — now a leaf shows its whole content and says so.

Now visible on every card's page, not hidden:

- **All quotes**, not the top one. The header says how many.
- **Depends on** — clickable, with the level of each target.
- **N cards depend on this** — the reverse direction, all hops. This is what you reopen against.
- **Supported by** — the finding with its numbers, above the link.
- **Alternatives, kept** — with "Choose this instead".

Also: the URL carries the current card, so a view survives a reload and is shareable. `Escape` or `Backspace` goes up, and there is an `↑ up` button.

## Go straight to the card from your screenshot

```
plans/decision-map.html#lp-two
```

`Two layers: deterministic checks and graded judgements` now shows its 1 quote, both sources with the LangChain and OpenAI findings, and that it **depends on** `Split the rubric: visible and held-out checks`. Click that dependency, hit reopen there, and watch `lp-two` go stale from one hop up.

## Three cards added

The map now records this exchange too: `One view = one card`, `Every card carries its own proof`, and `The quotes should be extracted, not written by me` — which is still the weakest part, because I write them from memory instead of pulling them from the session file on disk.

**Next:** open `#lp-two` and confirm the deps and sources are readable now.

---

## 63. Eryk

Looks good. What's the underlying structure for this UI?

---

## 64. Claude

`[thinking]`

---

## 65. Claude

Two graphs over one flat array of nodes. That is the whole thing.

## What is in the file today

```js
{
  id:  "lp-split",
  p:   "loop",                    // refines — the level edge
  dep: ["lp-rubric"],             // depends_on — propagates staleness
  t:   "Split the rubric: visible and held-out checks",
  why: "Our rubric is the reward…",   // one line, shown on the card face
  d:   "The loop sees only the visible checks…",  // full prose
  s:   "proto",                   // decided | open | proto | finding
  who: "proto",                   // you | me | proto
  say: [{w:"me", q:"…", a:"My warning"}],          // provenance
  ev:  [{t:"SpecBench…", u:"https://…", f:"…28pp…"}],  // evidence
  alt: [{t:"…", w:"why it was rejected"}],          // kept options
}
```

The array is **flat**. The tree is derived from `p`, never nested. Nesting would make cross-branch `depends_on` impossible to express, and those are exactly the edges that matter.

## The one structural idea

Two independent graphs over the same nodes:

| Graph | Shape | What it gives you |
|---|---|---|
| `refines` | a tree | the levels, the breadcrumb, the rollup bars |
| `depends_on` | a DAG | staleness propagation, `O(\|S(v)\|)` reverse closure |

**Where a card sits is not what a card depends on.** `Trend checks` lives under *the loop*, but depends on `Merge on green CI`, which lives under *six stages*. That is why reopening one decision turns cards red in a branch you are not looking at.

Everything else is rendering. The header counts, the rollup bars, and the level split all derive from those two graphs.

## Four things wrong with it

1. **Evidence is inline, not a node.** SpecBench is a string inside one card. It should be its own node that many cards point at. Then "what else rests on this paper?" is answerable, and a retracted paper flags every dependent card at once.
2. **Quotes are copied text.** `say` holds my paraphrase. It should hold a pointer — session id plus message index — into `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Then provenance is verifiable instead of trusted.
3. **`p` is a field, `dep` is an array, `ev` is an object.** Three encodings for what are all edges. One uniform typed edge list would be smaller and let the agent traverse without special cases.
4. **No history.** "Choose this instead" mutates the node in place. The research was explicit: mark stale, never delete, preserve the evidence chain.

## What the real structure is

```
nodes:   card | source | excerpt | option
edges:   refines | depends_on | supported_by | alternative_to
```

And the part that matters: **the graph is a projection of an append-only event log**, not a stored document.

```
card.created · card.decided · card.reopened
edge.added   · evidence.attached · level.promoted
```

Replay the log and you get the current graph. You also get history, and "how did we arrive here" becomes a query instead of something I write down.

That is the same spine as the pipeline engine — one append-only log, projections on top. The design tool and the pipeline are not two systems.

**One thing I have not resolved:** where the graph lives. By our own seam rule it is judgement, so it belongs in the tracker — but a graph does not fit in an issue. The likely answer is that the log lives with the project and the tracker holds only the decisions as they are made. That needs a prototype, not an argument.

---

## 66. Eryk

1. Evidence is inline, not a node - yes, should be node indeed. Many decisions can link to the same evidence

---

## 67. Claude

`[thinking]`

---

## 68. Claude

Adopted. Evidence is now a node type, and the payoff shows immediately: 13 of the 25 sources are cited by more than one card.

---

## 69. Claude

`[thinking]`

---

## 70. Claude

`[thinking]`

---

## 71. Claude

Evidence is a node now. `Sources` button in the header ranks all 25 by how many cards rest on them — **13 are cited by more than one card**, so that much text was duplicated before.

Press **Dispute this source** on any source page. Its citers get an amber "review evidence" badge and do **not** go stale. That is the difference between `supported_by` and `depends_on`, made visible.

Schema written to `plans/decision-map-structure.md`.

---

## 2. Pointers vs literal copies

Your premise is the thing that cannot be checked. **"As long as the quote is a literal copy"** is exactly what nobody can verify without a pointer — I write these from a long context, and a paraphrase and a quotation look identical on the page. Neither of us can tell which is which in the file right now.

Four more consequences, all practical:

1. **No surrounding context.** "I'm unsure how we arrived here" usually needs the three messages around the quote, not the sentence.
2. **Truncation is silent.** I cut long quotes with an ellipsis. A pointer lets the view expand; a copy cannot.
3. **Reuse duplicates.** Your value-2 quote is already cited by two cards. Same drift problem that just made evidence a node.
4. **No session identity.** A copy cannot say which session or worktree it came from.

**Resolution: keep both.** The cached text is the fast read path — works offline, survives session deletion, no model call. The pointer is for audit and expansion. The temporal-validity paper argues the same way for a different reason: keep the model off the read path, ~2.1s versus 16–18s.

So `excerpt` becomes a node kind carrying `{session, msgIndex, span, text}`. Text *and* pointer.

## 3. One typed edge list — agreed

```ts
type Node = { id, kind: "card"|"source"|"excerpt"|"option", ...payload }
type Edge = { from, to, type: "refines"|"depends_on"|"supported_by"|"alternative_to" }
```

The payoff is that traversal becomes one function. "What touches X" is a single filter instead of three special cases, and a fifth edge type later costs no new code path.

One cost, worth naming: a uniform edge list is worse to hand-author, and hand-authoring is exactly what I do today. That stops mattering once edges come from events — which is your point 4.

## 4. Yes, an event log — and it is the same log

```ts
{ seq, at, actor, type, payload }

node.added · node.retitled · edge.added · edge.removed
status.set · reopened · rederived · option.chosen
source.disputed · level.moved
```

`graph = fold(events)`. The graph is derived, cached, and disposable.

Four things this buys:

1. **"How did we arrive here" becomes a query**, not prose I write. This subsumes point 2 entirely — decision history and transcript pointers are one mechanism.
2. **Time travel.** Render the map as of any `seq`. "What did we believe before SpecBench arrived?"
3. **Step 6 gets data about the pipeline itself** — how often you reopen, which branches churn, which gate you reject at.
4. **"Mark stale, never delete" stops being a rule** and becomes a property. A removal is an event; nothing is destroyed.

And staleness stops being a field. It is computed from the last `reopened` events and what has been `rederived` since — which is what the prototype already does with a runtime set.

**The structural payoff:** this is the same event log as the pipeline engine. The design tool and the pipeline become two projections over one log per project. Not two systems.

**Next:** press Dispute on the SpecBench source page and confirm the two edge types behave differently.

---

## 72. Eryk

Great. Let's summarise what we learned in this session, write it to a doc. Can be long. Should rather avoid going deep into the prototype code but must explain what the prototype tested, what we settled on. I want to hand this topic over and start a separate discussion with another agent about a tangent topic, so this will be a reference. Dump your entire conversation history and the source data used for the viz as well into a file.

---

## 73. Claude

`[thinking]`

---

## 74. Claude

`[thinking]`

---

