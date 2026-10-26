# Research 3: precedents for the fractal decision map (September 2026)

Companion to `dev-pipeline-design.md`. Collected 2026-09-01.

Eryk described a design tool: nested levels of the same board shape, a graph underneath,
research threads linked to decisions, a conversation scoped to every node, and a decision
change that propagates through the whole picture.

That description combines three well-studied traditions. None of them is new. The
combination does not exist as a product.

---

## 1. The graph and the grammar — this is IBIS

Werner Kunz and Horst Rittel introduced the Issue-Based Information System (IBIS) in
**1970**, to capture the reasoning behind decisions on hard planning problems. Jeff Conklin
later paired it with live facilitation and called the practice **Dialogue Mapping**.

The notation is a **grammar**, not a set of node types:

- Questions respond to Ideas.
- Ideas respond to Questions.
- Arguments respond to Ideas.

Two properties matter for us.

**The grammar is deliberately tiny.** It is small enough that a facilitator can keep pace
with live conversation. Any grammar we invent has the same constraint, because the map must
be built during the conversation, not after it.

**The map, not the transcript, is the record of what the conversation established.** That
sentence is 50 years old and it is exactly Eryk's complaint 2.

The academic field name for this is **design rationale**. A related notation is **QOC —
Questions, Options, Criteria**, which is our G2 gate written as a formalism. The surviving
practical descendant is the **Architecture Decision Record (ADR)**: flat files, no
hierarchy, no propagation, no links to evidence.

### Current work: agents facilitating IBIS

