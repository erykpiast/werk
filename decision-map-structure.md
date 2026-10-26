# The decision map: data structure

Agreed 2026-09-01, in the conversation that produced `plans/decision-map.html`.
This is the schema the engine implements. The HTML prototype is one projection of it.

## The core claim

**The graph is a projection of an append-only event log.** It is not a stored document.

```
events (the truth, append-only)
   │  fold
   ▼
graph  { nodes, edges }          ← derived, cached, disposable
   │  render
   ▼
views  map · sources index · rollups · "what went stale"
```

This is the same substrate as the pipeline engine's event log. The design tool and the
pipeline are two projections over one log per project, not two systems.

## Nodes

One list. Every node carries a `kind` tag.

```ts
type Node = {
  id:   string
  kind: "card" | "source" | "excerpt" | "option"
  // payload varies by kind
}
```

| kind | What it is | Payload |
| --- | --- | --- |
| `card` | A decision, or an open question. `status` distinguishes them. | `title`, `why` (one line), `body`, `status`, `who` |
| `source` | A paper, benchmark, doc, or tool. Cited by many cards. | `title`, `url`, `finding`, `tier` |
| `excerpt` | A pointer into a conversation transcript, plus a cached copy of the text. | `session`, `msgIndex`, `span`, `text`, `speaker`, `context` |
| `option` | An alternative. Live or rejected. Never deleted. | `title`, `why_not`, `rejected_at` |

`status` is `decided | open | proto`. Staleness is **not** a status — it is derived from the
event log. See below.

`who` is `you | me | prototype`. The third value is the important one: neither of us can
decide by talking, so build something first.

## Edges

One list. Every edge carries a `type` tag. This replaces the earlier mix of a parent field,
a dependency array, and inline objects.

```ts
type Edge = { from: string, to: string, type: EdgeType }

type EdgeType =
  | "refines"         // card → card.  The level tree.
  | "depends_on"      // card → card.  Propagates staleness.
  | "supported_by"    // card → source | excerpt.  Flags for review only.
  | "alternative_to"  // option → card.  Kept forever.
```

Four types. IBIS survived 50 years on three. The grammar must stay small enough that the
agent can maintain it during live conversation — that is the constraint, not expressiveness.

**`relates_to` is banned.** It cannot be acted on.

### Why the two graphs are separate

| Graph | Shape | Gives |
| --- | --- | --- |
| `refines` | a tree | levels, breadcrumb, rollup bars, the fractal view |
| `depends_on` | a DAG | staleness, the reverse closure |

Where a card sits is not what a card depends on. `Trend checks` lives under *the loop* and
depends on `Merge on green CI`, which lives under *six stages*. That is why reopening one
decision turns cards red in a branch you are not looking at.

### Propagation rules differ per edge type

| Edge | On change of the target |
| --- | --- |
| `depends_on` | **Stale.** Reverse dependency closure, all hops, cost `O(\|S(v)\|)`. |
| `refines` | Children are reviewed, not invalidated. |
| `supported_by` | **Flag one hop.** A human decides whether the card still holds. |
| `alternative_to` | The option becomes live again when the card reopens. |

The distinction between `depends_on` and `supported_by` is implemented in the prototype.
Open any source page and press **Dispute this source**: its citers get an amber "review
evidence" badge. They do not go stale. Only a `depends_on` change does that.

### Why propagation cannot be a model call

