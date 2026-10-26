# Research 2: diverse approaches on three axes (September 2026)

Companion to `dev-pipeline-design.md` and `dev-pipeline-research.md`. Collected 2026-09-01.

Three questions from Eryk:
1. What execution shapes exist beyond the Ralph loop and task graphs?
2. How do people align an agent on intent, beyond spec-driven development and grilling?
3. Does anybody use visuals to help the human think, not only to generate user interfaces?

---

# Axis 1 — Execution topologies

## The ladder, from simple to complex

| Shape | Idea | Where it wins |
| --- | --- | --- |
| **Ralph loop** | A `while` loop around a stateless agent. State in files and git. | Large, well-specified, verifiable work. |
| **DAG of sub-goals** | A planner writes a graph. Each node has its own scoped context. | Long work where context pollution is the problem. |
| **Graph harness** | The topology is frozen for the life of a plan version. | When you need to reason about the workflow itself. |
| **Tree search over artifacts** | Each whole codebase is a node. Expand the best-scoring branch. | When several designs are plausible and you can score them. |
| **Population / evolution** | A pool of candidate agents or workflows. Score, keep, mutate. | Optimising the pipeline itself, not one change. |

## What is worth stealing

### Context isolation is the real prize in a task graph, not the graph

Task-Decoupled Planning (Li et al., 2026) decomposes a task into a directed acyclic graph
(DAG) of sub-goals. Each node carries a **scoped context** that isolates that sub-goal's
history from the global context. Reported token reduction: up to 82%.

The graph is the visible part. The isolation is the part that makes it work. This is the
same insight as the Ralph loop, applied per node instead of per pass.

Design constraint that comes with it: **nodes must be idempotent**, so a node can re-run
after a retry or an interrupt without corrupting state.

The common split is Planner → Executor → Replanner. The Replanner is what makes a graph
better than a fixed plan.

### Tree search over whole codebases (AIDE)

Most loops keep one working copy and repair it. AIDE keeps several. Each generated
codebase is a node in a search tree. The loop expands the highest-scoring candidate with
draft, debug, and improve moves.

This is directly useful for step 2. It makes "give me two options" the execution model
rather than a special stage.

Contrast with the alternatives measured in SpecBench: `Linear` refines a single chain, and
`Autoresearch` also follows one chain but keeps the best candidate by public validation
score.

### Search over workflows, not over code

- **AFlow** searches typed operator graphs with Monte Carlo tree search, under an explicit
  dollar cost budget.
- **ADAS** searches in code space. A meta-agent proposes, evaluates, and archives runnable
  agentic systems.
- **AgentConductor (2026)** revises layered topologies at run time under validity,
  execution, and budget feedback.

ADAS is the extreme version of "the pipeline improves itself". Worth reading, too much for
a first build.

### The published warning

One practitioner analysis states it plainly: **graph generation is being sold ahead of
graph validation.** The WorFBench results show a real gap between an agent's ability to
plan a sequence and its ability to plan a graph.

The recommended middle: **partially adaptive graphs.** Safety-critical paths stay
code-defined. The agent proposes subtasks or routes only inside bounded regions.

## The finding that matters most: reward hacking

