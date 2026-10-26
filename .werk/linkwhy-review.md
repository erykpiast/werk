# depends_on reasons: low confidence and removed

Written on 2026-10-10 for #vi-prop-linkwhy. Fix a reason with `node src/cli.ts link <from> <to> --type depends_on --why "..."`.

## Removed (5)

- `rollup` -> `root`: Rollup counts a refines subtree; nothing in it uses the pipeline thesis of #root.
- `vi-sysdiag-render` -> `vi-sysdiag-grid-mincell`: The general intent/arithmetic split does not use the one-cell rule, which is a later detail of the grid child; direction looks reversed.
- `werk-test-scope` -> `werk-test-runner`: The scope rule is generic for any project; the runner choice applies it, not the reverse. Changing the runner cannot make the rule wrong.
- `werk-mc-tabs` -> `werk-reflink`: The tab strip uses card-id chips but nothing from prose card-id links; a change to link rendering cannot make the strip wrong.
- `vi-sysdiag-intent-edgecard` -> `vi-sysdiag-nodesplit`: Edge-line card placement uses nothing from the node split rule; the link likely reflects writing order.

## Kept, low confidence (48)

- `vi-edges` -> `vi-overwrite`: The small edge grammar must stay easy to maintain because #vi-overwrite makes the map rewritten each turn, not appended. _(Reason inferred; neither card states the link.)_
- `lp-rubric-prod` -> `werk-test`: The checks section, where an exit code decides, assumes a test harness that the agent can run itself, as #werk-test requires. _(Generic rubric linked to a werk-specific card; the dependency is indirect.)_
- `al-sample-agent` -> `al-sample-fork-options`: The sampler reports forks as clusters of samples, which #al-sample-fork-options turns into option cards with the samples as evidence. _(Not stated in the sampler card text; inferred from the pipeline order.)_
- `vi-sysdiag-grid-groupshape-shape-entry-coverage` -> `al-sample-fork-options`: The card is a sampled fork recorded as option nodes, in the form that #al-sample-fork-options gives every fork. _(The card only says it was found by sampling; the dependency on the option-card form is indirect.)_
- `vi-sysdiag-zoomui` -> `vi-sysdiag-grid-mincell`: The fit-by-default rule answers the size of the minimal grid that the one-cell rule from #vi-sysdiag-grid-mincell produces. _(The grid size is named, but the link to the one-cell rule is inferred.)_
- `werk` -> `vi-sysdiag`: The v0 scope includes the system diagram that #vi-sysdiag defines. _(The diagram appears only in the pending, not yet accepted, v0 body.)_
- `ro-inline` -> `ro-corner`: This card changes the unchallenged marker that #ro-corner placed on the rollup line and the card tile, so it builds on that choice. _(ro-inline contradicts ro-corner (ring vs filled dot); the edge records a revision, not a clear premise.)_
- `reopen-reason-gap` -> `ro-axes`: The gap concerns the stale marker, which #ro-axes shows on its own axis apart from status. _(Body is empty; the link to ro-axes is inferred from the STALE rendering.)_
- `werk-mc-asks` -> `werk-mc-fork`: A forked tab runs a second child, and that second child is what can block on an ask in its own tab. _(The fork card does not decide multiple children directly; the dependency is indirect.)_
- `werk-loop` -> `werk`: The loop scope is cut down to what v0 needs, and #werk defines what v0 is. _(werk also depends_on werk-loop, so this edge makes a cycle; the v0 framing is the only thing taken.)_
- `st-ticket-set-checks` -> `lp-checks`: The set checks follow the check layer rules: one command decides each, and the failure output is for the agent. _(The set-checks card does not cite lp-checks; the link is inferred from the word check.)_
- `vi-levels` -> `vi-onview`: Tree placement decides which page shows a card, because #vi-onview gives every card a page with its sub-cards below. _(Indirect: the body does not state why tree placement depends on the page layout.)_
- `werk-approve` -> `werk-edits`: Approval in the pane handles only the calls left after #werk-edits lets file edits run with no prompt. _(Weak: the link may reflect the order of writing; the two cards cite each other.)_
- `werk-hmr` -> `werk-dev`: The runtime choice serves the dev command of #werk-dev, which must reload src without killing live chat sessions. _(The text points the other way: #werk-dev cites #werk-hmr for its runtime.)_
- `vi-sysdiag` -> `vi-images`: The diagram keeps text as its stored form and renders the picture fresh, which is the rule #vi-images sets. _(vi-sysdiag does not cite vi-images; the link is indirect through the cached diagram text.)_
- `vi-sysdiag-agents` -> `vi-sysdiag-declare`: The scout's verdict names the kind of change, which carries the local-or-restructure statement that #vi-sysdiag-declare requires. _(Neither card text states this; the scout and updater split does not mention the declaration.)_
- `werk-test-visual` -> `werk-stack-framework`: The options weighed, such as browser mode through the client's own Vite config, exist because of the React and Vite stack. _(Playwright against a running server does not depend on the client framework; the tie is only through rejected options.)_
- `werk-loop` -> `werk-test`: The v0 loop and its pipeline tests are built and checked with the test harness that #werk-test sets up. _(werk-loop does not cite werk-test; the dependency is indirect.)_
- `st-build-run-mechanics` -> `st-build-parallel`: The guarded branch move assumes tickets build in parallel off the run branch tip, as #st-build-parallel sets. _(The text does not state the link; the guard may exist for resume safety alone.)_
- `pr-first` -> `pr-now`: The question exists because #pr-now builds the engine thin, driven by a first real work item. _(Body does not name pr-now; dependency inferred from the thin-build plan needing a first feature.)_
- `vi-sysdiag-agents` -> `vi-sysdiag-grain`: The scout judges the redraw scope, and the updater edits the one diagram file, as this card decides. _(Agents card body is empty; link inferred from the one-file, judged-scope rule.)_
- `werk-stack-hydration` -> `vi-onview`: The never-hydrated server-rendered card page assumes the one-card-per-view layout that this card decides. _(Hydration body does not name vi-onview; dependency inferred.)_
- `st-validate-steps` -> `lp-rubric`: The validate steps must fit the rubrics that already decide what is checked, graded, and held out. _(Card body is only 'Open.'; the dependency is a guess.)_
- `lp-rubric-prod` -> `stages`: The production rubric is the bar for merged code at the end of build, a stage this card defines. _(Text does not name stages; dependency is indirect.)_
- `st-build-seam` -> `werk-test`: The pipeline tests run in the agent-runnable test harness that this card defines. _(Seam body does not name werk-test; dependency inferred from the shared harness and fake agent on PATH.)_
- `werk-test-behaviours-always-rule-mechanism` -> `al-sample-fork-options`: The card judges the sampled option cards that this card turns each fork into. _(Dependency is on the sampling process form, not on content.)_
- `kill` -> `reopen-reason-gap`: A fired kill criterion needs a reopen reason kind, which this card names as missing. _(Kill body does not state this; #kill-fire maps a fired criterion to a reopen reason.)_
- `tk-verbs` -> `vi-backend`: The verbs form a tracker adapter whose role follows from the tracker being a publish target, not the store. _(The verbs include reads, so the tie to one-way publish is indirect.)_
- `lp-prod-review` -> `lp-two`: The review is an agent reading the diff, so it sits in the judgement layer of the two-layer split. _(The review is not graded against a card, so its fit in the judgement layer is inferred.)_
- `kill` -> `vi-prop`: A fired criterion leads to a reopen, and the depends_on propagation this card defines carries it to dependents. _(The cards do not state the link; the tie through reopen and propagation is inferred.)_
- `vi-flow-telemetry` -> `werk`: It counts status events in the log of the werk v0 tool that this card scopes. _(The dependency on the v0 scope card is indirect; the telemetry uses only the log.)_
- `lp-trend` -> `lp-rubric`: The trend report covers only cost across work items because the per-change rubric of #lp-rubric already judges one change. _(Trend sets itself apart from per-change gates; rubric is not named directly.)_
- `mvp` -> `pr-now`: The MVP's agreed brief comes from the thin engine of #pr-now, whose init turns a conversation into a brief. _(Link is indirect; MVP scope does not state it uses the engine.)_
- `vi-sysdiag-notbuilt` -> `vi-sysdiag-edges`: The not-built test assumes the parts list that #vi-sysdiag-edges takes from the cards, with the arrows still undecided. _(Card refines edges; that edge was marked stale; dependency is indirect.)_
- `werk-stack` -> `vi-onview`: The new stack must render the one-view-per-card layout that #vi-onview defines. _(Text does not mention the layout; the dependency is a guess.)_
- `werk-loop-unit` -> `lp-stateless`: A ticket must fit one fresh context, which follows from #lp-stateless giving each pass a fresh agent. _(Card only says a slice fits one fresh context; it does not cite the stateless loop.)_
- `lp-rubric` -> `stages`: The two rubrics map onto the stages of #stages: the prototype one serves plan, the production one gates merged build output. _(Rubric text does not name the stages; the mapping is inferred.)_
- `vi-sysdiag-grid-groupshape-shape-rectangle-check-scope` -> `al-sample-fork-options`: This card is a sampled fork whose options follow the option-card shape that #al-sample-fork-options defines. _(Dependency is on the card's form, not its content.)_
- `mvp-render` -> `tk-api`: The plain-text links section for edges a tracker cannot model follows the rule that ticket descriptions stay plain text. _(mvp-render does not cite tk-api; link inferred from shared plain-text ticket body.)_
- `werk-mc-split` -> `werk-mc-fork`: The home card names a forked conversation and marks the fork point from which changes under it are computed. _(Fork is mentioned only via the fork point; dependency is indirect.)_
- `werk-mc-recall` -> `werk-mc-fork`: Recall exists because each forked tab has its own session, so sibling turns after the fork must be pulled, not shared. _(The recall card does not mention forking; reason inferred.)_
- `vi-sysdiag-zoom` -> `vi-levels`: A project picks its own number of zoom levels, in the same way #vi-levels lets the agent place levels. _(The card cites vi-levels only as an analogy.)_
- `vi-sysdiag-derive` -> `vi-prop`: Taking edges from cards when they are decided follows #vi-prop: edges must be written at creation, since a model cannot recover them. _(derive does not cite vi-prop in its text; reason inferred.)_
- `werk-mc-nullgroup` -> `werk-mc-reload-storm`: The replay fix keeps tab hydration intact, which other tabs need to survive a change made in one tab. _(The bug is about tab-switch replay; the link to reload-storm is indirect.)_
- `werk-chat` -> `visual`: The chat is per card and sits beside the map, which stays the primary medium. _(werk-chat does not state the link; reason inferred.)_
- `vi-flowtab` -> `visual`: The Flow tab is one more view of the visual map, which stays the primary medium. _(The link is general; Flow refines visual too.)_
- `pr-wf-naming` -> `pr-wf-scope`: The rename aligns the mark with postponed, the reopen reason this card picks for out-of-scope work. _(Rename is mostly about naming consistency; it uses the postponed reason that pr-wf-scope confirms.)_
- `werk-test-subagent` -> `werk-wording`: The subagent adds a map card only for a real fork, written under the wording rule that this card defines. _(Link is thin: card cites werk-wording only for how a card it creates is worded.)_
