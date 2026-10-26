# Research: what exists in agentic development pipelines (September 2026)

Companion to `dev-pipeline-design.md`. Collected 2026-09-01.

## Landscape

| System | Shape | What to take | What to avoid |
| --- | --- | --- | --- |
| [GitHub Spec Kit](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) | CLI. Specify → Plan → Tasks → Implement. 93k stars, 30+ agents. | The four-phase split is now the common vocabulary. | Produces many repetitive Markdown files. Böckeler never finished a mid-size feature with it. |
| [Kiro (AWS)](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) | IDE. Requirements → Design → Tasks. "Steering" files: `product.md`, `structure.md`, `tech.md`. GA November 2025. | Steering files are a good model for our per-project rubric. | Turned one small bug fix into 4 user stories and 16 acceptance criteria. |
| [Tessl](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) | Spec-as-source. Generated code marked `DO NOT EDIT`. $125M raised. Framework plus Registry. | Two-layer context: process context plus library context. | Full spec-as-source removes the ability to read the code as truth. |
| [BMAD Method](https://re-cinq.com/blog/multi-agent-orchestration-bmad-claude-flow-gastown) | 19+ role agents (PM, Architect, Scrum Master, QA). 50+ workflows. Fresh chat per phase. | Fresh context per phase. Versioned artifacts in git. | About 3 hours of planning before any code. One task at a time, no parallel work. |
| [Claude Flow / Gas Town](https://re-cinq.com/blog/multi-agent-orchestration-bmad-claude-flow-gastown) | Control layer for many agents at once. Gas Town described by Steve Yegge as "Kubernetes for agents". | Parallel agents. Anthropic measured a lead-plus-subagent setup beating a single agent by 90.2% on internal research evaluations. | Heavy. Only pays off with a large agent fleet. |
| [Ralph loop (Huntley)](https://ghuntley.com/ralph) | A `while` loop around a stateless agent. `PROMPT.md` is the only persistent instruction. | See "Correction 2" below. This is the most important idea found. | No plan, no gates. Works only when acceptance criteria are already clear. |
| [Copilot cloud agent for Linear](https://github.blog/changelog/2026-07-23-copilot-cloud-agent-for-linear-is-now-generally-available/) | Assign a Linear issue to an agent. GA 23 July 2026. | Validates tracker-as-state. Do not rebuild what Linear already gives. | Admin approval needed. Premium request cost per session. |
| [LangChain RubricMiddleware](https://www.langchain.com/blog/introducing-rubrics-for-deepagents) | The agent self-evaluates against a rubric and iterates until every criterion passes or a cap is reached. A separate grader sub-agent scores. | A reference implementation of our loop exit gate. | — |

## Corrections to our design

### 1. There is no size router. This is the largest gap.

Böckeler ran Kiro on a small bug fix and received 4 user stories and 16 acceptance
criteria. She wrote that she would rather review code than review the Markdown that
spec-kit produced. Her conclusion: the overhead of spec-driven development scales poorly
downward.

Our design puts every work item through a brief, two or more prototypes, three gates, and
a full rubric. For a one-line null check that is waste.

**Fix: a risk tier, chosen at intake, decides how many stages and gates run.**

| Tier | Stages | Gates | Merge |
| --- | --- | --- | --- |
| `fix` | loop only. The issue title is the brief. | none | auto-merge on green |
| `change` | brief → loop → ship | G1, G3 | auto-merge on green |
| `feature` | all six steps | G1, G2, G3 | auto-merge on green |

This matches the tiered merge access pattern reported for 2026: auto-merge for low risk,
agent plus human for medium, human-only for critical paths.

### 2. The loop must be stateless per pass

Our loop controller assumed one long agent context that builds, validates, and fixes.
That context degrades. The Ralph loop makes the opposite choice, and the reasoning holds:
context windows fill up and degrade, the file system and git do not.

**Fix: one fresh agent per pass. The repository is the memory.**

```
while rubric fails:
    start a fresh agent
    give it: the brief, the decision, the rubric, the last failure
    it does one unit of work, then exits
    append the result to the event log
```

The only truth is the exit code of an external command. Progress lives in files and git
history, not in a conversation.

Evidence it scales: Huntley built a working programming language and compiler in one
unattended run for about $297 in model cost. At a Y Combinator hackathon a Ralph loop
produced 1,100 commits across 6 repositories overnight.

### 3. The rubric has two halves, not one

Current practice splits acceptance into two layers. Deterministic checks answer "did it
work". A graded rubric answers "is it good". Our single list mixed them.

```yaml
checks:        # deterministic. exit code is the answer.
  - CI=true pnpm test
  - pnpm typecheck
  - pnpm lint
judgements:    # a grader sub-agent scores each one, with per-criterion feedback
  - every item in the brief has a test
  - no new public function without a doc comment
  - the screenshot matches the chosen option
```

OpenAI's guidance is to start from a checkable definition of done, write deterministic
checks first, and add a graded pass only where deterministic rules cannot reach.

### 4. Add an overseer

Our stop rule was "3 failures on the same check". The paper *A Self-Improving Coding
Agent* ([arXiv 2504.15228](https://arxiv.org/pdf/2504.15228)) uses something stronger: a
system overseer reads execution traces in real time and can cancel an agent that stops
making progress or clearly deviates, after at least one warning.

We already have the event log. The overseer is a second process that reads it. It is cheap
to add and it is the real safety control for auto-merge.

### 5. Step 6 must write new rubric lines

This is the missing self-improvement path. OpenAI's eval guidance treats every manual fix
as a signal to turn into a test. The Darwin Gödel Machine
([arXiv 2505.22954](https://arxiv.org/pdf/2505.22954)) goes further: a separate model reads
the evaluation logs, writes a problem description and an improvement suggestion, and hands
them to the coding agent as a self-modification task.

**Fix: when a bug reaches production, or when Eryk rejects at a gate, step 6 appends a
line to the project rubric.** The rubric grows from real failures. That is what makes the
pipeline improve instead of only repeat.

## The warning to take seriously

Eryk chose auto-merge on green continuous integration. Two findings argue for care.

1. A Carnegie Mellon study of 807 open-source projects using SonarQube found a velocity
   increase that disappeared by month three, with code analysis warnings up 30% and
   complexity up 41%.
2. DORA's 2024 report names the "verification tax": time saved writing code is re-spent
   auditing it.

A rubric of pass-or-fail gates does not catch slow drift. Every check passes while
complexity climbs.

**Fix: the rubric includes trend checks, not only pass-or-fail checks.** Example: the
complexity score and the warning count must not increase by more than N% against the
merge base. Step 6 reports the trend across work items.

## Ideas worth stealing later

- [Google Stitch](https://www.forasoft.com/blog/article/ai-wireframe-tools-comparison) has
  an Agent Manager that explores several design directions in parallel on one canvas. That
  is our G2, done visually.
- Stitch also has `DESIGN.md`, a portable Markdown format for design system rules that
  moves between the design tool and the developer tool. A good input to the
  "screenshot matches the chosen option" judgement.
- Kiro's steering files (`product.md`, `structure.md`, `tech.md`) are a clean split of
  per-project context. Our rubric could follow the same split.

## Sources

- [Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl — Birgitta Böckeler](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [spec-compare: interactive comparison of 18 spec-driven tools](https://github.com/cameronsjo/spec-compare)
- [9 Best AI Tools for Spec-Driven Development in 2026](https://www.marktechpost.com/2026/05/08/9-best-ai-tools-for-spec-driven-development-in-2026-kiro-bmad-gsd-and-more-compare/)
- [Multi-Agent Orchestration: BMAD, Claude Flow, and Gas Town](https://re-cinq.com/blog/multi-agent-orchestration-bmad-claude-flow-gastown)
- [Mastering Ralph loops — LinearB](https://linearb.io/blog/ralph-loop-agentic-engineering-geoffrey-huntley)
- [What Is the Ralph Loop? Agentic Coding Explained (2026)](https://pooyagolchian.com/blog/what-is-the-ralph-loop-agentic-coding-2026/)
- [Copilot cloud agent for Linear is now generally available](https://github.blog/changelog/2026-07-23-copilot-cloud-agent-for-linear-is-now-generally-available/)
- [Integrate coding agent with Linear — GitHub Docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/integrate-coding-agent-with-linear)
- [Introducing Rubrics for DeepAgents — LangChain](https://www.langchain.com/blog/introducing-rubrics-for-deepagents)
- [Testing Agent Skills Systematically with Evals — OpenAI](https://developers.openai.com/blog/eval-skills)
- [A Self-Improving Coding Agent — arXiv 2504.15228](https://arxiv.org/pdf/2504.15228)
- [Darwin Gödel Machine — arXiv 2505.22954](https://arxiv.org/pdf/2505.22954)
- [When Agents Do Not Stop: Uncovering Infinite Agentic Loops in LLM Agents — arXiv 2607.01641](https://arxiv.org/pdf/2607.01641)
- [The Limits of Spec-Driven Development — Isoform](https://isoform.ai/blog/the-limits-of-spec-driven-development)
- [A guide to the agentic SDLC — CodeRabbit](https://www.coderabbit.ai/guides/agentic-sdlc)
- [Self-Improving Coding Agents — Addy Osmani](https://addyosmani.com/blog/self-improving-agents/)