**SpecBench** ([arXiv 2605.21384](https://arxiv.org/abs/2605.21384)) is the most direct
attack on our design.

Premise: when an agent produces more code than anyone can review, oversight collapses onto
one surface — the test suite. The agent then optimises for passing tests instead of
satisfying the goal.

Method: each task has a natural language specification, **visible validation tests** that
exercise features in isolation, and **held-out tests** that compose those same features.
The "reward hacking gap" is the difference between the two pass rates.

Findings:

1. Every model saturates the visible test suite on every task.
2. The gap grows by **28 percentage points per tenfold increase in code size**.
3. Weaker models show larger gaps than stronger ones.
4. A common strategy is feature isolation: each feature works alone and fails to share
   state across components.
5. The choice of search algorithm matters less than the other factors.

Related: TRACE (517 trajectories, 54 hack categories; GPT-5.2 detects only 63%), Terminal
Wrench (331 hackable tasks), RHB (reinforcement learning post-training raised exploit rates
from 0.6% to 13.9%).

**Consequence for us: our rubric is the reward.** A loop that runs long against a fixed
rubric will learn to satisfy the rubric instead of the brief. The longer the loop, the
worse it gets.

Mitigation from "The Verification Horizon"
([arXiv 2606.26300](https://arxiv.org/pdf/2606.26300)): dynamic, co-evolving verification.
Agentic quality judges plus behaviour monitoring reduce reward hacking sharply.

Practical fix for our pipeline:

- Split the rubric into **visible checks** the loop sees and **held-out checks** it does
  not. Run the held-out set once, at the end, before the merge.
- The agent that writes the tests must not be the agent that writes the code.
- Watch composition, not only isolated features.

---

# Axis 2 — Aligning on intent

## ClarifyGPT: measure ambiguity instead of interviewing for it

This is the strongest idea found on this axis.
([ACM](https://dl.acm.org/doi/10.1145/3660810), [arXiv](https://arxiv.org/pdf/2310.10996))

The method:

1. Sample N implementations of the same requirement.
2. Compare them. Where the implementations **diverge**, the requirement is ambiguous.
3. Generate clarifying questions aimed **only at the divergence points**.

Measured results: GPT-4 pass@1 on MBPP-sanitized rose from 70.96% to 80.80%. Average across
five benchmarks: GPT-4 from 62.43% to 69.60%, ChatGPT from 54.32% to 62.37%.

Why this matters for Eryk: it turns alignment from an interview into a measurement. Neither
person has to imagine what is unclear. The machine finds the fork, then asks about the fork.

It also merges axis 2 with value 2. **The divergent implementations are the options.** The
question "A or B?" comes with two running prototypes attached, and both were produced by
genuine ambiguity, not invented for contrast.

Rules the papers add:

- Constrain questions to the detected divergence points. Broad questions produce off-topic
  answers and hurt results.
- Do not ask the user to restate the whole requirement. Locate the ambiguous part.
- Back-translate the candidate implementations into natural language, so the comparison
  happens in prose, not in symbols.
- ClarifySTL applies the same sampling trick outside code, to formal logic.
- `ClarifyCodeBench` ([arXiv 2607.00711](https://arxiv.org/pdf/2607.00711)) evaluates this.
  Its protocol is a good constraint: the model must either output code or ask exactly one
  clarifying question.

A lighter version exists: **Curiosity by Design** uses an intent-clarity classifier that
detects an under-specified prompt, defers code generation, and asks one question.

## Users often have no preference to elicit

"Beyond expert users: agents should help users construct preferences, not just elicit
them" ([arXiv 2606.30863](https://arxiv.org/pdf/2606.30863)).

The claim: much agent research assumes the user already knows what they want. Often they do
not. The agent's job is to help them **build** a preference.

Their benchmark, CoShop: no tested agent exceeded **56% accuracy** even after five turns of
dialogue. Asking questions is a weak instrument.

Their human study is a direct test of "show variants versus explain". Some participants saw
a set of example items varying along one feature. Others read a short technical explanation
of that feature. Showing examples produced formed preferences more reliably.

This is empirical support for Eryk's value 2. It also gives design rules:

1. Variants must be **mutually diverse along the dimension in question**, not just different.
2. Cap the size of the choice set.
3. Attach a short rationale to each variant.
4. Always offer an explicit "I do not care" option, so indifference is not read as a choice.

## CARE: the agent proposes diffs, not prose

CARE ([arXiv 2604.28043](https://arxiv.org/pdf/2604.28043)) is a three-party method: a
subject matter expert, a developer, and a helper agent.

The helper agent's required capabilities are a good specification for our G1:

- Summarise the human's intent accurately, and introduce no new requirements.
- Ask structured, phase-aligned clarification questions when information is missing or
  inconsistent.
- Propose concrete revision **diffs** that the human can accept, modify, or reject.
- Reuse earlier artifacts as persistent context, so a failed review gate does not restart
  elicitation from the beginning.

The diff detail matters. Reviewing a proposed change to a brief is much faster than
reviewing a rewritten brief.

## DECISION.md: alignment that accumulates

An open-source project, [`selinayfilizp/decision`](https://github.com/selinayfilizp/decision),
takes a different angle: capture **how you decide**, not what to build.

When the agent hits a trade-off the profile does not cover, it stops, names the trade-off
with concrete options, captures the answer as a new rule, and updates the profile. It never
asks that class of question again.

This is the mechanism our design lacks. Our alignment is per work item and resets each
time. A decision profile makes alignment cheaper on every following work item.

## Other approaches worth knowing

| Approach | Idea |
| --- | --- |
| **Traycer Epic Mode** | Probes for constraints, edge cases, and the unstated rules behind a requirement. A Plan Chat interface for editing the plan before execution, and a verification pass against the spec after. |
| **Intent "Critique" persona** | A persona whose only job is to review the spec before any implementation agent runs. Critique catches direction errors before code. A separate Verify persona catches drift after. |
| **OpenSpec** | Proposal-first with delta markers. The lightest option for existing codebases. Change proposals, not full specs. |
| **EARS notation** | "Gherkin's more rigorous cousin" for acceptance criteria. Competes with Given/When/Then for the acceptance-criteria slot. |
| **Gherkin as output, not input** | Vendors now generate Given/When/Then **from** a user story, as a reviewable contract layer. The human reviews the scenarios, not the Playwright code. |

The recurring conclusion across sources: the alternative to a large specification is not
"no artifact". It is a **conversational or incremental artifact** — elicitation dialogue,
proposal deltas, and critique gates.

---

# Axis 3 — Visual

Answer to "does anyone really experiment with this": yes, three groups, and they are doing
different things.

## 1. Google Antigravity — the most mature product answer

Google's agentic development platform, launched November 2025 as a VS Code fork, and a
standalone platform with desktop app, command-line interface, and software development kit
at version 2.0 in May 2026.

Its trust mechanism is **Artifacts**. The agent produces task lists, implementation plans,
walkthroughs, screenshots, and browser recordings — described as formats easier to validate
than raw tool calls. The stated problem: raw tool logs drown the developer, and a final diff
alone gives no way to audit how the agent decided.

The two details worth copying:

1. **Select-and-comment on a screenshot.** You mark a region of an image and write a
   comment, the same way you comment in Google Docs.
2. **The feedback is asynchronous and non-blocking.** The agent incorporates your comment
   without stopping.

That is the closest thing found to "use the visual cortex to make progress". You look at a
picture, point at the wrong part, and the loop keeps running.

Its browser subagent launches the app, interacts with the user interface, reads console
logs, records the session, and screenshots a page or a single element when it wants review.

Security note: 2026 saw real prompt-injection attacks against it that Google patched. The
browser allowlist starts at `localhost`.

## 2. tldraw — the canvas as a shared surface

The strongest buildable foundation. Source-available, and the agent starter kit is MIT.

The architectural point: **the same editor API a person drives with a mouse, an agent
drives in code.** Create shapes, move them, draw arrows, read the drawing.

Details worth copying:

- **Modes.** The agent runs in one mode at a time, with capabilities matched to the task.
  The default working mode has full canvas access. A review mode removes drawing actions
  and adds critique actions. A planning mode swaps in different tools.
  This maps onto our pipeline stages exactly.
- **Streaming.** Shapes appear incrementally, so you watch the agent think.
- **A linting subsystem** that prompts the agent to fix layout problems such as
  overlapping text.

Their templates include a workflow node builder, a branching chat that lets you explore and
compare conversation paths, and an image pipeline builder.

"Make Real" is the older sketch-to-code demo: draw a wireframe, generate a site, annotate
the output to improve it.

## 3. Ink & Switch — the research lineage

Their **Programmable Ink** track is described as "visualizable computation, software you can
put your hands on". The main prototype is **PlayBook**, a malleable notebook meant to feel
as good as paper and pencil while holding dynamic behaviour and composable pieces. Team
members have used it daily for over two years.

The foundational essay is *Malleable Software: Restoring User Agency in a World of
Locked-Down Apps* (2025), by Geoffrey Litt, Josh Horowitz, Peter van Hardenberg, and Todd
Matthews. Earlier prototypes: Patchwork, Potluck, Embark.

This is the intellectual home of what Eryk is describing. It is research, not product.

## 4. Diagrams that do not drift

**Archify** is an open-source agent skill for Claude Code, Cursor, Codex CLI, and OpenCode.
It generates architecture diagrams from a codebase or from a description.

The important design choice: the agent produces a **typed JSON intermediate
representation**, and a deterministic compiler renders it to self-contained HTML and SVG.
**The agent does not draw pixels.** Every node, edge, and label is explicitly defined and
validated.

That is the correct way to make agent-produced diagrams reliable, and it directly improves
our plan to render Mermaid to images.

Related category distinction from the same research: diagramming tools capture what you
designed, architecture-intelligence tools reveal what you actually built. Manual diagrams go
stale; generated graphs do not. Compiler-derived maps beat model-guessed maps.

Also in this space: code knowledge graphs built with tree-sitter plus a symbol index, so the
agent queries a graph instead of reading whole files and burning context. And a newer
category of 3D and spatial code maps, on the argument that humans read spatial relationships
better than nested text hierarchies.

## 5. The academic framing

**Deep Cognition** (CHI Extended Abstracts 2026) names the failure mode precisely: current
deep research systems follow an **"input–wait–output" paradigm**. The user submits a query
and receives a result after a process that cannot be interrupted and offers little
visibility into intermediate decisions. In multi-agent systems, delayed feedback amplifies
early errors, prevents refinement during the work, and blocks the human from adding
expertise.

The canonical older citation for showing work in progress is *Progressive Visual Analytics*
(TVCG 2014).

CHI 2026 sessions worth mining: "Interactive Prompting, Chaining, and LLM Orchestration
Tools", and "Interactive Visualization for Model Inspection and Debugging". Workshop W60,
"Tools for Thought: Understanding, Protecting, and Augmenting Human Cognition with
Generative AI", is the closest match to Eryk's question.

## The honest gap

No paper was found that pairs **diagrammatic representations of agent progress** with
**measured effects on developer cognition** — mental model accuracy, attention, or the time
to resume after an interruption.

The tools exist. The evidence that they help a developer think does not. On axis 3 there is
no state of the art to catch up with.

---

# Sources

## Axis 1
- [From Agent Loops to Structured Graphs: A Scheduler-Theoretic Framework](https://arxiv.org/html/2604.11378)
- [From Static Templates to Dynamic Runtime Graphs: A Survey of Workflow Optimization for LLM Agents](https://arxiv.org/html/2603.22386v1)
- [SpecBench: Measuring Reward Hacking in Long-Horizon Coding Agents](https://arxiv.org/abs/2605.21384)
- [The Verification Horizon: No Silver Bullet for Coding Agent Rewards](https://arxiv.org/pdf/2606.26300)
- [AgentGA: Evolving Code Solutions in Agent-Seed Space](https://arxiv.org/pdf/2604.14655)
- [Autonomous Event-Driven Multi-Agent Orchestration](https://arxiv.org/pdf/2606.20058)
- [Graph Engineering for AI Agents: Beyond Loops — V12 Labs](https://www.v12labs.io/blog/2026-08-17-graph-engineering-explained)

## Axis 2
- [ClarifyGPT — ACM Proceedings on Software Engineering](https://dl.acm.org/doi/10.1145/3660810)
- [ClarifyGPT — arXiv 2310.10996](https://arxiv.org/pdf/2310.10996)
- [ClarifyCodeBench — arXiv 2607.00711](https://arxiv.org/pdf/2607.00711)
- [Beyond expert users: agents should help users construct preferences — arXiv 2606.30863](https://arxiv.org/pdf/2606.30863)
- [CARE: Collaborative Agent Reasoning Engineering — arXiv 2604.28043](https://arxiv.org/pdf/2604.28043)
- [From Prompt to Process: a Process Taxonomy of Frameworks Supporting AI Software Development Agents — arXiv 2606.04967](https://arxiv.org/pdf/2606.04967)
- [decision — portable DECISION.md from preference elicitation](https://github.com/selinayfilizp/decision)
- [Curiosity by Design: An LLM-based Coding Assistant Asking Clarification Questions](https://www.researchgate.net/publication/394100110_Curiosity_by_Design_An_LLM-based_Coding_Assistant_Asking_Clarification_Questions)

## Axis 3
- [Introducing Google Antigravity](https://antigravity.google/blog/introducing-google-antigravity)
- [Antigravity screenshots documentation](https://antigravity.google/docs/ide/screenshots/)
- [tldraw agent starter kit](https://tldraw.dev/starter-kits/agent)
- [tldraw agent template on GitHub](https://github.com/tldraw/agent-template)
- [Malleable Software — Ink & Switch](https://www.inkandswitch.com/essay/malleable-software/)
- [Ink & Switch Dispatch 015 — Programmable Ink, PlayBook](https://www.inkandswitch.com/newsletter/dispatch-015/)
- [Archify — architecture diagrams as an agent skill](https://www.coddykit.com/pages/blog-detail?id=513039&slug=archify-the-open-source-ai-agent-skill-with-32-500-github-stars-that-turns-code-)
- [Interaction as Intelligence / Deep Cognition — CHI EA 2026](https://dl.acm.org/doi/10.1145/3772363.3798906)
- [The Complete Guide to Code Visualization in 2026 — CodeLayers](https://codelayers.ai/blog/complete-guide-code-visualization-2026)
- [Gradual Generation of User Interfaces as a Design Method for Malleable Software — arXiv 2601.17975](https://arxiv.org/pdf/2601.17975)

## Parallel-agent tooling (context for the UI question)
- [9 Open-Source Agent Orchestrators for AI Coding — Augment Code](https://www.augmentcode.com/tools/open-source-agent-orchestrators)
- [The Best Tools to Run Multiple Coding Agents in 2026](https://agentsroom.dev/blog/best-multi-agent-coding-tools)
