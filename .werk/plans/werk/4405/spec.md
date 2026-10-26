# Spec: werk v0

## Problem Statement

A person who builds software with Claude Code works in a chat transcript. The transcript only grows. The decisions that the conversation settles are buried in it, and nobody can see which decision rests on which other decision. When one decision changes, nothing marks the decisions that depend on it (#visual).

The person also cannot see the build. An agent that builds from the decisions works in a terminal. The person does not see which slice of work runs, which one failed, or why. A build needs a person at every step, because nothing keeps an agent from getting stuck and nothing checks its work against what was decided.

werk has a working prototype of the answer. Its code was written to find the right shape, not to keep. The person needs a clean v0, built from scratch in a new repository and only from the decided cards, so that the cards prove they are enough to rebuild the behaviour (#werk-base, #werk-base-repo). The prototype's behaviour sets the bar.

## Solution

werk v0 is a visual layer over Claude Code with three views: the map, the board, and the chat (#werk).

1. **The map** draws the fold of an append-only log of decisions (#pr-log, #werk-write). Each card has a reason, typed links, options, sources and excerpts. A card that an agent adds is a ghost until the person accepts it (#werk-propose-new). A card cannot become decided until a program check passes (#werk-contract). A change marks the next hop stale; a postponement pauses everything downstream (#vi-prop, #pr-wf-paused). A reference to a card in any text is a link (#werk-reflink), and fenced code renders boxed and highlighted (#werk-codeblock).
2. **The chat** sits beside the map. A message goes to a live Claude Code agent with the open card as context, the reply streams back, and the map redraws when the agent writes to it in the same turn (#werk-chat, #werk-onechat). A person can keep more than one conversation.
3. **The board** shows the tickets of a build in five columns, with a plan card per planned subtree. The person starts a build from a decided card, triggers one ticket early, and archives or restores a ticket (#werk-board).

Behind the board, the inner build loop turns a decided subtree into merged, tested code with no person in the middle (#werk-loop): one spec, then tickets, then a builder loop per ticket, then a merge loop over the tickets, with a held-out set the builder never sees and an overseer that keeps every agent from getting stuck. Every build is a feature build, so every gate waits for the person (#werk-loop-tier).

One werk server holds many projects, with a project switcher in the header (#werk-projects). It runs on Bun, with a React and Vite client inside the same process, and it reloads its own modules without killing a live agent (#werk-stack, #werk-hmr, #werk-dev). It ships as one executable per platform (#werk-dist). Every change passes lint, typecheck, unit tests with a coverage gate, and browser tests before it merges and again on a clean machine after (#werk-checks). A person or an agent starts work on werk from the repository and the map alone (#werk-devex, #werk-cc).

## User Stories

### The log and the map

1. As a person, I want every change to the map to be one event at the end of a log, so that nothing I decided is ever lost (#pr-log).
2. As a person, I want the map to be the fold of the log, with only the latest title, why, body and links of each card, so that I read the current state (#pr-log, #vi-overwrite).
3. As a person, I want adding a card under a parent to be one event, so that the log shows one change where I made one (#pr-log-one-event).
4. As a person, I want a bad line in a committed log to be set aside with its place in the log, so that one bad event never hides the whole map (#pr-log-refuse).
5. As an agent, I want a write that breaks a map rule to be refused and to append nothing, so that I never add a bad line (#pr-log-refuse).
6. As a person, I want the stale, paused and postponed marks to come from the fold, so that every rule and every view sees the same marks (#pr-log-fold-marks).
7. As a person, I want no view to edit a drawn card in place, so that the log stays the only store (#werk-write).
8. As a person, I want every open page to read the whole map again when the log grows, so that every view stays in step with the log (#werk-write-changed).
9. As a person, I want a page to fetch the whole map each time its live channel connects, so that a write made while the server was down still shows (#werk-write-watch-start).
10. As a person, I want each card page to show the detail on top and the sub-cards below, with the address naming the card, so that I learn one layout and can share a view (#vi-onview, #vi-routes).
11. As a person, I want the root view to be the page of the card #root, and a home view that shows the requirements and the build rules side by side, so that I find both trees on the first screen (#vi-onview-root, #vi-home-howwhat).
12. As a person, I want each card drawn the same way in its page and in its tile, with a status edge, marks, a who label and a rollup bar, so that I learn the marks once (#vi-onview-look, #vi-onview-hero, #vi-onview-subcards, #rollup, #ro-axes).
13. As a person, I want a card page to show its options, evidence, excerpts and link lists with each link's reason, so that every card carries its own proof (#vi-detail, #vi-onview-links).
14. As a person, I want breadcrumbs, view tabs, counts and a search box in the header, so that I always know where I am and can open any card (#vi-layout, #vi-crumbs, #vi-tabs, #vi-counts, #vi-jump).
15. As a person, I want a `#card-id` in any card text, note or chat message to link to that card, with one look for every form, so that a reference is never a dead string (#werk-reflink, #werk-reflink-label, #werk-reflink-guard, #werk-reflink-inview).
16. As a person, I want fenced code in a card to render boxed and highlighted by any common tag name, and plain for an unknown tag, so that code reads as code (#werk-codeblock, #werk-codeblock-langs).

### Writing through the command line

17. As an agent, I want the command line to be my only write path to the map, with one verb per operation, so that the log records every change (#werk-write, #werk-cli).
18. As an agent, I want a card id with or without a leading # to work in every command, so that I can paste a reference as it is (#werk-cli-hash-id).
19. As a developer, I want each verb to register itself from its own module, so that two tickets that add different verbs touch no shared module (#werk-verb-registry).
20. As an agent, I want a search operation over the decided cards, and a find operation over open and proto cards that skips paused, stale and postponed cards, so that I find context and work (#werk-cli-search, #werk-find, #werk-find-scope).
21. As an agent, I want a show operation that prints one card with its rollup, links, marks and the words of its options, excerpts and sources, so that I read the same proof a person sees (#werk-cli-show, #vi-detail-cli-proof).
22. As an agent, I want a staleness listing in fix order, with the reason for each mark, so that I clear marks in the right order (#werk-cli-stale).
23. As an agent, I want to write a note on a card and to read the notes in an inbox, so that I answer on the card the person reads (#werk-cli-notes).

### Proposals, removal and the contract

24. As a person, I want every card, option, source and excerpt that an agent adds to enter as a ghost, so that nothing enters the map without my accept (#werk-propose-new, #werk-cli-add).
25. As a person, I want a ghost's words frozen, while links, status and who still work on it, so that what I accept is what I read (#werk-propose-new).
26. As a person, I want to accept one ghost at a time with a ✓, and the accept to take its ghost parents, options and evidence with it, so that a click cannot orphan a card or leave it without proof (#werk-propose-new, #werk-propose-new-carry, #al-diff-cli-btn).
27. As a person, I want a discard to drop a ghost's descendants and its own excerpts, but keep a source that another card still cites, so that no evidence is lost by mistake (#werk-propose-new-carry).
28. As a person, I want a corrected ghost to keep the notes that led to its new words, with a marker where the new words begin, so that I see why it changed (#werk-propose-new-discard-thread).
29. As a person, I want a change to a decided card to be a proposal that I see as a diff, and an accept to amend the card, so that its dependents learn of the change (#al-diff, #al-diff-cli, #al-diff-render, #map-frozen, #werk-cli-propose).
30. As a person, I want an op list that leaves a block of the body unnamed to be refused, so that no block disappears without a mark (#al-diff-cli-cover).
31. As a person, I want to remove a card and its refines subtree with a ✕, or move its children up, and restore it later exactly as it was, so that cleanup is never final (#werk-remove, #vi-remove-btn, #vi-remove-btn-reparent, #werk-remove-restore-undo).
32. As a person, I want a removed card's links to wait and its id to stay taken, so that a restore gives back the map as it was (#werk-write-remove-links).
33. As a person, I want a card to need who, a basis, an option when I decide it, and a kill criterion before it is decided, so that the map's rules are enforced, not prose (#werk-contract, #werk-contract-facts, #werk-cli-decide, #werk-cli-edit, #kill-ask).
34. As an agent, I want a refused decide to list every missing fact with the command that fixes it, so that I fix the card in one pass (#werk-contract-all-missing, #werk-contract-fix).
35. As a person, I want a waiver of a fact to need a written reason, so that a waiver is never mistaken for a forgotten fact (#werk-contract-waiver-reason, #werk-contract-guess).
36. As a person, I want a card with no who to need an option too, so that a bare card is refused only once (#werk-contract-no-decider).
37. As a person, I want a change to a decided card refused only when it removes a fact the card had, so that an old card can always receive a missing fact (#werk-contract-amend-scope).

### Staleness and reopen

38. As a person, I want a reopen or an amend to mark only the direct dependents and direct children stale, so that one change does not mark dozens of cards (#vi-prop, #vi-prop-amended).
39. As a person, I want a postponed reopen to pause every card downstream, and the postponed card itself to carry the postponed mark, so that I see work that waits (#pr-wf-paused, #pr-wf-postponed, #pr-wf-paused-reach, #pr-wf-naming).
40. As a person, I want deciding a postponed card again to clear the paused marks it caused, so that work resumes with one action (#pr-wf-paused-resume).
41. As a person, I want a paused card to still count as a basis, so that a postponement does not block work that only reads its content (#pr-wf-paused-basis).
42. As a person, I want a link made after a change to carry no mark from it, and a card on a stale basis to wait instead of going stale, so that new cards are not born stale (#vi-prop-bornstale, #map-wait).
43. As a person, I want each mark to show its trace, with the change, the reopen reason, the link and its reason, and for a pause the path, so that I can judge it without a log query (#vi-prop-trace, #vi-prop-trace-reason, #vi-onview-stale, #werk-depwhy).
44. As a person, I want a review of a stale card to end in a confirm or an amend, and a confirm to need each link reason confirmed, so that no mark is cleared unread (#rederive-reason, #werk-cli-reopen).
45. As an agent, I want a depends_on link to need a reason, and a link to an ancestor or descendant to be refused, so that the links stay meaningful (#vi-prop-linkwhy, #vi-prop-nolineage, #werk-cli-link).
46. As a person, I want a postponed card drawn with grey stripes and a postponed tag, so that I tell parked work from open work at a glance (#vi-onview-postponed).

### Excerpts

47. As an agent, I want a quote operation that finds text verbatim in one spoken message of a conversation and writes an excerpt ghost with its pointer, so that every quote is extracted, not written from memory (#werk-excerpt, #werk-excerpt-pointer).
48. As an agent, I want a quote that matches zero times, or more than once anywhere in the transcript, to fail and say which case it found, so that the program never guesses (#werk-excerpt-once).
49. As a person, I want an excerpt's words never to change after the quote, and the excerpt to arrive with its link from the citing card as one change, so that a reader can trust it (#werk-excerpt-event).

### The chat

50. As a person, I want to send a message with the open card as context and see the reply stream in while the agent works, so that I never copy a decision into the map by hand (#werk-chat, #werk-onechat, #werk-progress).
51. As a person, I want each part of a reply to stay under the message that asked for it, with a waiting mark on a message whose turn has not started, so that I can send while a reply streams (#werk-chat-turn-id).
52. As a person, I want every turn to name the card I have open, and a turn sent from the whole tree to name the home card, so that "this card" always means something (#werk-card-blind, #werk-chat-no-card-line).
53. As a person, I want each conversation to have its own agent process with a home card, and to keep more than one conversation, so that topics do not bleed into each other (#werk-chat-stdin, #werk-mc-split).
54. As a person, I want a restart of the server to resume each conversation with its model and context fill, so that editing werk does not lose a conversation (#werk-resume, #werk-model-persist).
55. As a person, I want a tool call that Claude Code cannot resolve to appear as a question in the pane, with only the buttons that can act, and an agent's question to appear as a form, so that I answer without leaving the map (#werk-approve, #werk-perm-native, #werk-perm-mode, #werk-approve-bar, #werk-mc-askqa).
56. As a person, I want tool calls to collapse into one line per run, Markdown to render, and a pasted screenshot to upload at once and reach the agent as a path, so that the transcript stays readable (#werk-tool-collapse, #werk-progress, #werk-shots, #werk-shot-chip, #werk-chat-image-inline).
57. As a person, I want a model selector and a context-fill pie with a clear-context action next to the composer, so that I control cost and see when the window fills (#werk-model-select, #werk-context-pie, #werk-head-bottom).
58. As a person, I want a slash or a # in the composer to open a menu of commands or cards, so that I see what can be typed (#werk-chat-cmdmenu, #werk-hash-trigger).
59. As a person, I want a suggested next action to be a button, a dead agent to show its whole error and mark its tab, and a running background agent to show a line, so that no state is hidden (#werk-mc-nextbtn, #werk-crashmsg, #werk-fullerr, #werk-mc-live-dead, #werk-mc-bgagents, #werk-mc-bg-line, #werk-mc-live-bgcount).
60. As a person, I want a request that starts an agent or writes anything to need the server token and a loopback Host, so that no other site or machine can run code on my machine (#werk-serve-trust).
61. As a person, I want a chat reply to name a map operation, not the command line, so that I know what to do in the map (#werk-chat-opnames).
62. As a person, I want switching to a conversation to show its newest message, so that I see where it is now (#werk-mc-tab-bottom).

### Agent instructions

63. As a project owner, I want every agent that werk starts with write access to the map to get the werk agent instructions appended to its own system prompt, with the subagents they name, so that it follows the map's rules in any project (#werk-agent-instructions, #werk-agent-instructions-append, #werk-agent-subagents, #werk-agent-selfcontained).
64. As a project owner, I want every stage agent to start with the titles of all build-rule cards, so that it follows the project's build rules without searching for them (#st-build-howto, #st-build-howto-titles).

### The board

65. As a person, I want a board with the columns blocked, ready, building, merging and done, so that I watch the build as it runs (#werk-board-columns, #vi-board).
66. As a person, I want a ticket card that shows its title cut to two lines, a live dot in its corner while a session runs, and counts for retries and open blockers, so that I scan a column fast (#vi-board, #vi-board-title-clamp, #vi-board-pulse-corner, #werk-board-colwidth).
67. As a person, I want a drawer with the ticket's slice, its metadata, its decisions and a live log preview while it builds, so that I see what one ticket does (#vi-board, #vi-board-details, #vi-board-ticket-decisions-2).
68. As a person, I want a ticket to pulse only while its board log says a session started and its process is alive, so that a killed builder never pulses forever (#vi-board-session-file).
69. As a person, I want to reorder ready tickets, trigger one ready ticket early inside a run, and archive a ticket with a confirmation, so that I control the build order (#werk-board-control, #werk-board-control-archive-ends-build).
70. As a person, I want an archived ticket to be restorable to the column it left, so that an archive is never final (#st-ticket-restore, #werk-cli-ticket-restore).
71. As a person, I want a plan card per planned subtree below the columns, colored by its state, with the writers' log and the spec, so that I see that a plan runs and why it stopped (#vi-board-plan).
72. As a person, I want one press of Build on a decided card to plan its subtree and run the merge loop as one detached process, so that an overnight build needs nobody between plan and run (#werk-board-build-subtree).
73. As a person, I want a subtree with unfinished work to offer Resume or a confirmed Restart, and a run on an ancestor to disable both, so that two runs never race (#werk-board-restart, #vi-board-plan-controls, #st-run-start-guard).
74. As a person, I want ticket state in its own append-only board log, so that build churn stays out of the decision record (#vi-board-state).

### Planning

75. As a person, I want a plan over a decided subtree to read the subtree and every decided card it rests on, followed down and never up, so that the planner invents no decision (#st-spec-linked).
76. As a person, I want the plan to end in one spec with user stories and test seams, then tickets split from it, so that the tickets split one agreed whole (#st-spec, #st-ticket, #st-ticket-stories).
77. As a person, I want every answer that a writer gives and no card gives to come back as a ghost under the subtree root, so that I see and can reopen it (#st-spec-answers, #st-spec-decisions, #werk-align-v0).
78. As a person, I want each ticket in one fixed format, checked by eight own checks and three set checks, so that a malformed ticket never builds (#st-ticket-shape, #st-ticket-own-checks, #st-ticket-set-checks, #st-ticket-partial).
79. As an agent, I want a ticket-check operation that runs on a folder of tickets and prints one line per failure with exit 0, 1 or 2, so that I can check tickets without a plan (#st-ticket-checks-run, #werk-ticket-check-verb, #werk-ticket-check-verb-form).
80. As a person, I want a second plan of the same subtree to extend its spec and open tickets, and to archive tickets the spec no longer needs, so that no duplicate set appears (#st-plan-extend, #st-plan-archive).
81. As a person, I want a change to a cited card to block every open ticket that cites it, so that no ticket builds an old decision (#st-ticket-watch).
82. As a person, I want each project to build into its own target repository, so that werk's store never mixes with the code it builds (#st-build-target, #werk-cli-build).

### The builder loop

83. As a person, I want each ticket built by fresh passes in its own worktree, each pass running checks, then the grader, then five reviewers, so that a ticket is done only when it passes all three (#st-build-ticket, #st-build-ticket-order, #lp-stateless).
84. As a person, I want each pass to run the /implement skill on the whole ticket, its stories, its cited cards, their rejected options and the last failure, so that the builder has all it needs (#st-build-implement).
85. As a person, I want a builder to get the index of decided cards and search the map before it decides a question, and to propose a card for a decision no card gives, so that it never contradicts a decided card (#st-build-implement-search, #st-build-missing-decision).
86. As a person, I want every build to open a card obligation that a pass closes with a proposed card or with the cards it followed, so that a pass never changes code and leaves the map silent (#st-build-card, #werk-cli-followed).
87. As a person, I want checks to be make targets whose exit code is the verdict, with one rerun to detect a flaky check, so that a flaky check never costs a pass (#lp-checks, #lp-checks-scripts, #ms-fail-cause).
88. As a person, I want the grader to score each acceptance criterion, each card in the closure and one scope line, and the reviewers to judge five quality areas, both with read-only tools, so that the diff is checked against the cards and against good code (#lp-prod-judge, #lp-prod-judge-scope, #lp-prod-review, #lp-prod-judge-read-only).
89. As a person, I want a retry cap that a spec-gap pass and a conflict pass do not count against, so that a decision pass always runs and a stuck ticket still stops (#st-build-cap-spec-gap, #st-build-conflict).
90. As a person, I want a finished build to move its ticket to merging when green or back to ready at the cap, so that the building column shows only live builds (#st-build-ticket-hand-off).
91. As a person, I want a build whose process died to restart as a fresh pass from its branch, so that a crash does not stop the run (#st-build-died).

### The merge loop and the held-out set

92. As a person, I want the merge loop to merge one ticket at a time onto the main line after the checks pass on the main line plus the ticket, so that the main line stays green (#st-build-run, #st-build-run-mechanics, #st-plan-main).
93. As a person, I want up to 3 tickets to build at once only when they touch no common module, so that independent tickets build in parallel without conflicts (#st-build-parallel).
94. As a person, I want a merge conflict resolved on the ticket's own branch, with that ticket merged next, so that a busy file does not starve a ticket (#st-build-conflict-resolve).
95. As a person, I want a stuck ticket to block only itself and the tickets that need it, and a stopped loop to move its tickets back to ready, so that one failure does not stop the run (#st-build-stuck-park, #st-build-stop-ready).
96. As a person, I want a step author to write Given/When/Then steps from each ticket's brief, and a binder to turn them into browser tests, so that part of the bar stays out of the builder's sight (#lp-prod-heldout, #lp-heldout-steps, #lp-heldout-author, #lp-heldout-binder, #lp-heldout-mechanics).
97. As a person, I want the held-out set of merged tickets to run beside the merge queue after each merge, and a red step to file one follow-up per source ticket, so that a break is found where it starts (#st-validate-heldout, #st-heldout-beside, #st-heldout-merged-only, #st-heldout-followup-per-ticket, #lp-heldout-feedback).
98. As a person, I want a step the binder could not run to show as not run, and a step whose source card changed to be rewritten before it can file work, so that a red badge always means a real break (#st-heldout-notrun, #st-heldout-step-fresh).
99. As a person, I want G2 to wait until every held-out step is green, and only me to pass it, so that I never approve a known break (#st-g2-heldout, #werk-loop-tier, #st-tier-default).

### The overseer

100. As a person, I want an overseer timer inside each build pass that cancels a session silent for 60 seconds after its first event, counting every token as an event, so that a stalled agent never holds the run (#lp-overseer, #lp-overseer-silence, #lp-overseer-silence-start, #lp-overseer-silence-tokens, #st-build-silence-act).
101. As a person, I want the overseer to tell a working tool call from a frozen one by CPU time, and to treat a failed process probe as unknown, so that a long build is not cancelled (#lp-overseer-inflight, #lp-overseer-psfail, #lp-overseer-mechanics).
102. As a person, I want the overseer to answer a builder's permission ask through a classifier, and a classifier to judge every 5 minutes whether the agent loops, so that no ask waits for nobody (#lp-overseer-asks, #lp-overseer-progress, #lp-overseer-det, #lp-overseer-scope).

### Projects

103. As a person, I want one werk server to hold many projects, each with its own map, chats, agents and history, and a switcher in the header, so that I move between projects without a second server (#werk-projects, #werk-projects-one-process, #werk-projects-switcher).
104. As a person, I want to add a project through a folder dialog, name it by its folder, and remove it from the list without deleting its map, so that the list is mine (#werk-projects-add, #werk-projects-names, #werk-projects-list).
105. As a person, I want a project's agents to keep running while I look at another project, so that a switch never stops work (#werk-projects-background).
106. As a person, I want display settings shared and the open card and view kept per project, and werk's own checkout always listed in dev mode, so that each project opens where I left it (#werk-projects-display, #werk-projects-dev-self).
107. As a person, I want one server per store, taken by a lock in one atomic step, so that two servers never share a session (#werk-onelock, #werk-onelock-take, #werk-cli-serve).

### Development, checks and distribution

108. As a developer, I want a dev mode where a server edit swaps the request handler and a client edit reloads in place or reloads the page with the draft kept, so that a live agent survives an edit (#werk-dev, #werk-hmr, #werk-hmr-swap, #werk-hmr-entry-settles, #werk-client-reload).
109. As a developer, I want the client in its own folder, built by Vite from React components on shadcn/ui, so that each screen is small parts an agent can change (#werk-stack-layout, #werk-stack-framework, #werk-stack-hydration, #werk-stack-ui, #werk-stack-modules).
110. As a developer, I want card-scoped and shape-only map reads, so that a page does not download every body on every change (#werk-stack-api).
111. As a developer, I want lint, typecheck, test, test:coverage and e2e as make targets that install locked packages first and stop on a wrong Bun version, so that a check means the same on every machine (#werk-checks, #werk-lint, #werk-typecheck, #werk-test-fresh-tree, #werk-devex-tasks, #werk-devex-toolver, #werk-base-dir).
112. As a developer, I want every check to run again on a clean machine after each merge, building and starting the executable once, so that a pass does not depend on local state (#werk-ci).
113. As a user, I want werk as one executable per platform with the client inside, that never reads its own parts from a folder or starts itself through a source path, so that I install nothing else but Claude Code (#werk-dist).
114. As an agent, I want one short AGENTS.md, a README, shared Claude Code settings that allow the task commands, one format-and-lint hook, linked subagent definitions and no project skills, so that I start work with no guessing (#werk-devex, #werk-devex-agents, #werk-devex-docs, #werk-cc, #werk-cc-perms, #werk-cc-hooks, #werk-cc-subagents, #werk-cc-skills).
115. As a developer, I want unit tests under Bun on parallel workers and browser tests under Playwright, both run by the agent itself, so that the agent sees the result of its change (#werk-test, #werk-test-runner, #werk-test-runner-parallel, #werk-test-visual, #lp-agent-sees).

## Implementation Decisions

### Repository and stack

- v0 is a new git repository whose main branch starts with zero files. The first tickets create the package files, the make targets and the folder layout. Nothing is copied from the prototype; a builder may read it as a reference (#werk-base, #werk-base-repo, #werk-base-dir).
- The package list, lockfile, compiler configuration and test configuration sit at the repository root. Every check installs the locked packages first when they are missing (#werk-test-fresh-tree).
- The server is TypeScript that Bun runs directly. The client is a React app with shadcn/ui components and Tailwind, in its own folder, transformed by Vite. In dev, Vite runs in middleware mode inside the Bun server: one process, one port (#werk-stack-layout, #werk-client-reload, #werk-stack-ui).
- The client uses islands: the server renders card HTML, and React roots mount where state lives: the chat pane, the tab strip, the ask bar, the map controls, and the board (#werk-stack-hydration).
- The API is card-scoped: one read for one card with its neighbours' ids and titles, and one read for the shape of the map with no bodies. The live channel signals a change and the page reads again (#werk-stack-api, #werk-write-changed). Where #werk-stack-api says the signal carries ids, the decided signal rule of #werk-write-changed holds: the signal holds no data and the page reads the fold again.
- Modules are single-purpose and small. A shared list — the verbs, the routes, the views — holds only entries, each in its own module (#werk-stack-modules, #werk-verb-registry).
- The command line's start-up starts the chosen verb and does not wait for it, and exits through a callback with the verb's code (#werk-hmr-entry-settles). A hot reload keeps the listening server, the live channels and the agent children on the global object and swaps in the new request handler (#werk-hmr, #werk-hmr-swap).

### The log and the fold

- The decision log is an append-only file of events per project, committed with the project. The fold is a pure function from events to the map, run on every read, with its time recorded (#pr-log, #pr-log-snapshot).
- The fold applies the map rules to each event and sets aside a bad one as a problem with its log position. A write checks its events against the folded map and appends all or none (#pr-log-refuse).
- The fold holds the stale, paused and postponed marks and their traces, and the rollups. Every rule reads the folded map only (#pr-log-fold-marks, #rollup).
- Node kinds: card, option, source, excerpt (#map-card). Link kinds: refines, depends_on, supported_by, alternative_to (#vi-edges). A ghost is its own event type, outside every derivation, with its edges held until both ends are real (#werk-propose-new).
- The rules in the fold module: one parent per card, no cycle, an option has only alternative_to, no depends_on to an ancestor or descendant, a depends_on needs a reason, ghost words are frozen, decided words are frozen except through an amend, the four contract facts, waiver reasons, the amend scope, removal and restore as exact inverses, waiting links and taken ids (#map-frozen, #werk-contract-facts, #werk-contract-amend-scope, #werk-remove, #werk-write-remove-links).
- Marks: a change marks direct dependents and direct children; a postponement pauses everything reached over the links that existed at that time; a link made after a change carries no mark; a card on a stale or open basis waits (#vi-prop, #pr-wf-paused-reach, #vi-prop-bornstale, #map-wait).

### The command line

- Each verb is one module that registers itself. The help output comes from the registered verbs (#werk-verb-registry, #werk-cli).
- v0 builds the verbs that the cited cards define: add, propose, accept, discard, edit, link, unlink, status, reopen, rederive, kill, remove, restore, show, search, find, stale, say, inbox, quote, serve, target, plan, build, run, gate, ticket restore, ticket-check, followed (#werk-cli-add, #werk-cli-propose, #werk-cli-edit, #werk-cli-link, #werk-cli-decide, #werk-cli-reopen, #werk-cli-show, #werk-cli-search, #werk-cli-stale, #werk-cli-notes, #werk-cli-serve, #werk-cli-build, #werk-cli-ticket-restore, #werk-ticket-check-verb-form, #werk-cli-followed). The quote verb follows the rules of #werk-excerpt and its children; its exact form lives on the command card under #werk-cli.
- Accept, remove and restore from the command line require a statement that the person asked for it (#werk-propose-new, #werk-cc-perms).

### The server and the client

- One server process per machine holds one context per project: map, conversations, agents, builds. A start in a folder while a server runs adds the folder and exits (#werk-projects-one-process). The project list is stored once per user, outside every project (#werk-projects-list).
- Each project store has one lock, taken by an exclusive create (#werk-onelock, #werk-onelock-take). A test sets the store location through the environment (#werk-cli-serve).
- The server makes a synchronizer token at start and checks it on every changing request, and refuses a non-loopback Host (#werk-serve-trust).
- The server watches each project's log directory and starts the watch before it accepts connections (#werk-write-watch-start).
- Views in v0: the map and the board in the left pane, the chat in the right pane (#vi-layout, #werk). Addresses follow #vi-routes for the map and the board only.
- In dev mode a client file change that Vite cannot apply in place reloads the page; the composer draft is kept in session storage (#werk-dev).

### The chat

- Each conversation has one long-lived Claude Code child speaking stream-json, with partial messages on and the permission prompt tool on stdio, in auto mode (#werk-chat-stdin, #werk-invoke, #werk-perm-native, #werk-perm-mode, #werk-progress).
- The server keeps the sent turns of a conversation in order and attributes each streamed part to the oldest open turn (#werk-chat-turn-id).
- Each turn carries the open-card line: the full card on a change, a one-line reminder otherwise; the whole tree names the home card (#werk-card-blind, #werk-chat-no-card-line).
- Session id, model, advisor and context fill are saved beside each conversation and restored at start. A dead stored session id is cleared only on Claude Code's own message (#werk-resume, #werk-model-persist, #werk-crashmsg, #werk-fullerr).
- Always-allow rules are kept per conversation (#werk-mc-allow, #werk-approve). Every answered ask is appended to an ask log (#werk-approve-log).
- The werk agent instructions and the subagents they name are appended to every agent that can write to the map (#werk-agent-instructions, #werk-agent-instructions-append, #werk-agent-subagents). Every stage agent's prompt includes the titles of the build-rule cards (#st-build-howto-titles).
- Pasted images upload at once to the project's attachments folder; the message carries their paths (#werk-chat-image-inline, #werk-shots).
- More than one conversation: see #werk-v0-conversations.

### Tickets, plan and build

- Ticket text lives in werk's store per project, in the fixed format of #st-ticket-shape; the board log holds where each ticket is and what happened to it (#vi-board-state, #st-build-target).
- The ticket-check operation is built and tested on hand-written tickets before the plan, and the plan calls it (#werk-ticket-check-verb, #st-ticket-checks-run).
- The plan reads the scope in two tiers, runs the spec writer then the ticket writer, proposes their answers as ghosts under the subtree root, extends an earlier plan, and records its start, steps and end in the board log (#st-spec-linked, #st-spec, #st-spec-answers, #st-plan-extend, #vi-board-plan).
- Every agent the pipeline starts carries its role in its environment; each reviewer's role names its area (#st-build-seam-role-env, #st-build-seam-role-env-reviewer-area).
- Every time limit — silence, classifier interval, wall clock, check timeout — is a parameter, clamped by one shared budget (#st-build-seam, #al-sample-budget).
- The builder loop, the merge loop, the held-out set and the overseer follow the cards cited in stories 83 to 102. The held-out set is built as its own slice, gated on the run's tree, before the merge loop runs it after each merge (#werk-heldout-before-merge).
- The server watches each build process it started and restarts a dead one as a fresh pass (#st-build-died). A Build press starts one detached process that plans and then runs the merge loop (#werk-board-build-subtree).
- Each step's start, end, cost and, for a red step, its gate and cause are written to the project's pipeline log, which is the record the builder loop's tests read: see #werk-v0-pipeline-log.

### Checks, distribution and devex

- Make targets call package scripts: dev, lint, typecheck, test, test:coverage, e2e, a target that runs all checks in merge-loop order, fix, build, and help. Every target checks the pinned Bun version first (#werk-devex-tasks, #werk-devex-toolver, #lp-checks-scripts).
- Biome with its recommended and React rules; TypeScript 7 in strict mode with checked index access, no emit (#werk-lint, #werk-typecheck).
- GitHub Actions on each push to the main line: install from the lockfile, every check, build the executable for one platform, start it once (#werk-ci).
- The build compiles the server, its packages, the Bun runtime and the built client into one executable for macOS and Linux on ARM and Intel. The build writes a list of werk's own files; the code reads that list, never a directory. Every child process, prompt and printed command names the running executable (#werk-dist).
- The repository has AGENTS.md, a one-line CLAUDE.md that imports it, a README, shared Claude Code settings, one post-edit format-and-lint hook, and links to the shipped subagent definitions (#werk-devex-agents, #werk-cc-perms, #werk-cc-hooks, #werk-cc-subagents, #werk-cc-skills).
- On a machine with no supported folder dialog: see #werk-v0-add-project-fallback.

## Testing Decisions

A good test checks what a person or an agent sees: an exit code, printed output, the events in a log, a branch and its commits, the merged tree, and what the browser shows. It does not check internal function calls (#st-build-seam, #werk-test-visual-judge).

**Two seams for behaviour** (#werk-v0-seams):

1. **The command line.** A test runs werk commands against a fresh temporary project — a directory with a git repository and an empty map — and a temporary target repository (#werk-base-test-project, #werk-test-store). This seam covers every write to the map (the events of each verb, ghost and accept rules, the contract check, reopen reasons and marks, removal and restore, excerpts and notes), the ticket checks, the plan, the builder loop, the merge loop, the held-out set, the overseer, and the board log. Time limits are set to milliseconds (#st-build-seam).
2. **The browser.** Playwright starts a real werk server per test on a copy of a fixture project and on a copy of the app (#werk-test-visual, #werk-test-app-copy). It covers the map, card rendering, links, proposals and removal in the card view, the chat pane, more than one conversation, approvals, the board, the plan card, the project switcher, and the dev reloads. A test passes on structure — the DOM and the accessibility tree — and writes a PNG as evidence that nothing compares (#werk-test-visual-judge). The browser test run also finds tests in the binder's folder (#werk-v0-seams-heldout-folder).

**One fake agent for both seams** (#werk-test-external, #werk-test-env). It is first on the program search list under the real agent's name. It replays a script of ordered steps — an event to print, or a file to write inside the project (#werk-v0-seams-fake-script, #werk-test-fake-edit-inside). It records each launch with its arguments and role (#werk-test-fake-launch-log). It picks its reply by role, lives as long as the agent it stands in for, and keeps a permission ask open while its script plays (#werk-chat-fake-role, #st-build-seam-role-env, #werk-test-fake-ask-open). With no script it exits with an error. The unit run removes every variable that points at a real project and makes Bun's spawn, program lookup and shell default to the cleaned environment; the browser server refuses to start when the fake is not first (#werk-test-env). Other external programs that a test reaches, such as the folder dialog, get a fake of the same kind (#werk-test-external).

**Pure code** gets unit tests under `bun test` on four parallel workers with a 15-second default limit (#werk-test-runner, #werk-test-runner-parallel). The coverage gate reads an explicit list of pure files, judges each file on its own at 90% lines, counts only the lines its own test file runs, and fails a listed file with no test (#werk-test-scope, #werk-test-pure-list, #werk-reflink-own-test-coverage, #werk-test-gate-list, #werk-test-scope-src0-pure-scope). A merge keeps every entry of the list (#werk-test-pure-list-union). Pure modules in v0 include the fold and its rules, the mark derivation, the board fold, the ticket parser and checks, the reference linker, the Markdown and code renderer, the diff renderer, the prompt builders, the pipeline-log fold, and the overseer's verdict logic. A pure half of an I/O module moves into its own file to join the list. Classify each new module with the test-scope rule before its tests are written (#werk-test-scope, #werk-test-behaviours).

**I/O modules** get named behaviours, written as responsibilities, as test cases at the two seams — for example "a crash never loses the message in flight", "a dead stored session is cleared only on Claude Code's own message", "an 'always' choice applies to the live process and to every relaunch" (#werk-test-behaviours, #werk-test-behaviours-model-switch-during-turn, #werk-test-behaviours-always-rule-mechanism, #werk-test-behaviours-ambiguous-convo-ref-attribution).

**Component tests** run under `bun test` with one DOM registered per test process before any test file loads; the runtime's network, stream and timer globals are put back after the registration; each test unmounts what it rendered (#werk-test-dom, #werk-test-globals).

**Hot reload tests** edit a copy of the app, never the checkout, and each copy keeps its own Vite dependency cache (#werk-test-app-copy).

**Prior art.** The prototype repository has command-line tests per module, a coverage gate over a pure list, a fake agent on the program search list, and Playwright specs for the map, the board and the chat on a fixture project. A builder may read them to see how a behaviour was tested. Nothing is copied.

## Out of Scope

- The product diagram, the 3D graph, the Flow view and the Measure view (#werk).
- The tracker export, the validate stage beyond the held-out set, pipeline self-measurement reports, and trend reports (#werk, #werk-loop, #lp-trend).
- Saying a risk tier and raising it during a build: every build is a feature build (#werk-loop-tier, #st-tier-say, #st-tier-escalate).
- Ambiguity sampling before the build, and every other part of #align beyond the accept gate, the plan's proposed answers and the build gates (#werk-align-v0).
- The Homebrew tap and the release steps (#werk-dist-channel, #werk-release).
- Windows builds (#werk-dist).
- Conversation features whose cards are not decided: forking a session, cross-tab recall, parking and the idle sweep, tab keyboard shortcuts, the tab-strip details beyond #werk-v0-conversations.
- An overseer for chat-pane and terminal sessions (#lp-overseer-scope).
- A limit on follow-up tickets per run (#st-build-run-cap).

## Further Notes

- The prototype in its own repository is the bar. A v0 behaviour that differs from it is either a decided card the prototype never followed, or a gap to record as a card.
- The order of slices is the planner's choice, with three fixed points: the ticket checks come before the plan (#werk-ticket-check-verb); the held-out set comes before the merge loop runs it (#werk-heldout-before-merge); and the test harness with the fake agent comes before any slice that starts an agent.
- The kill criterion of #werk-base names the fallback: extend the prototype code.
- Two decided cards name a mechanism that a later decided card replaced in part: #lp-stateless writes one record per pass to a per-run file, and #ms-store keeps one pipeline log per project; #werk-stack-api carries ids on the change signal, and #werk-write-changed sends a bare signal. v0 follows the later card in each pair.
- Three answers in this spec were not given by any card and are proposed as cards: #werk-v0-conversations, #werk-v0-pipeline-log, #werk-v0-add-project-fallback.
