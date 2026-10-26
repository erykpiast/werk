# Research 3: semantic diff of a paragraph, beyond line/word diff (September 2026)

Collected 2026-09-12. Follow-up to `#al-diff`.

Question: `#al-diff` says an agent must show a diff of a proposed brief change, not a
rewrite. This research asks: does prior art exist for a diff at the **topic level**
inside one body paragraph? Given old and new versions of a paragraph made of several
sentences, can a tool detect which sentence-topics were elaborated, which are new, and
which were removed — then render each case differently?

---

## 1. Academic literature

| Source | Unit | Method | Core idea |
| --- | --- | --- | --- |
| **arXivEdits** — [arXiv 2210.15067](https://arxiv.org/pdf/2210.15067v2) | Sentence, then span inside a sentence pair | Neural CRF sentence alignment (93.8 F1), then span alignment with a fine-tuned semi-CRF/QA-Aligner model, refined with constituency-parse spans | Aligns sentence pairs across paper revisions. Inside each aligned pair, insertions and deletions are the unaligned tokens; a substitution is a non-identical aligned span. A separate classifier tags each edit with an intention (at least: Improve Language, Correct Grammar/Typo, Update Content, Adjust Format, with sub-types under each, 7 categories total; 78.9 F1). |
| **NewsEdits** — [arXiv 2206.07106](https://arxiv.org/pdf/2206.07106) | Sentence, across article revision history | Revision dataset plus a document-level reasoning task | Models how a news article changes across published versions. Confirms sentence alignment across versions is a standard first step before any edit-type classification. |
| **Edisum** — [arXiv 2404.03428](https://arxiv.org/html/2404.03428v2) | Sentence, from a diff already computed by another tool | Uses the existing `mwedittypes` library to pull added and removed sentences out of a Wikipedia diff, then an LLM writes a one-line human summary of the edit | This is a diff-to-summary pipeline, not a diff-alignment algorithm. `mwedittypes` itself is a rule-based diff tool, not a classifier of edit intent. Relevant because it shows an LLM can turn a plain add/remove sentence list into a readable description without any embedding math. |
| **Align (unified text-alignment model)** — [arXiv 2307.02729](https://arxiv.org/abs/2307.02729) | Sentence-to-sentence or sentence-to-passage pair | One trained model scores entailment, similarity, and factual consistency between two text spans, in place of five separate NLP tasks | General-purpose scorer. Could replace a hand-tuned similarity threshold when deciding if two sentences are "the same topic, elaborated" versus "a new topic." |
| **Diff-XYZ** — [arXiv 2510.12487](https://arxiv.org/pdf/2510.12487) | Whole diff hunks (originally code, general diff format) | Benchmark that tests whether an LLM can read a diff and correctly describe what changed | Confirms LLMs are being tested specifically on diff-understanding as a skill, separate from diff-generation. Supports using an LLM as the classifier step, not only as the writer. |
| Optimal transport / Hungarian algorithm for sentence-embedding alignment — see [Optimal Partial Transport Based Sentence Selection](https://aclanthology.org/2022.coling-1.208.pdf) and [Unbalanced Optimal Transport for Word Alignment](https://arxiv.org/pdf/2306.04116) | Sentence or word, via embedding vectors | Build a cost matrix from cosine similarity between sentence embeddings. Solve an assignment problem (Hungarian algorithm) or a soft assignment (Sinkhorn/optimal transport) to match old sentences to new sentences | This is the general technique behind "match sentence A in the old body to sentence B in the new body, even if the wording changed." No paper found applies it specifically to short-document diff review UX; it is machine-translation and cross-lingual-embedding literature. |

**Reusability for a short brief (title + why line + a few-sentence body):** arXivEdits and
the optimal-transport alignment technique are the two directly reusable ideas. Both assume
you already have sentence-level embeddings or a trained aligner. Building either from
scratch is too much machinery for a paragraph of five sentences.

---

## 2. Open source tools and libraries

| Tool | Unit | Match/align algorithm | Notes |
| --- | --- | --- | --- |
| **Wikidiff2** — [MediaWiki extension](https://www.mediawiki.org/wiki/Extension:Wikidiff2), [how we improved it](https://www.mediawiki.org/wiki/Wikidiff2/How_we_improved_Wikidiff2) | Line/paragraph, with a word-level pass inside a matched pair | Similarity between two lines is estimated from changed character count. Two tunable thresholds: `changeThreshold` (treat as a word-level change) and `movedLineThreshold` (treat as a moved paragraph). Above `maxMovedLines` (default 100), move detection is skipped entirely for performance. | Confirmed limit: sentence-level diffing is a long-standing, still-open feature request ([Phabricator T26617](https://phabricator.wikimedia.org/T26617)). Wikidiff2 stops at the paragraph/line boundary; it does not split a paragraph into sentence-topics. |
| **mwedittypes** — used by Edisum, see [arXiv 2404.03428](https://arxiv.org/html/2404.03428v2) | Sentence | Rule-based diff extraction on top of a wikitext parse. Outputs an added-sentence list and a removed-sentence list. | No semantic classification of the edit. It only labels a sentence "added" or "removed," never "same topic, changed." |
| **prose-diff** — [github.com/berkdurmus/prose-diff](https://github.com/berkdurmus/prose-diff) | Sentence and paragraph, with word-level highlights inside a matched pair | README advertises "semantic matching for rephrased content" and three view modes (side-by-side, inline, hybrid) but does **not** document the matching algorithm in the README. Source code inspection would be required to confirm it. | Closest named match to "semantic diff for prose" found anywhere. Treat the algorithm claim as unverified until the source is read directly. |
| **chopdiff** — [github.com/jlevy/chopdiff](https://github.com/jlevy/chopdiff) | Word (whitespace, sentence break, and paragraph break are each one token) | LCS-style token diff via `cydifflib` (a faster reimplementation of Python's `difflib`) | Adds a filtering layer on top of a plain word diff: keep only insertions, only whitespace changes, only lemma changes, and so on. This is a good pattern (filter a generic diff by edit type) but the filter categories are lexical, not topic-level. |
| **graphtage** — [github.com/trailofbits/graphtage](https://github.com/trailofbits/graphtage) | Tree node (JSON, XML, YAML, CSV) | Formal tree-edit-distance algorithm over a typed tree | Built for structured data, not prose. Relevant only as a model for "diff a brief as a small tree" (title-node, why-node, body-node, sentence-nodes) instead of as flat text. |
| **diffsitter** — [github.com/afnanenayet/diffsitter](https://github.com/afnanenayet/diffsitter) | AST node, via tree-sitter | Diffs the parsed syntax tree, not the raw text, so formatting-only changes disappear | Same category as graphtage: proof that "parse into nodes, then diff the nodes" is a normal pattern outside prose. No prose grammar is anywhere near as reliable as a code grammar, so this does not transfer directly to sentence-topic detection. |
| **diff-match-patch** (Google) — the standard baseline | Character, then word | Bisection-based Myers diff | Cited here only to state its limit plainly: it has no concept of a sentence or a topic. Two sentences that mean the same thing but share no words show as a full delete plus a full insert. This is the exact failure `#al-diff` is trying to avoid. |
| **Omnisearch "Semantic Diff"** blog implementation — [omnisearch.ai/blog/semantic-diff](https://omnisearch.ai/blog/semantic-diff) | Sentence | Split both texts into sentences. Embed each sentence with `paraphrase-MiniLM-L6-v2`. Compute cosine similarity for every old-sentence/new-sentence pair. Pairs above a 0.7 threshold: unchanged. Below: changed. Render like `git diff` — red for the old sentence, green for the new one. | The single most concrete, buildable recipe found in the whole search. No alignment algorithm (Hungarian/optimal transport) is used — it is a simple threshold, not an assignment problem, so it can mismatch when two old sentences both look similar to one new sentence. |

**Reusability for a short brief:** the Omnisearch recipe (embed each sentence, cosine
similarity, threshold) is the most directly buildable piece of open source prior art. It
still needs a real assignment step (Hungarian algorithm on the similarity matrix) to avoid
double-matching, which is a well-known, small amount of code (`scipy.optimize.linear_sum_assignment`
or equivalent).

---

## 3. Product implementations

| Product | What it shows | Source |
| --- | --- | --- |
| **Notion** — Suggested Edits + Snapshot Diffs | Suggested Edits is track-changes for human collaborators (accept/reject per suggestion). Snapshot Diffs is a separate version-history view that highlights what changed between two saved snapshots, across text, images, tables, and database properties. | [Notion 2.43 release notes](https://www.notion.com/releases/2024-07-29), [Snapshot Diffs coverage](https://www.createwith.com/tool/notion/updates/notion-adds-snapshot-diffs-to-version-history-for-easier-change-tracking) |
| **Google Docs "Suggesting" mode** | Word-level track-changes, the same family as Word's Track Changes. No semantic or topic-level grouping. | Well known; no primary engineering blog found describing internal diff logic. |
| A practitioner's own "visual diff for AI edits" ("git blame for LLM changes") | Applies Myers' diff algorithm to a token sequence, classifies each change as an addition, deletion, or substitution, and color-codes them (green/red/yellow) in a live preview pane. Batches re-render work by paragraph, because re-diffing a full long document per keystroke was too slow. | [Medium: Building a Visual Diff System for AI Edits](https://medium.com/illumination/building-a-visual-diff-system-for-ai-edits-like-git-blame-for-llm-changes-171899c36971) — note: page returned HTTP 403 on direct fetch; description here is from the search index summary, not a confirmed direct read. Treat as lower-confidence until re-verified. |

**Gap found:** no product blog post, docs page, or changelog was found that describes
topic-level diff rendering for AI-authored prose edits — i.e., none of the checked products
detect "this is the same claim, reworded" versus "this is a new claim" and render the two
cases differently. Every real product found stops at the word/line level (Notion, Google
Docs) or the sentence-added/sentence-removed level (Wikipedia tooling). The topic-aware
classification this question asks about does not appear to exist yet in a shipped product.

---

## 4. Synthesis and recommendation

### What exists

1. A trained-model version exists (arXivEdits): sentence alignment, span alignment, and an
   edit-intention classifier, at 78 to 94 F1. This is real, published, and reusable in
   principle. It needs a trained CRF alignment model and a trained intention classifier. That
   is too much infrastructure for one short brief.
2. A lightweight version exists (Omnisearch blog): sentence embeddings, cosine similarity,
   one threshold, colored like a normal diff. This is a five-sentence idea, not a research
   system. It has one known weak point: a plain threshold can match one new sentence against
   two old sentences at once. The fix is a one-line addition (linear sum assignment on the
   similarity matrix), not a new subsystem.
3. No product ships topic-level diff rendering for AI-authored prose today. The state of
   the art in shipped tools is word-level (Notion, Google Docs) or sentence-added/removed
   (Wikipedia).

### Answer to "is full semantic/topic-level diff overkill?"

Yes, for this use case. A brief has a title, a one-line why, and a body of a few
sentences. A trained aligner is built for pages of prose across many revisions. A brief
does not have "many revisions of many pages." It has one small paragraph, edited by one
agent, reviewed by one person.

### The buildable design for this tool

Do not build sentence embeddings or an alignment model. Use the LLM that is already
proposing the change as the classifier, in the same call that produces the new brief:

1. Split the old body and the new body into sentences (simple, done in code — a period/
   question-mark/exclamation-mark splitter is enough at this scale; no NLP library needed).
2. Ask the LLM, in the same turn it proposes the edit, to output a small structured list:
   for each new-body sentence, say which old-body sentence (if any) it corresponds to, and
   label the pair one of three tags: `elaborated` (same topic, changed wording),
   `new` (no matching old sentence), or state which old sentences have no match at all
   (`removed`).
3. Render by tag:
   - `elaborated` pairs: run a normal word-level diff (diff-match-patch or an LCS token
     diff, same idea as `chopdiff`) between the matched old and new sentence, and show
     inline word-level highlighting.
   - `new` sentences: show as a plain addition, no word diff inside them.
   - `removed` sentences: show as a plain deletion.

This reuses one real, working idea from each layer of the research: the three-way tag
(`elaborated` / `new` / `removed`) is the small-scale version of arXivEdits' intention
classifier; the "word-diff only inside a matched pair, plain add/remove otherwise" split is
exactly the Wikidiff2 pattern (word-level diff only after a paragraph is judged "changed,"
not "moved" or wholly new); and using the LLM itself as the classifier, instead of training
one, follows Edisum's pattern of asking a language model to describe a diff that was
computed by simpler, non-semantic means.

The one risk: LLM sentence-matching is not guaranteed consistent between calls. Mitigation:
keep the classification step separate and deterministic-checkable — require the LLM to
quote the exact old sentence it claims a new sentence corresponds to, then verify that
quote against the actual old body in code before rendering. If it does not match, fall back
to treating the sentence as `new` plus the unquoted old sentence as `removed`. This keeps a
wrong LLM classification from ever silently producing a wrong diff.

---

## Sources

### Academic
- [arXivEdits: Understanding the Human Revision Process in Scientific Writing — arXiv 2210.15067](https://arxiv.org/pdf/2210.15067v2)
- [NewsEdits: A News Article Revision Dataset — arXiv 2206.07106](https://arxiv.org/pdf/2206.07106)
- [Edisum: Summarizing and Explaining Wikipedia Edits at Scale — arXiv 2404.03428](https://arxiv.org/html/2404.03428v2)
- [Text Alignment Is An Efficient Unified Model for Massive NLP Tasks — arXiv 2307.02729](https://arxiv.org/abs/2307.02729)
- [Diff-XYZ: A Benchmark for Evaluating Diff Understanding — arXiv 2510.12487](https://arxiv.org/pdf/2510.12487)
- [Optimal Partial Transport Based Sentence Selection — ACL Anthology 2022.coling-1.208](https://aclanthology.org/2022.coling-1.208.pdf)
- [Unbalanced Optimal Transport for Unbalanced Word Alignment — arXiv 2306.04116](https://arxiv.org/pdf/2306.04116)

### Open source
- [Wikidiff2 — MediaWiki extension](https://www.mediawiki.org/wiki/Extension:Wikidiff2)
- [How we improved Wikidiff2 — MediaWiki](https://www.mediawiki.org/wiki/Wikidiff2/How_we_improved_Wikidiff2)
- [T26617: Implement diff on sentence level — Phabricator](https://phabricator.wikimedia.org/T26617)
- [prose-diff — berkdurmus/prose-diff on GitHub](https://github.com/berkdurmus/prose-diff)
- [chopdiff — jlevy/chopdiff on GitHub](https://github.com/jlevy/chopdiff)
- [graphtage — trailofbits/graphtage on GitHub](https://github.com/trailofbits/graphtage)
- [diffsitter — afnanenayet/diffsitter on GitHub](https://github.com/afnanenayet/diffsitter)
- [Semantic Diff — Omnisearch blog](https://omnisearch.ai/blog/semantic-diff)

### Product
- [Notion 2.43 release notes: Suggested edits](https://www.notion.com/releases/2024-07-29)
- [Notion adds Snapshot Diffs to Version History](https://www.createwith.com/tool/notion/updates/notion-adds-snapshot-diffs-to-version-history-for-easier-change-tracking)
- [Building a Visual Diff System for AI Edits — Medium (Abhiram Nair)](https://medium.com/illumination/building-a-visual-diff-system-for-ai-edits-like-git-blame-for-llm-changes-171899c36971) (fetch blocked with HTTP 403; content above is from the search index summary only)

### Research gaps
- No paper or product was found that names "topic-level diff" or "claim-level diff" for a
  short document as its own studied problem. Every academic hit found operates at
  sentence-pair or span level, not "several sentences that each carry one distinct topic
  inside a single paragraph."
- The `prose-diff` GitHub repository claims semantic matching but its README does not state
  the algorithm. This needs a direct source-code read to confirm the claim, which was out of
  scope for this pass.