On an invalidated-only split, single-hop validity scoring captures only **6% to 11%** of the
chain, regardless of chain length, because a single-hop judgement cannot see that an
upstream change invalidated a node two or three hops away
([arXiv 2606.26511](https://arxiv.org/pdf/2606.26511)).

So the edges must be recorded at creation time. There is no reconstructing them later.
That is a discipline cost on the agent, on every turn, forever.

The formal statement is in [Grokers, arXiv 2606.00050](https://arxiv.org/pdf/2606.00050):
mark `S(v)` stale, re-derive in topological order, and no node is stale. It is the
build-system model applied to meaning.

## Excerpts: keep both the text and the pointer

Question raised: if the quote is a literal copy, does a pointer add anything in practice?

Yes, five things. But the copy stays too — this is *and*, not *or*.

1. **You cannot verify that a copy is literal.** That is the whole problem. The agent writes
   these from a long context; a paraphrase and a quotation look identical on the page, and
   neither party can tell which is which. The pointer is what makes "literal" checkable
   instead of trusted.
2. **No surrounding context.** "I am unsure how we arrived here" usually needs the three
   messages around the quote, not the sentence. A pointer can expand; a copy cannot.
3. **Truncation is silent.** The agent cuts long quotes with an ellipsis. With a pointer the
   view can offer the rest.
4. **Reuse duplicates.** One message is already cited by two cards in the prototype. Same
   drift problem that made evidence a node.
5. **Cross-session provenance.** A copy cannot say which session or worktree it came from.

Keep the cached text because it makes the read path fast, works offline, and survives
session deletion. The same source recommends keeping the model off the read path: a
deterministic filter runs at about **2.1s** against **16–18s** for model-based verification.

```ts
type Excerpt = {
  id: string
  kind: "excerpt"
  session: string      // ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
  msgIndex: number
  span: [number, number]
  text: string         // cached literal copy. Fast path.
  speaker: "you" | "agent"
  context: string      // "Your value 4, verbatim"
}
```

## Events

```ts
type Event = {
  seq:   number
  at:    string          // ISO timestamp
  actor: "you" | "agent"
  type:  EventType
  payload: unknown
}

type EventType =
  | "node.added" | "node.retitled" | "node.bodyEdited"
  | "edge.added" | "edge.removed"
  | "status.set"
  | "reopened"           // the cause of staleness
  | "rederived"          // clears staleness for one node
  | "option.chosen"      // swaps an option with the live decision
  | "source.disputed" | "source.cleared"
  | "level.moved"        // promote or demote in the refines tree
```

Nothing is ever deleted. A removal is an `edge.removed` event, and the history keeps the
edge. "Mark stale, never delete" falls out of the model instead of needing a rule.

### What history buys

1. **"How did we arrive here" becomes a query**, not prose the agent writes. This subsumes
   the excerpt problem: the decision history and the transcript pointers are one mechanism.
2. **Time travel.** Render the map as of any `seq`. Useful for "what did we believe before
   the SpecBench finding arrived?"
3. **Step 6 gets data about the pipeline itself.** How often you reopen, which branches
   churn, which gate you reject at. That is the loop closing on the process, not the product.
4. **Replay and resume**, the same property the pipeline engine needs.

### Derived, never stored

- `stale` — computed from the latest `reopened` events and which nodes have been `rederived`
  since. The prototype already models this as a runtime set rather than a field, which is
  the correct instinct.
- `needsReview` — computed from `source.disputed` plus `supported_by`, one hop.
- rollups, counts, citation counts — all computed from the folded graph.

### Cost to be honest about

An event-sourced graph needs a projection and periodic snapshots to stay fast. And somebody
has to write the events: the agent, on every turn. That is cheaper than it sounds — appending
one event is a line, while editing a nested literal by hand is what the prototype does today
and it is already the slowest part of the loop.

## Open question

Where the log lives. By our own seam rule the graph is judgement, so it belongs in the
tracker — but a graph does not fit in an issue. The likely split: the log lives with the
project, and the tracker holds the decisions as they are made. That needs a prototype, not
an argument.

## Status of the prototype against this schema

| Schema element | `decision-map.html` |
| --- | --- |
| `card` nodes, `refines`, `depends_on`, reverse closure | done |
| `source` nodes, `supported_by`, flag-not-stale semantics | done |
| `option` nodes as kept alternatives, "choose this instead" | done, mutates in place |
| One typed edge list | **not done** — still a parent field plus arrays |
| `excerpt` nodes with pointers | **not done** — quotes are hand-written copies |
| Event log, history, time travel | **not done** — no persistence at all |
