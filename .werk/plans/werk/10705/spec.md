# Spec: werk v0

## Problem Statement

A person who builds software with Claude Code works in a chat transcript. The transcript only grows. The decisions that the conversation settles are buried in it, and nothing shows which decision rests on which other decision. When one decision changes, nothing marks the decisions that depend on it (#visual).

The person also cannot see the build. An agent that builds from the decisions works in a terminal. The person does not see which slice of work runs, which one failed, or why. A long build stops when one agent waits for a question that nobody answers.

werk has a working prototype of the answer. Its code was written to find the right shape, not to keep. It has shortcuts and is difficult to change. The person needs a clean v0, built only from the decided cards, in a new repository. The rebuild also tests whether the decided cards are enough to rebuild the behaviour (#werk-base, #werk-base-repo).

The person works on more than one project. werk must work on any project, not only on its own repository, and a user must install it without first installing a runtime (#werk-projects, #werk-dist).

## Solution

werk v0 is a visual layer over Claude Code with three views: the map, the board, and the chat (#werk).

1. **The map** draws the fold of an append-only log of decisions (#pr-log, #werk-write). Each card has a reason, typed links, options, sources and excerpts. A card that an agent adds is a ghost until the person accepts it (#werk-propose-new). A card cannot become decided until a program check passes (#werk-contract). A reopen marks the cards that depend on the reopened card, stale or paused by its reason (#pr-wf-paused).
2. **The chat** sits beside the map. A message goes to a live Claude Code child with the open card, and the agent writes what the talk settles into the map in the same turn. The reply streams in, and the map redraws while the person reads (#werk-chat).
3. **The board** shows the tickets of a build in five columns. The person starts a build of a decided subtree with one press, triggers one ticket early, reorders, and archives (#werk-board).

Behind the board, the inner build loop turns a decided subtree into merged, tested code with no person in the middle: a spec, then tickets, then a builder loop per ticket, then a merge loop with the held-out set, with an overseer that keeps every agent from getting stuck (#werk-loop). Every run is a feature run, so every gate waits for the person (#werk-loop-tier). Every step writes to one pipeline log (#werk-v0-pipeline-log).

One werk server holds many projects. A switcher in the header opens any of them, and each keeps its own map, conversation, agents and history (#werk-projects).

v0 is a new project in its own repository. Bun runs the server TypeScript directly and hot-reloads it without killing a live agent. Vite transforms a React client built from shadcn/ui components (#werk-stack, #werk-hmr, #werk-dev). Every change passes the production checks before it merges and again on a clean machine after (#werk-checks). A newcomer, person or agent, starts from the repository and the map alone (#werk-devex, #werk-cc). A release build makes one executable file per platform (#werk-dist).

## User Stories

### The log and the map

1. As a person, I want every change to the map to be one event at the end of a log, so that nothing I decided is ever lost (#pr-log).
2. As a person, I want the map to be the fold of the whole log, with the latest words and links of each card, so that I read the current state and not a history (#pr-log, #pr-log-snapshot).
3. As a person, I want no view to edit a drawn card in place, so that the log stays the only store (#werk-write).
4. As a person, I want a control in a view, such as accept or remove, to append an event, so that every view redraws from the same log (#werk-write).
5. As an agent, I want the command line to be my only write path to the map, so that I cannot change the map in a way the log does not record (#werk-write, #werk-cli).
6. As a person, I want a bad event in a committed log set aside and listed as a problem, so that one bad line never hides the whole map (#pr-log-refuse).
7. As an agent, I want a write that breaks a map rule refused with the rule it breaks, so that no new bad line enters the log (#pr-log-refuse).
8. As an agent, I want adding a card under a parent to be one event, so that the log shows one change where I made one (#pr-log-one-event).
9. As a person, I want every open view to read the whole map again when the log grows, so that every tab shows the same map (#werk-write-changed).
10. As a person, I want a page to fetch the whole map each time its live channel connects, so that a write made while the server was down still shows (#werk-write-watch-start).
11. As a person, I want to remove a card with its refines subtree, its options and its excerpts, and restore it later exactly as it was, so that cleanup is never final (#werk-remove, #werk-remove-restore-undo).
12. As a person, I want a removal to keep the card's links waiting and its id taken, so that a restore brings the map back as it was (#werk-write-remove-links).
13. As a person, I want the ✕ on a card with children to ask whether the children go too or move up, with the counts, so that I can remove a bad parent over good children (#vi-remove-btn, #vi-remove-btn-reparent).
14. As a person, I want a proposed removal drawn in red, so that its ✓ does not look like the accept of an edit (#werk-remove-red).
15. As an agent, I want a find operation that lists open and proto cards in a subtree, without paused, stale or postponed cards, so that I find work I can do now (#werk-find, #werk-find-scope).
16. As an agent, I want a search operation over the decided cards, so that I find a decision before I make it again (#werk-cli-search).
17. As an agent, I want every command to accept a card id with or without a leading hash sign, so that a copied reference works (#werk-cli-hash-id).

### Proposals

18. As a person, I want every card, option, source and excerpt that an agent adds to enter as a ghost, so that nothing enters the map without my accept (#werk-propose-new).
19. As a person, I want a ghost drawn dashed under its proposed parent with the badge "proposed", so that I tell "this card does not exist yet" from "this card has a pending change" (#werk-propose-new, #al-ghost-badge).
20. As a person, I want to accept one ghost at a time with a ✓ button, so that I read each card before it commits (#werk-propose-new, #al-diff-cli-btn).
21. As a person, I want an accept to take the ghost refines ancestors, options, sources and excerpts of the card with it, so that a click never orphans a card or leaves it without proof (#werk-propose-new, #werk-propose-new-carry).
22. As a person, I want a discard to drop the ghost descendants and the evidence that no other card cites, so that nothing unreachable stays behind (#werk-propose-new-carry).
23. As a person, I want the words of a ghost frozen, so that what I accept is what I read (#werk-propose-new).
24. As an agent, I want link, status and who to work on a ghost, so that I propose a card that is already decided, with its basis and options, as one unit (#werk-propose-new).
25. As a person, I want a corrected ghost to keep its thread of notes with a marker where the new words begin, so that I see why the words changed (#werk-propose-new-discard-thread).
26. As a person, I want an accept from the command line to refuse unless it states that I asked for it, so that an agent does not accept its own proposal by default (#werk-propose-new).
27. As a person, I want an edit to a card shown as one card with the changes marked inside it, so that I never compare a before and an after by eye (#al-diff, #al-diff-cli, #al-diff-render).
28. As a person, I want a proposal that leaves a block of the body unnamed refused, so that no text disappears without a mark (#al-diff-cli-cover).

### The contract check and reopen

29. As a person, I want a card to move to decided only after a program check of four facts passes, so that the map's rules are not only prose (#werk-contract, #werk-contract-facts).
30. As an agent, I want a refused decide to list every missing fact with the command that fixes each, so that I fix the card in one pass (#werk-contract-fix, #werk-contract-all-missing).
31. As a person, I want a waiver of a fact to need a written reason, so that a deliberate gap differs from a forgotten one (#werk-contract-waiver-reason).
32. As a person, I want a card with no decider to need an option, so that a bare card is refused once, not twice (#werk-contract-no-decider).
33. As a person, I want a change to a decided card to be an amend that cannot leave it missing a fact, so that a decided card stays valid (#map-frozen, #werk-contract-amend-scope).
34. As a person, I want a reopen to carry a reason, postponed, invalidated or rejected, so that the marks say whether the content is still true (#pr-wf-paused, #werk-cli-reopen).
35. As a person, I want a change to mark only the next hop as stale, and a postponement to mark every card downstream as paused, so that the marks follow how each kind of change spreads (#vi-prop, #pr-wf-paused-reach).
36. As a person, I want every mark to show its trace, with the reason and the path, so that I can judge it without a log query (#vi-prop-trace, #vi-prop-trace-reason, #vi-onview-stale).
37. As a person, I want a review of a stale card to end in a confirm or an amend, so that no mark is cleared unread (#rederive-reason, #vi-prop-amended).
38. As a person, I want a card on a stale basis to wait, not go stale, so that a new card is not marked for a change it already knew about (#map-wait, #vi-prop-bornstale).
39. As a person, I want a postponed card to carry a grey postponed tag and stripes, and to stop its own paused marks when it is decided again, so that waiting work reads calm and resumes cleanly (#pr-wf-postponed, #vi-onview-postponed, #pr-wf-paused-resume).
40. As a person, I want a depends_on link to need a reason and never point to an ancestor or a descendant, so that every link carries meaning (#vi-prop-linkwhy, #vi-prop-nolineage).

### Excerpts

41. As an agent, I want a quote operation that finds the text exactly once in a spoken message of a conversation and writes an excerpt, so that no quote is written from memory (#werk-excerpt, #werk-excerpt-once).
42. As a person, I want an excerpt to point at the conversation, the session, the message position, the span, the speaker and the time, and to keep its own words, so that I find the quote again and still read it on another machine (#werk-excerpt-pointer).
43. As a person, I want an excerpt's words never to change and an excerpt never to exist without the card it supports, so that every excerpt is a true copy (#werk-excerpt-event).

### Card rendering

44. As a person, I want each card to have one page: a hero box on top and the sub-cards as tiles below, so that every card reads the same way (#vi-onview, #vi-onview-hero, #vi-onview-subcards, #vi-onview-look).
45. As a person, I want the map to open on the page of the root card, so that the root is one more card page (#vi-onview-root).
46. As a person, I want a card page to show its options, evidence, excerpts and links with ids, titles and reasons, so that the card carries its own proof (#vi-detail, #vi-onview-links).
47. As a person, I want a `#card-id` in any text to be a link shown as `#id`, only when the map can open that card, so that every link lands somewhere (#werk-reflink, #werk-reflink-label, #werk-reflink-inview, #werk-reflink-guard).
48. As a person, I want fenced code boxed and highlighted by any common tag name, and plain when the tag is unknown, so that code reads well and never breaks a card (#werk-codeblock, #werk-codeblock-langs).
49. As a person, I want a backtick span in a title shown as code, so that a command reads as something I type (#vi-title-code).
50. As a person, I want the rollup of a subtree shown as a bar, a labelled count line and separate flag chips, so that I see how much is left and what is wrong (#rollup, #ro-axes, #vi-counts, #vi-counts-card).
51. As a person, I want each view at its own address, with breadcrumbs, view tabs, a search box and a counts strip in the header, so that I move around the map from anywhere (#vi-routes, #vi-crumbs, #vi-tabs, #vi-jump, #vi-counts-header).

### Card wording

52. As a reader of a card, I want its words to describe its subject at the level of the decision, with no session narration and no code names, so that the card is still true when I read it cold (#werk-wording).
53. As an agent, I want the wording rules in my system prompt in every project, so that I write cards the right way without a separate check (#werk-wording-check, #werk-agent-instructions).

### The chat

54. As a person, I want to send a message with the open card, and have the agent change the map in the same turn, so that the talk turns into decisions with no copy step (#werk-chat).
55. As a person, I want one continuous conversation per project, docked on the right, that keeps going while I move across the map, so that the thread is not split by card (#werk-onechat, #werk-pane).
56. As a person, I want the reply to stream into the pane with a status line, rendered as Markdown, and grouped tool calls, so that I see the turn as it runs (#werk-progress, #werk-tool-collapse, #werk-blockid).
57. As a person, I want each part of a reply to stay under the message that asked for it, with a waiting mark on a queued message, so that a second message never confuses the answers (#werk-chat-turn-id).
58. As a person, I want every turn to start with the card I am looking at, or a one-line reminder, so that the agent never answers about the wrong card (#werk-card-blind, #werk-chat-no-card-line).
59. As a person, I want only a request with the server token from a loopback host to start a turn or change state, so that no other site or machine runs code on my machine (#werk-serve-trust).
60. As a person, I want a permission ask answered in the pane, and a question from the agent shown as a form, so that the turn waits for me and nothing widens a permission silently (#werk-approve, #werk-approve-bar, #werk-mc-askqa, #werk-perm-native, #werk-perm-mode).
61. As a person, I want "Always allow" choices kept per conversation, so that a permission given in one place does not apply in another (#werk-mc-allow).
62. As a person, I want to paste a screenshot that uploads at once and shows as a chip with an image number, so that a bad image shows before I send (#werk-shots, #werk-shot-chip, #werk-chat-image-inline).
63. As a person, I want a slash-command menu and a card search on # in the composer, so that I see what I can type (#werk-chat-cmdmenu, #werk-hash-trigger).
64. As a person, I want a model selector, a context-fill pie with a clear-context action, and both kept across a server restart, so that I choose the model and see the context without a restart (#werk-model-select, #werk-context-pie, #werk-model-persist).
65. As a person, I want a server restart to resume the conversation, and a crash to show its whole error without losing the session, so that editing werk never loses the thread (#werk-resume, #werk-crashmsg, #werk-fullerr).
66. As a person, I want a suggested next action shown as a button, so that I do not retype a phrase the agent already wrote (#werk-mc-nextbtn).
67. As a person, I want a line in the pane while a background agent runs, and a dead child marked until a new one starts, so that work never ends unseen (#werk-mc-bgagents, #werk-mc-bg-line, #werk-mc-live-bgcount, #werk-mc-live-dead).
68. As a person, I want the chat header row directly above the composer, so that the turn state is next to my keystroke (#werk-head-bottom).
69. As a person, I want a chat reply to name a map operation, not a command line, so that I know what to do in the map (#werk-chat-opnames).

### Projects

70. As a person, I want one werk server to hold many projects, each with its own map, conversation, agents and history, so that I switch between my projects in one place (#werk-projects, #werk-projects-one-process).
71. As a person, I want a project switcher at the left of the header that marks busy and missing projects, so that I always know which map I edit (#werk-projects-switcher).
72. As a person, I want to add a project from a folder dialog, and to start werk in a folder to add that folder to a running server, so that adding a project is one step (#werk-projects-add, #werk-projects-one-process).
73. As a person, I want a project to stay on my list until I remove it, and a removal never to delete its map, so that the list is mine and safe (#werk-projects-list).
74. As a person, I want agents of one project to keep running while I look at another, so that a switch never stops work (#werk-projects-background).
75. As a person, I want display settings shared and the open card and view kept per project, so that each project opens where I left it (#werk-projects-display).
76. As a person who builds werk, I want werk's own checkout always on the list in dev mode, so that its map is one click away (#werk-projects-dev-self).

### The board

77. As a person, I want a board with the columns blocked, ready, building, merging and done, so that I watch the build as it runs (#werk-board-columns, #vi-board).
78. As a person, I want a ticket card with a clamped title, a corner live dot, a retry count and a count of open blockers, so that I scan a column fast (#vi-board, #vi-board-pulse-corner, #vi-board-title-clamp).
79. As a person, I want a live dot only while the board log says a session started and its process is alive, so that a killed builder never pulses forever (#vi-board-session-file).
80. As a person, I want a drawer with the ticket text, its metadata, its decisions and a live log for a building ticket, so that I read a ticket and its session in one place (#vi-board, #vi-board-details, #vi-board-ticket-decisions-2).
81. As a person, I want a red held-out badge, and a grey badge for a step that did not run, on the done ticket whose merge it followed, so that a known break shows without a new column (#werk-board-columns, #st-heldout-notrun).
82. As a person, I want to reorder ready tickets, archive a ticket after a confirmation, and restore it later, so that I control the order without losing a ticket (#werk-board-control, #st-ticket-restore, #werk-cli-ticket-restore).
83. As a person, I want to trigger one ready ticket inside an active run, by the icon or a drag into building, so that I start one ticket early (#werk-board-control).
84. As a person, I want archiving a building ticket to end its build within about a second, so that archiving is the one way to stop a build (#werk-board-control-archive-ends-build).
85. As a person, I want one Build press on a decided map card to plan the subtree and run the merge loop in a detached process, so that an overnight build needs nobody between plan and run (#werk-board-build-subtree).
86. As a person, I want a plan card below the columns that shows the plan's state, log and spec, so that I see that a plan runs and why it failed (#vi-board-plan).
87. As a person, I want Build, Resume or Restart shown by the state of the subtree, and disabled with the blocking run named while a run above it is in progress, so that a press never starts a second run (#vi-board-plan-controls, #werk-board-restart, #st-run-start-guard).
88. As a person, I want board columns with a minimum width and a sideways scroll, so that cards stay readable on a small screen (#werk-board-colwidth).

### The inner build loop

89. As a person, I want each project to name its own target repository for builds, so that werk never builds into its own store (#st-build-target).
90. As a person, I want the plan to read the subtree and every decided card it depends on, and to end with one spec, then tickets from the spec, so that all tickets split one agreed whole (#st-spec, #st-spec-linked).
91. As a person, I want every answer that the spec or ticket writer gives and no card gives to come back as a proposed card under the subtree, so that I can see and reopen every new decision (#st-spec-answers, #st-spec-decisions).
92. As a person, I want a second plan over a subtree to extend its spec and open tickets, and archive the tickets the spec no longer needs, so that the board never holds two ticket sets (#st-plan-extend, #st-plan-archive).
93. As a person, I want every ticket in one fixed format, checked by one operation with one verdict, so that a malformed ticket never reaches a builder (#st-ticket-shape, #st-ticket-own-checks, #st-ticket-set-checks, #st-ticket-checks-run, #werk-ticket-check-verb).
94. As a person, I want a failed set check to block only the tickets it names, and a change to a cited card to block the open tickets that cite it, so that good tickets still build and stale ones wait (#st-ticket-partial, #st-ticket-watch).
95. As a builder, I want one ticket in one worktree, with a fresh agent per pass that gets the ticket, its stories, its cards, the index of decided cards and the last failure, so that each pass has what it needs and nothing else (#st-build-ticket, #lp-stateless, #st-build-implement, #st-build-implement-search).
96. As a person, I want each pass to run the checks, then the grader, then five reviewers, and to stop at the first red, so that the cheap verdict runs first (#st-build-ticket-order, #lp-prod-judge, #lp-prod-review).
97. As a person, I want the grader to judge delivery, contradiction and scope lines, read-only, and later grades to check only earlier gaps and regressions, so that passes converge (#lp-prod-judge, #lp-prod-judge-scope, #lp-prod-judge-read-only, #st-grade-converge).
98. As a person, I want small gaps on the last counted pass to merge and become a follow-up, so that a nearly done ticket does not park (#st-grade-defer).
99. As a person, I want a builder that meets a missing decision to propose a card and build on it, and that pass not to count against the cap, so that a gap in the map never stalls the run (#st-build-missing-decision, #st-build-cap-spec-gap).
100. As a person, I want every build to open a card obligation that the pass closes with a card or with the cards it followed, so that no build changes code and leaves the map silent (#st-build-card, #werk-cli-followed).
101. As a person, I want a green build to move to merging and a red build at the cap to go back to ready with the reason, so that building holds only live builds (#st-build-ticket-hand-off, #st-build-stop-ready).
102. As a person, I want up to three tickets to build at once only when they touch no module in common, so that parallel builds rarely conflict (#st-build-parallel, #werk-stack-modules).
103. As a person, I want the merge loop to merge one ticket at a time on green checks onto the main line, resolve a conflict on the ticket's own branch, and park only the stuck ticket and what needs it, so that one problem never stops the whole run (#st-build-run, #st-build-run-mechanics, #st-plan-main, #st-build-conflict-resolve, #st-build-stuck-park).
104. As a person, I want the held-out set of merged tickets to run beside the merge queue after each merge, file one follow-up per ticket with red steps, and gate a follow-up on its own steps, so that a break is found where it starts (#st-validate-heldout, #st-heldout-beside, #st-heldout-merged-only, #st-heldout-followup-per-ticket, #st-heldout-followup-gate).
105. As a person, I want a held-out step that needs an unbuilt capability, or whose card changed, or that contradicts its card, handled without a useless follow-up, so that every red step points at real work (#st-heldout-unbuilt-capability, #st-heldout-unbuilt-close, #st-heldout-step-fresh, #st-heldout-step-contradiction).
106. As a person, I want G2 to wait until every held-out step is green on the main line, so that I never approve a known break (#st-g2-heldout).
107. As a person, I want an overseer inside each build pass that answers asks, cancels silence, frozen calls and loops, so that no agent stays stuck (#lp-overseer and its subcards).
108. As a person, I want the server to restart a build whose process died, as a fresh pass, so that a crash at night does not stop the run (#st-build-died).
109. As a person, I want each pipeline agent on the model its role needs, so that cost stays down without weaker gates (#st-model-per-role).
110. As a person, I want every run to write a feature tier event first, and every gate to wait for me, so that every run has a first event and nothing passes alone (#werk-loop-tier, #st-tier-default).
111. As a person, I want every build step written to the pipeline log with its time, cost, result and fail cause, and the transcripts beside it, so that a test and the retry cap read one record (#werk-v0-pipeline-log, #ms-store, #ms-fail, #ms-fail-cause).
112. As a person, I want to record a follow-up request on a finished ticket with its class, so that plan misses and build misses are counted (#werk-cli-followup, #ms-outcome-followup).

### Development, checks and shipping

113. As an agent that edits werk, I want a server change to reload in the same process and swap the request handler, so that a live chat session survives my edit (#werk-hmr, #werk-hmr-swap, #werk-hmr-entry-settles, #werk-dev).
114. As a person, I want one server per project directory, taken by a lock that only one start can win, so that two servers never share one log (#werk-onelock, #werk-onelock-take).
115. As a person, I want a client change applied in place by Vite, or a page reload that keeps my draft, so that a client edit costs nothing (#werk-client-reload).
116. As an agent, I want to run the unit tests, the coverage gate and the browser tests myself, so that I see the result of what I build (#werk-test, #lp-agent-sees).
117. As a person, I want every change to pass lint, typecheck, unit tests with coverage and e2e before merge, and again on a clean machine after, so that the main line always works (#werk-checks, #werk-lint, #werk-typecheck, #werk-ci).
118. As a newcomer, I want a README, a short AGENTS.md, a Makefile that lists every task, and a pinned Bun version, so that I start work from the repository alone (#werk-devex and its subcards).
119. As an agent in werk's repository, I want shared Claude Code settings that allow the tasks, a format-and-lint hook after each edit, and linked subagents, so that I work fast and safe (#werk-cc and its subcards).
120. As a person, I want a build target that makes one executable per platform with the client inside, so that a user needs no runtime install (#werk-dist).
121. As every agent werk starts that can write the map, I want the werk agent instructions and their subagents appended to my system prompt, written out in full, so that I follow the map rules in any project (#werk-agent-instructions, #werk-agent-instructions-append, #werk-agent-subagents, #werk-agent-selfcontained).

## Implementation Decisions

### Project base

- v0 starts in a new git repository whose main branch has zero files. Nothing is ported. The decided cards are the spec. The prototype is a reference to read, not to copy (#werk-base, #werk-base-repo).
- v0's package list, lockfile, compiler and test configuration sit at the root of that repository. Every check installs the locked packages first when they are missing (#werk-base-dir, #werk-test-fresh-tree).
- The repository is a target project of werk. Werk keeps the map, board, specs and tickets in its own store, never in the target (#st-build-target).
- The stack: Bun runs the server TypeScript directly, with `bun --hot` in dev (#werk-hmr). React with Vite builds the client, islands for hydration, shadcn/ui for every screen (#werk-stack-framework, #werk-stack-hydration, #werk-stack-ui). The client has its own folder and its own build output (#werk-stack-layout). The API is card-scoped: one card with neighbour titles, and a shape query with no bodies (#werk-stack-api).
- Modules are single-purpose and small. A shared list, such as the command list, the routes or the views, holds entries only (#werk-stack-modules). Each command-line verb lives in its own module and registers itself (#werk-verb-registry).
- The code points to the card that explains it, never the other way (#werk-devex-docs).

### Modules

1. **Log.** An append-only file of events per project. Append and read only. A write checks its events against the fold and appends all or none (#pr-log, #pr-log-refuse). A proposed card is its own event type (#werk-propose-new).
2. **Fold.** A pure function from the events to the map: nodes with their latest words and status, live edges, held ghost edges, rollups, stale, paused, postponed and waiting marks with their traces, and the unchallenged count. Every rule reads the fold, never the raw log (#pr-log-fold-marks). Every read replays the whole log, and the fold time is recorded (#pr-log-snapshot).
3. **Map rules.** Pure checks that the command line calls: the contract facts, the amend scope, waivers (#werk-contract and its subcards), the link rules (#werk-cli-link, #vi-prop-nolineage), the proposal cover check (#al-diff-cli-cover), the excerpt rules (#werk-excerpt-event), and the removal rules (#werk-remove, #werk-write-remove-links).
4. **Command line.** The only write path. One verb per module, with the forms on the cards under #werk-cli. The start-up loads the verbs and does not wait for the verb (#werk-hmr-entry-settles). It accepts an id with or without a hash sign (#werk-cli-hash-id).
5. **Server.** One process per machine that holds a context per project (#werk-projects-one-process), with a lock per log directory (#werk-onelock, #werk-onelock-take). A guard on the global object keeps the listening server, the live connections and the children, and swaps in the new request handler on a hot reload (#werk-hmr-swap). It serves the client, the read API and one live channel per page. It sends a bare map signal when the log grows, a measure signal when the pipeline log grows, and a reload signal for a client change it cannot apply (#werk-write-changed, #werk-write-measure-signal, #werk-dev). Vite runs inside it in dev (#werk-client-reload). Every changing request needs the synchronizer token and a loopback Host (#werk-serve-trust). A bad request answers 500 and never kills the process (#werk-crash).
6. **Projects.** A per-user list stored outside every project, names from folder names, the add flow, the dev-mode self entry, and per-project display state (#werk-projects and its subcards).
7. **Conversation.** One Claude Code child per project conversation over stream-json (#werk-chat-stdin, #werk-invoke). It keeps the session id, the model, the advisor and the context fill (#werk-resume, #werk-model-persist), turns in send order (#werk-chat-turn-id), the open asks (#werk-approve), the background task count (#werk-mc-live-bgcount), and the dead mark (#werk-mc-live-dead). Claude Code's own permission engine decides in auto mode, and werk only asks about the rest (#werk-perm-native, #werk-perm-mode).
8. **Agent instructions.** One instruction text and its subagent definitions, appended to the system prompt of every agent that can write the map, with every command named by the path werk runs from (#werk-agent-instructions and its subcards). Each pipeline agent carries its role name in its environment (#st-build-seam-role-env, #st-build-seam-role-env-reviewer-area) and runs on the model its role needs (#st-model-per-role).
9. **Board state.** Ticket state is its own append-only log, folded into the five columns (#vi-board-state). A session counts as live only while the board log has a start and no end and its process is alive (#vi-board-session-file).
10. **Build pipeline.** Plan, ticket checks, builder loop, merge loop, held-out set, overseer and the dead-build watcher (#werk-loop and the cards it lists, #st-build-died). Every time limit is a parameter (#st-build-seam). Every step writes to the pipeline log (#werk-v0-pipeline-log).
11. **Client.** The two-pane layout with the header rows (#vi-layout), the map views (#vi-onview and its subcards), the board (#vi-board), the chat pane (#werk-pane), and the project switcher (#werk-projects-switcher). The Markdown renderer adds card links and highlights code (#werk-reflink, #werk-codeblock, #werk-progress).
12. **Fake agent.** One scripted binary that stands in for every Claude Code child at both seams. It replays ordered steps (an event to print, or a file to write) and exits with the script's code, keeps an ask open while the script plays on, writes only inside its project, records each launch with its arguments and role, and lives as long as the agent it stands in for. With no script it fails at once (#werk-v0-seams-fake-script, #werk-test-fake-ask-open, #werk-test-fake-edit-inside, #werk-test-fake-launch-log, #werk-chat-fake-role, #werk-test-external).

### Interfaces between the modules

- The command line and the server both append through the log module, after the map rules pass (#werk-write, #pr-log-refuse).
- Every read goes through the fold. The browser, the command line and the build pipeline read the same fold (#pr-log).
- The server starts the conversation child and every build agent as a child process with a role in its environment. The token never goes into the environment, a log or a transcript of an agent (#werk-serve-trust, #st-build-seam-role-env).
- A build runs as a detached process that outlives the server. The server watches build processes and restarts a dead build (#werk-board-build-subtree, #st-build-died).
- The client reads the map by the card query and the shape query, and reads the whole map again on each signal and on each connect (#werk-stack-api, #werk-write-watch-start).

### Contracts

- The chat send is one request with the text, the open card, the stored image paths and the turn name. The reply streams over the live channel with the turn name on each part (#werk-chat-turn-id, #werk-chat-image-inline).
- An image uploads on paste. The server checks type and size and answers with a file name in the project's attachments folder (#werk-shots).
- A ticket has five header lines and three sections in a fixed order, and names no file paths (#st-ticket-shape, #st-ticket-own-checks).
- The ticket-check operation prints one line per failure and exits 0, 1 or 2 (#werk-ticket-check-verb-form).
- The spec and ticket writers return each new answer as a record with a slug, a title, a why and a body, and the plan proposes it as a ghost under the subtree root (#st-spec-answers, #st-spec-decisions).
- The grader returns a score from 1 to 5 and the gap for each line (#lp-prod-judge). A review finding has a severity, a file and line, an impact and a fix (#lp-prod-review).
- The pipeline log holds a start and an end event for each plan step, pass, check, grader run, reviewer run, merge and held-out run, with wall time, cost and tokens, result, and gate and cause on a red step (#werk-v0-pipeline-log).

### Checks and repository setup

- Each production check name is a make target that calls a package script: lint with Biome, typecheck with the TypeScript 7 compiler in strict mode with checked index reads, test, test:coverage and e2e (#werk-checks, #werk-lint, #werk-typecheck, #lp-checks-scripts).
- `make` with no target lists every target. Every target checks the pinned Bun version first (#werk-devex-tasks, #werk-devex-toolver).
- GitHub Actions runs every check, builds the executable for one platform and starts it once, after each push to the main line (#werk-ci).
- AGENTS.md is the one instruction file, and CLAUDE.md is one import line (#werk-devex-agents).
- The shared Claude Code settings allow the make targets and the werk command line, ask for accept, remove and restore, hold one format-and-lint hook, and link the shipped subagents. The repository has no project skills and no MCP servers (#werk-cc and its subcards).
- The executable build bundles a list of werk's own files. werk never reads a folder on disk to find a part of itself, and never names a runtime and a source path to start itself (#werk-dist).

### Scope cuts inside v0

- Chat: one conversation per project. Multichat is not in v0 (see Out of Scope and the decision in the decisions file).
- Board: all five columns and all actions (#werk-board).
- Build loop: everything that #werk-loop lists, at full scope. The tier is fixed at feature (#werk-loop-tier).
- Alignment: the accept gate, the plan's proposed answers and the build gates only (#werk-align-v0).
- Measures: v0 writes the pipeline log and reads it only where the loop needs it (#werk-v0-pipeline-log).

## Testing Decisions

### What makes a good test

A test checks what a person or an agent sees from outside: a page in a browser, the exit code and output of a command, the events in the log, the board state, the branch and its commits, the records of the fake agent. It does not check internal function calls (#st-build-seam). A browser test asserts on structure, and its screenshot is evidence, not the verdict (#werk-test-visual-judge).

### The seams

v0 is tested at two seams, the highest for each half of the product (#werk-v0-seams). Both use the same fake agent first in the program search list, so no test reaches a real agent.

1. **The command line**, run against a fresh project directory with a git repository and an empty map, and a fresh target repository (#werk-base-test-project, #st-build-seam). It covers every map write: the events of each verb, the ghost and accept rules, the contract check, reopen reasons and marks, excerpts, notes, removal and restore. It covers the whole build pipeline: plan, ticket checks, builder loop, grader, reviewers, merge loop, held-out set, overseer and pipeline log. Every time limit is set to milliseconds. A test reads the fake agent's launch record to check the role and the request of each launch.
2. **The browser**, through Playwright against a real server on a copy of a fixture project (#werk-test-visual). It covers the map pages, rendering and links, ghosts and the ✓, removal, the chat pane, the project switcher and the board with its drawer, plan card and actions. The browser run also finds the tests in the binder's folder (#werk-v0-seams-heldout-folder).

A hot reload test edits a copy of the app, never the checkout (#werk-test-app-copy).

### Unit tests and the coverage gate

- Pure code (the fold, the map rules, the link rule, the Markdown renderer, the board fold, the ticket checks, the pipeline log fold) gets unit tests and a 90% line gate (#werk-test-scope, #werk-test-runner).
- The gate reads an explicit list of pure files, judges each file on its own, counts a missing file as 0%, and counts only the lines that the file's own test file runs (#werk-test-pure-list, #werk-reflink-own-test-coverage). A merge keeps every entry of the list (#werk-test-pure-list-union).
- An I/O module gets a list of named behaviours as its test cases, found by one reading against the brief "name what breaks the tool if this is wrong" (#werk-test-behaviours).
- The unit tests run on four parallel workers with a 15-second default limit per test (#werk-test-runner-parallel). Each worker registers one DOM before any test file and puts the runtime network, stream and timer globals back (#werk-test-dom, #werk-test-globals).
- The test run removes every variable that points at a real project, makes spawn, program lookup and the shell use the cleaned environment, and puts the fake agent first. The browser server refuses to start without the fake first (#werk-test-env).
- Each test writes to its own copy of every store, removed when the test ends (#werk-test-store).

### Runner and commands

`make test` runs the unit tests and component tests under `bun test`. `make test-coverage` runs them with coverage and then the gate. `make e2e` runs the browser tests (#werk-test, #werk-devex-tasks).

### Prior art in the prototype

- The prototype's browser specs boot the real server on a copy of a fixture project with a fake Claude Code first in the search list, and save a screenshot per test.
- The prototype has one fake Claude Code binary that replays a scripted event stream, and a harness that makes a temporary project. Its build tests use the same fake for the grader, the reviewers and the classifiers.
- The prototype has a coverage-gate script that reads the pure-file list after the coverage run.

## Out of Scope

- Multichat: tabs, fork, park, follow and the per-tab signals. Its card is postponed (#werk-multichat).
- The product diagram, the 3D graph, the Flow view and the Measure view (#werk).
- The tracker export, the validate stage against production, and pipeline self-measurement reports, including the fail report command and trend reports (#werk, #werk-v0-pipeline-log, #lp-trend).
- A spoken tier, tier escalation, and any tier other than feature (#werk-loop-tier).
- Sampling before the build (#werk-align-v0).
- The install channel and the release steps (#werk-dist-channel, #werk-release).
- Windows builds (#werk-dist).
- Any port of prototype code (#werk-base).
- Batch accept of ghosts, and direct edit of a ticket on the board (#werk-propose-new, #werk-board-control).

## Further Notes

- The from-scratch build tests #werk-base. A behaviour that the cards cannot rebuild is a missing card. The fix is a new card, not a copy of prototype code.
- The ticket-check operation is built before the plan, and shown working on hand-written tickets (#werk-ticket-check-verb). The held-out set is built and gated before the merge loop runs it at each merge (#werk-heldout-before-merge).
- Several rules about chat signals are written for tabs (#werk-mc-bgagents, #werk-mc-live-dead, #werk-mc-bg-line). In v0 they apply to the one conversation of each project. The line that a dead child shows "in every other pane" has no other pane in v0, so the dead mark shows in the conversation's own pane and as the busy or dead mark of its project in the switcher.
- #werk-dev names `npm run dev`. In v0 the same task is `make dev`, which calls the package script (#werk-devex-tasks).
- The overseer limits (60 seconds, 5 minutes) are tested only with parameterised limits and the fake agent (#st-build-seam).