- **Guided Sensemaking: Agents in Collaborative Deliberation**
  ([arXiv 2606.02260](https://arxiv.org/pdf/2606.02260)). Ito et al. keep conversation state
  in an IBIS tree and inject facilitation messages. Result: more comprehensive discussion
  and higher user satisfaction.
- **Nomura et al.**: humans brainstorming with IBIS-based agents produced **more ideas per
  person** and reported **less hesitation to contribute** than human-only groups.
- **MedCollab** ([arXiv 2603.01131](https://arxiv.org/html/2603.01131v1)) turns informal
  multi-agent dialogue into a formally verifiable directed acyclic argumentation graph, where
  each argument states the rationale connecting a position to its evidence.
- **Argumentree** is a current commercial tool: questions to positions to pros and cons,
  stored and searchable, so months later somebody can trace the reasoning behind a decision.

### The design warning to keep

David Krakauer's distinction, cited in the sensemaking work: a **complementary** cognitive
artifact coaches the user toward internalising the mental model. A **competitive** one
performs the task without transferring any skill.

Eryk's contribution to the pipeline is judgement. The tool must be complementary. If it
decides for him, it removes the thing he brings.

### The gap

No 2026 design-rationale tool for **software engineering** was found. The agent work targets
deliberation, brainstorming, and clinical diagnosis. Nobody has built the IBIS agent for
development decisions.

---

## 2. The fractal levels — this is semantic zoom, and Eryk means the strict version

Semantic zoom couples the level of detail to the zoom operation. Related ideas: level of
detail, abstraction gradient, progressive disclosure, chunking in writing, mipmapping in
graphics, coarse-graining in physics. Alexander Obenauer has explored semantic zoom as an
operating-system primitive.

The distinction that matters:

| Kind | What happens on zoom | Example |
| --- | --- | --- |
| **Navigational zoom** | You open a node as a page. The representation is the same. | Tana, Workflowy |
| **Semantic zoom** | The representation changes **qualitatively** per level. | mostly research prototypes |

Eryk described the second kind. Level 0 holds one or two statements. Level 1 holds a
different kind of content, not more of the same.

Semantic zoom is also distinct from aggregation and hierarchical clustering, which disrupt
internal connectivity and layout stability, and from progressive rendering, which does not
couple detail to zoom. Good implementations bound per-view complexity by viewport
intersection and **keep node positions invariant under pan and zoom**.

Software-visualization lineage: Storey et al. built a nested graph view with a fisheye,
where some nodes contain source code visible only above a magnification threshold. The
KIELER framework calls its version "smart zoom" and adapts detail to zoom level while
keeping important labels visible when zoomed out.

### Tana is the closest shipping product

Tana blends an outliner with a graph database. Every bullet is an atomic node. **Supertags**
act as dynamic types: configuring a Supertag defines default child nodes and Fields
(metadata) applied wherever the tag is used. Tana has framed its publishing feature in
progressive-disclosure terms: executives see key objectives, teams explore implementation
paths.

Its stated cost is a warning for us: new users must hold **three overlapping organisational
systems** at once — hierarchy by indentation, semantic relationships by linking and
supertagging, and structured data by fields and queries — and knowing which to use is not
obvious.

Workflowy is the opposite trade: infinite nesting, no types, no AI.

### The gap

No tool was found that does true semantic zoom in a nested board context. Tana's zoom is
navigational. This part is research prototypes, not products.

---

## 3. The conversation scoped per node — this is Loom, and there is a 2026 formalism

**Loom** (generative.ink) is the canonical branching interface for language models. It treats
a model as a multiverse generator: generate, navigate, save, and filter branches. In read
mode the current node and its ancestry read as one history, while the tree appears in a
sidebar. **Exoloom** extends it: generate several completions for one prompt and curate
which to continue from.

### The direct hit: Conversation Tree Architecture

[arXiv 2603.21278](https://arxiv.org/abs/2603.21278) names the failure mode precisely.

Flat, append-only chat accumulates all context in one unbounded window. Topically distinct
threads bleed into each other and degrade response quality. They call this **logical context
poisoning**.

Their framework: a tree of **context-isolated nodes**, each with its own local context
window, with structured rules for how context flows **downstream** when a branch is created
and **upstream** when a branch is deleted. They add **volatile nodes** — transient branches
whose context must be selectively merged upward or discarded.

Their stated gap: **no mainstream LLM interface lets users manage context hierarchically.**

Related: **Branch LLM** turns linear chat into a tree with automatic context preservation and
token optimisation. **AIbranch** claims to be the only chat interface exposing the tree as a
first-class navigable interface, across providers. **DialogTree** is a branching canvas where
each fork is a revisitable node.

### The convergence worth noticing

Three independent findings in this research say the same thing:

1. The Ralph loop: a fresh context per pass, because long contexts degrade.
2. Task-Decoupled Planning: a scoped context per DAG node, up to 82% fewer tokens.
3. Conversation Tree Architecture: an isolated context per conversation node.

**Context must be scoped per node.** This is now the strongest single pattern found across
all three research passes.

---

## 4. The propagation — this is a Truth Maintenance System, and the naive version fails

Classical ancestor: the **Truth Maintenance System** (TMS), and specifically a JTMS, where a
sentence's justification records which assumptions must change to invalidate it. Changing an
assumption means relabelling nodes of a dependency network, and switching between alternative
assumption sets "may lead to considerable work".

### The formal statement to implement

From **Grokers** ([arXiv 2606.00050](https://arxiv.org/pdf/2606.00050)), over typed knowledge
graphs:

> Let `v` be modified. Define the reverse dependency closure
> `S(v) = { u | there is a path u ⇝ v via depends_on }`.
> After marking all `u ∈ S(v)` stale and reprocessing them in valid topological order, no node
> is stale. Nodes outside `S(v)` are unaffected. Propagation cost is `O(|S(v)|)`.

The paper frames this as **the build-system model applied to semantic comprehension**. It
mirrors a minimal cache invalidation result: only nodes reachable from the modified node need
reprocessing.

### The finding that decides the implementation

**Single-hop staleness checks capture only 6% to 11% of the invalidation chain**, regardless
of chain length. A single-hop judgement cannot see that an upstream change invalidated a node
two or three hops away. Propagation over a learned graph recovers most of the chain.

Consequence: we cannot ask a model "is this card still valid?" per card. **Every card must
record explicit `depends_on` edges at the moment it is created.** If the edges are missing,
propagation is impossible and the map rots into a pretty outline.

### Other implementation notes from the same sources

- **Mark stale. Do not delete.** Preserve the evidence chain. In-place updates destroy it.
- Keep the model **off the read path**. A deterministic superseded-row filter runs at the
  embedding floor, about 2.1 seconds, against 16 to 18 seconds for model-based reranking or
  verification.
- No database gives dependency-aware propagation for free. Active databases propagate by
  event-condition-action rules over flat relational state, which is referential and not
  content-aware. Materialised views propagate along fixed schemas. Append-only and vector
  stores return outdated and current values together. "No database management system
  re-evaluates dependent facts when one fact changes."
- Benchmark hygiene: if a stale card carries a text marker such as `[OUTDATED]`, a baseline
  can pass by reading the label rather than by any real mechanism.

---

## Proposal: four edge types, and no "relates to"

Eryk wrote that items "influence, inform or at least relate to" each other. "Relates to" is
too weak to act on. IBIS's answer is a tiny typed grammar. Applied here:

| Edge | Meaning | On change of the target |
| --- | --- | --- |
| `refines` | The level edge. This card is a level deeper than that one. | Children are reviewed, not invalidated. |
| `depends_on` | This card is only true because that card is true. | **Propagate staleness.** The reverse closure goes stale. |
| `supported_by` | Evidence. A research thread, a benchmark, a prototype result. | Flag for review. Never auto-invalidate. |
| `alternative_to` | A rejected option, kept attached to the decision. | Restored as a live choice when the decision reopens. |

`alternative_to` answers "I changed my mind, let us consider alternatives". The rejected
options are never deleted, so reopening a decision restores the original choice set instead of
regenerating it from nothing.

Four edge types is close to IBIS's three. That is the point. A grammar large enough to be
expressive cannot be maintained live.

---

## The two hard parts

### Who creates the levels

If the agent generates the level split, the levels drift from how Eryk thinks. If Eryk creates
them, it is work he did not ask for.

The IBIS answer applies: the agent proposes the split as the conversation runs, and Eryk
promotes or demotes a card with one keystroke. **Cheap correction beats correct generation.**
See also *Gradual Generation of User Interfaces*
([arXiv 2601.17975](https://arxiv.org/pdf/2601.17975)), which studies intermediate user
interfaces as a way to organise sets of customisations.

### Recording `depends_on` at creation time

This is a discipline cost on the agent, on every turn, forever. There is no way to recover the
edges later, because single-hop reconstruction recovers 6% to 11%.

---

## Sources

- [Guided Sensemaking: Agents in Collaborative Deliberation — arXiv 2606.02260](https://arxiv.org/pdf/2606.02260)
- [MedCollab: IBIS-Structured Argumentation for Multi-Agent Diagnosis — arXiv 2603.01131](https://arxiv.org/html/2603.01131v1)
- [What Is Dialogue Mapping? IBIS, Wicked Problems & Tools — Argumentree](https://www.argumentree.com/what-is/dialogue-mapping/)
- [Conversation Tree Architecture — arXiv 2603.21278](https://arxiv.org/abs/2603.21278)
- [Loom: interface to the multiverse — generative.ink](https://generative.ink/posts/loom-interface-to-the-multiverse/)
- [Exoloom](https://exoloom.io/)
- [Semantic Zoom: Interactive Multi-Level Visualization](https://www.emergentmind.com/topics/semantic-zoom)
- [semantic-zoom pattern catalogue — prathyvsh](https://github.com/prathyvsh/semantic-zoom)
- [Semantic Zoom and Mini-Maps for Software Cities — arXiv 2510.00003](https://arxiv.org/html/2510.00003v1)
- [Tana — publish and progressive disclosure](https://outliner.tana.inc/blog/share-your-thinking-not-just-your-documents-with-tana-publish)
- [Tana review: an outliner that thinks in graphs — Pickuma](https://pickuma.com/for-dev/tana-personal-knowledge-management-review/)
- [Grokers: Write-Time Intelligence over Typed Knowledge Graphs — arXiv 2606.00050](https://arxiv.org/pdf/2606.00050)
- [Temporal Validity in Retrieval Memory — arXiv 2606.26511](https://arxiv.org/pdf/2606.26511)
- [Is Agent Memory a Database? — arXiv 2605.26252](https://arxiv.org/pdf/2605.26252)
- [Problem Solving and Truth Maintenance Systems — Temple CIS](https://cis.temple.edu/~ingargio/cis587/readings/tms.html)
- [Gradual Generation of User Interfaces — arXiv 2601.17975](https://arxiv.org/pdf/2601.17975)
