# Spec: werk v0

## Problem Statement

A person who builds software with Claude Code works in a chat transcript. The transcript only grows. The decisions that the conversation settles are buried in it, and nobody can see which decision rests on which other decision. When one decision changes, nothing marks the decisions that depend on it.

The person also cannot see the build. An agent that builds from the decisions works in a terminal. The person does not see which slice of work is running, which one failed, or why. To run two topics at once, the person opens a second terminal, and the second conversation starts empty and pays again for the context that the first one already holds.

werk has a working prototype of the answer. Its code was written to find the right shape, not to keep. It has shortcuts and it is difficult to change. The person needs a clean v0 that is built only from the decided cards, so that the cards prove they are enough to rebuild the behaviour (#werk-base).

## Solution

werk v0 is a visual layer over Claude Code with three views: the map, the board, and the chat (#werk).

1. **The map** draws the fold of an append-only log of decisions (#pr-log, #werk-write). Each card has a reason, typed links, options, and sources. A card that an agent adds is a proposal (a ghost) until the person accepts it (#werk-propose-new). A card cannot become decided until a program check passes (#werk-contract). A reopened card marks the cards that depend on it, as stale or as paused, by the reopen reason (#pr-wf-paused).
2. **The chat** sits beside the map. The composer sends a live agent turn to a Claude Code child, and the reply streams back (#werk-chat). Several conversations run at the same time, in tabs. Each tab is a fork of a session and has a home card (#werk-mc-scope).
3. **The board** shows the tickets of a build run in five columns. The person starts the run, triggers or stops one ticket, reorders, and archives (#werk-board).

Behind the board, the inner build loop turns a decided subtree into merged, tested code with no person in the middle (#werk-loop): a spec, then tickets, then a builder loop per ticket, then a merge loop per run, with an overseer that keeps every agent from getting stuck. Every run is a feature run, so every gate waits for the person (#werk-loop-tier).

v0 builds no separate alignment feature. Alignment before building comes from three gates that are already in v0: the accept of every proposed card, the proposed answers of the plan, and the build gates (#werk-align-v0).

v0 is a new project in a new git repository, whose main branch starts with zero files (#werk-base-repo). Tickets merge straight onto that main branch (#st-plan-main). Bun runs the server TypeScript directly, Vite transforms a React client, and the server reloads its own modules without killing a live agent (#werk-stack, #werk-hmr, #werk-dev). The agent that builds werk has a test harness it can run itself (#werk-test).

## User Stories

### The log and the map

1. As a person, I want every change to the map to be one event at the end of a log, so that nothing I decided is ever lost (#pr-log).
2. As a person, I want the map to be the fold of the log, with only the latest title, body, and links of each card, so that I read the current state and not a history (#pr-log).
3. As a person, I want a removed card to come back with a restore, so that a removal is never final (#pr-log).
4. As a person, I want no view to edit a drawn card in place, so that the log stays the only store (#werk-write).
5. As a person, I want a control in a view, such as accept or remove, to append an event, so that every view redraws from the same log (#werk-write).
6. As an agent, I want the command line to be my only write path to the map, so that I cannot change the map in a way the log does not record (#werk-write).
7. As an agent, I want a find operation that lists open cards in a subtree, without paused and stale cards, so that I can choose what to work on next (#werk).
8. As a person, I want a remove operation that takes a card and its refines subtree out of the map, so that a bad branch leaves the view but stays in the log (#werk).

### Proposals

9. As a person, I want every card, option, source, and excerpt that an agent adds to enter as a ghost, so that nothing enters the map without my accept (#werk-propose-new).
10. As a person, I want a ghost drawn grey or dashed under its proposed parent, so that I can tell "this card does not exist yet" from "this card has a pending change" (#werk-propose-new).
11. As a person, I want to accept one ghost at a time with a ✓ button, so that I read each card before it commits (#werk-propose-new).
12. As a person, I want an accept to also accept the ghost refines ancestors above the card, so that a click cannot orphan a card (#werk-propose-new).
13. As a person, I want a discard to also discard the ghost descendants of the card, so that no ghost hangs under a card that is gone (#werk-propose-new).
14. As a person, I want the words of a ghost frozen, so that what I accept is what I read (#werk-propose-new).
15. As an agent, I want link, status, and who to still work on a ghost, so that I can propose a card that is already decided, with its basis and options, as one unit (#werk-propose-new).
16. As a person, I want the edges of a ghost held, and live only when both ends are real, so that an accept needs no second event (#werk-propose-new).
17. As a person, I want a ghost outside every rollup, staleness mark, and unchallenged count, so that a proposal does not change the numbers before I accept it (#werk-propose-new).
18. As a person, I want an accept from the command line to refuse unless it states that I asked for it, so that an agent does not accept its own proposal by default (#werk-propose-new).

### The contract check

19. As a person, I want a card to move to decided only after a program check passes, so that the map's rules are not only prose (#werk-contract).
20. As an agent, I want a failed check to print the exact next command, so that I can fix the card in one step (#werk-contract).
21. As a person, I want the check to run on the held edges of a ghost too, so that a ghost proposed as decided obeys the same rule (#werk-propose-new, #werk-contract).
22. As a person, I want an amend of a decided card to run the same facts again, so that a change cannot skip the check (#werk-contract).

### Reopen reasons and staleness

23. As a person, I want a reopen to carry a reason, postponed or rejected, so that the marks on dependent cards say whether the content is still true (#pr-wf-paused).
24. As a person, I want a rejected reopen to mark the next hop only as stale, in red, so that each dependent card is reviewed in turn (#pr-wf-paused).
25. As a person, I want a postponed reopen to mark every downstream card as paused, in grey, with the status colour kept, so that deferred work reads calm and distinct (#pr-wf-paused).
26. As a person, I want stale to win when a postponement and an invalidation reach one card, so that a real invalidation never looks calm (#pr-wf-paused).
27. As a person, I want the staleness view to show the reopen reason of each mark, so that I know what to do with each card (#werk).

### Excerpts

28. As a person, I want a quote on a card to be found verbatim in a transcript, so that no quote is written from memory (#werk-excerpt).
29. As a person, I want an excerpt to record the message index, the span, the speaker, and the session, so that I can find the quote again (#werk-excerpt).
30. As a person, I want a quote that does not match exactly, or that matches more than one message, to fail, so that the tool never guesses (#werk-excerpt).

### Card rendering

31. As a person, I want a `#card-id` in a body, a why line, a note, or a chat message to be a link, so that I can follow a reference with one click (#werk-reflink).
32. As a person, I want only an id the map knows to become a link, so that every link lands somewhere (#werk-reflink).
33. As a person, I want a bare id with a hyphen or a colon to link, and a bare single word not to link, so that ordinary English stays plain text (#werk-reflink).
34. As a person, I want a code span that holds only an id to link, and a command in a code span to stay code, so that commands are not broken into links (#werk-reflink).
35. As a person, I want fenced blocks, headings, and URL fragments left alone by the link rule, so that the rule never breaks other syntax (#werk-reflink).
36. As a person, I want the card summary in a grid tile not to contain links, so that the tile stays a valid button (#werk-reflink).
37. As a person, I want fenced code in a card boxed, highlighted, and scrollable sideways, so that code reads the same as in chat (#werk-codeblock).
38. As a writer of a card, I want the renderer not to reformat my code, so that the code shows as I indented it (#werk-codeblock).

### Card wording

39. As a reader of a card, I want its words to describe its subject and not the session that wrote it, so that the card is still true when I read it cold (#werk-wording).
40. As a reader of a card, I want no file, function, or line names in its text, so that the card does not go stale on a refactor (#werk-wording).

### The chat

41. As a person, I want Enter in the composer to send my text, pasted images, the open card, and the active tab to the server, so that the agent gets the full context with no paste step (#werk-chat).
42. As a person, I want the reply to stream back over the live channel, so that I see the turn as it runs (#werk-chat).
43. As an agent, I want to read a card's thread and write a note to it from the command line, so that my answer lands on the card (#werk-chat).
44. As a person, I want each turn to start with the card I am looking at, so that the agent never answers about the wrong subject (#werk-chat, #werk-mc-follow).

### Multichat

45. As a person, I want several conversations at the same time, each in a tab, so that a second topic does not wait for the first (#werk-multichat).
46. As a person, I want a new conversation to fork the parent session, so that it shares the cached prefix and the understanding built so far (#werk-mc-fork).
47. As a person, I want a second, explicit way to start an empty conversation, so that an unrelated topic does not carry the parent's context (#werk-mc-fork).
48. As a person, I want each conversation to have a home card that names the tab and seeds the first turn, without a fence, so that a conversation can still go anywhere (#werk-mc-split).
49. As an agent, I want to read what a sibling conversation said from its session log on demand, so that I am not fed a diff on every tab switch (#werk-mc-shared).
50. As an agent, I want to read a card from the map before I write it, so that a stale context in my tab is never a wrong write (#werk-mc-shared).
51. As a person, I want a plain click on a card to move the map and keep the current conversation, so that I can browse while a turn runs (#werk-mc-open).
52. As a person, I want Shift+click on a card to fork a conversation rooted there and focus it, so that one gesture starts a new topic at that card (#werk-mc-open).
53. As a person, I want Shift+click on a card that already has a tab to switch to that tab, so that I do not fork the same card twice (#werk-mc-open).
54. As a person, I want a '+' at the end of the tab strip to fork at the open card, so that I can fork without a card link (#werk-mc-open).
55. As a person, I want the tab strip as the last row of the pane, with real tabs flush to the pane edges, so that the strip costs one row and never moves (#werk-mc-tabs).
56. As a person, I want each chip to show the home card id and a state dot, so that I can read every tab at a glance (#werk-mc-tabs).
57. As a person, I want Cmd+1 to Cmd+5 and Cmd+[ / Cmd+] to switch tabs, so that I can move between conversations from the keyboard (#werk-mc-tabs).
58. As a person, I want at most five visible chips, with the least recently touched idle tab parked, so that the strip stays readable (#werk-mc-park).
59. As a person, I want a running tab never parked, so that a live turn stays in view (#werk-mc-park).
60. As a person, I want a '…' menu that lists every conversation, marks visible, parked, and active ones, and shows the total count, so that I reach every conversation in one place (#werk-mc-park).
61. As a person, I want an un-park to resume the session from disk, so that a parked conversation continues where it stopped (#werk-mc-park).
62. As a person, I want a close control on a tab to park it at once, not end the session, so that nothing is ever closed for good (#werk-mc-park).
63. As a person, I want a parked session's process killed after 30 minutes idle, and resumed when I reopen it, so that idle processes do not pile up (#werk-mc-park).
64. As a person, I want focusing a tab to move the map to that tab's card, so that the map and the conversation always share one subject (#werk-mc-follow).
65. As a person, I want each tab to keep its own map position, so that switching away and back restores where I was (#werk-mc-follow).
66. As a person, I want an unsent draft to belong to its tab, so that what I typed under one card survives a switch (#werk-mc-follow).
67. As a person, I want a permission ask answered only on its own tab, so that a question never interrupts the tab I am reading (#werk-mc-asks).
68. As a person, I want a tab with a pending ask to blink, and the '…' button to blink when that tab is hidden, so that I see from any tab that another one is blocked (#werk-mc-asks, #werk-mc-live).
69. As a person, I want red to win over yellow on every surface, so that a dead child is never hidden by an ask (#werk-mc-asks).
70. As a person, I want a running dot on the chip and on the tab's home card in the tree, so that I see which turns still run (#werk-mc-live).
71. As a person, I want a tab with a background agent still going to read as running, so that a finished main turn does not look idle too early (#werk-mc-live).
72. As a person, I want a dead child in a background tab to show a line in the pane I am looking at, with the tab's name, so that I do not find a death by chance (#werk-mc-live).

### The board

73. As a person, I want a board with the columns blocked, ready, building, merging, and done, so that I watch the build as it runs (#werk-board-columns).
74. As a person, I want a ticket card to show only its title, a retry count after more than one retry, and a count of unmet blocking tickets, so that the board stays readable (#vi-board).
75. As a person, I want a building ticket with a live session to pulse, and stop pulsing the moment the session ends, so that the pulse means "a session runs now" (#vi-board).
76. As a person, I want a click on a ticket to open a drawer with the slice on the left and the metadata on the right, so that I can read a long brief and its relations together (#vi-board).
77. As a person, I want a click on a cited card id in the drawer to open that card on the map, so that I can check a ticket against its decisions (#vi-board).
78. As a person, I want a live log preview in the drawer of a building ticket, dropped when the ticket leaves building, so that I see the running session and not a stale transcript (#vi-board).
79. As a person, I want a red held-out step shown as a badge on the done ticket whose merge it followed, linked to the follow-up ticket, so that a known break is visible without a new column (#werk-board-columns).
80. As a person, I want to reorder tickets within ready, so that I choose the build order (#werk-board-control).
81. As a person, I want to archive a ready, blocked, or building ticket after a confirmation that says it can be restored, and no archive action on a merging or done ticket, so that I remove a ticket without losing it (#werk-board-control).
82. As a person, I want to trigger the build of one ready ticket inside an active run, by the trigger icon or by a drag into building, so that I start one ticket early (#werk-board-control).
83. As a person, I want to end a build that goes the wrong way by archiving its ticket, which ends the build and keeps its branch, so that one reversible action stops a build and no other move returns a building ticket to ready (#werk-board-control).
84. As a person, I want nothing to build before I start the merge loop on a plan run, and that start to trigger the whole run, so that the build order stays my choice and one action starts the run (#werk-board-control).
85. As a person, I want every other column move made by an agent or by the merge loop, so that the board shows the real state of the loop (#werk-board-control).
86. As a person, I want to ask an agent to change a ticket, not edit it on the board, so that the ticket-set checks run again (#werk-board-control).

### The inner build loop

87. As a person, I want the plan to end with one spec per decided subtree, then tickets from that spec, so that all tickets split one agreed whole (#st-spec).
88. As a person, I want every answer that the spec or ticket writer gives and no card gives to come back as a proposed card, so that I can see and reopen every new decision (#st-spec).
89. As a builder, I want each ticket to be a tracer-bullet slice with what to build, acceptance criteria, stories, cites, blocked_by, and checks, so that one fresh context can build it (#st-ticket).
90. As a person, I want each ticket to list the spec stories it delivers, frozen at the build, so that done is stated from my side and fixed before the build (#st-ticket-stories).
91. As a person, I want blocked_by to be the delivery order that the planner decides, and checked with the whole ticket set, so that the order is an explicit choice and not a side effect of the card links (#st-ticket, #st-ticket-set-checks).
92. As a builder, I want one ticket in one worktree that starts from the tip of the main line, with a fresh agent per pass, so that a long context does not degrade my work (#st-build-ticket, #lp-stateless, #st-plan-main).
93. As a builder, I want the last failure, cut to about 4,000 characters, in the next pass's prompt, so that I know what to fix (#lp-stateless).
94. As a person, I want each pass committed, and one line per pass with check results, time, and cost, so that I can read what each pass did (#lp-stateless).
95. As a person, I want a check to be one command and its exit code, so that a check is never argued with (#lp-checks).
96. As a person, I want a grader to judge the diff against each acceptance criterion of the ticket and against each decided card in the ticket's depends_on closure, cited or not, with a score and the gap for each line, so that a diff that misses a criterion or builds the wrong thing fails (#lp-prod-judge).
97. As a person, I want five reviewers, one per quality area, to read the diff, so that problems no card names are caught (#lp-prod-review).
98. As a person, I want a CRITICAL or HIGH finding to fail the pass, and MEDIUM and LOW to be recorded only, so that the loop stops on real problems only (#lp-prod-review).
99. As a person, I want a retry cap, default 5, to stop a builder loop that does not converge, so that a run cannot loop forever (#st-build-ticket).
100. As a person, I want the merge loop to merge one ticket at a time after the checks pass on the run's tree plus the ticket, so that tickets that are green alone are also green together (#st-build-run).
101. As a person, I want a red check in merging to send the ticket back to the builder loop with the failure, so that a broken merge never lands (#st-build-run).
102. As a person, I want the held-out set to run after each merge, and a red step to file a follow-up ticket while the merge stands, so that a break is found at the merge that caused it (#st-validate-heldout, #st-g2-heldout).
103. As a person, I want the builder never to see the held-out steps, so that the builder cannot game the bar (#lp-prod-heldout).
104. As a person, I want G2 to wait until every held-out step is green on the final tree, so that I never approve a known break (#st-g2-heldout).
105. As a person, I want an overseer to act on an unanswered permission ask, an unintentional loop, and a tool call with no timeout, so that no agent stays stuck (#lp-overseer).
106. As a person, I want every run to be a feature run, with a tier event written at the start, so that every gate waits for me and every run has a first event (#werk-loop-tier, #st-tier-default).

### The dev loop and the harness

107. As an agent that edits werk, I want a change to the server code to reload the changed module in the same process, so that a live chat session survives my edit (#werk-hmr, #werk-dev).
108. As a person, I want a second server start on the same project to wait up to 5 seconds for the lock and then refuse, so that two servers never share one log (#werk-dev).
109. As a person, I want a client change to reach the page without losing my composer draft, so that a reload costs nothing (#werk-dev).
110. As an agent, I want to run the unit tests, the coverage gate, and the browser tests from the command line, so that I can see the result of what I build (#werk-test).

### Plan output, merge target, and the base repository

111. As a person, I want every ticket to have the same five header lines (title, cites, blocked_by, stories, touches) and the same three sections (What to build, Acceptance criteria, Checks), in a fixed order, so that I find each field in the same place (#st-ticket-shape).
112. As a person, I want a ticket that misses a header line or a section to fail its own check, with the missing field named, so that a missing field is a plain failure and not a guess (#st-ticket-shape).
113. As a scheduler, I want the touches line to name modules as concepts and not as file paths, so that I can compare two tickets before I build them at the same time (#st-ticket-shape, #st-build-parallel).
114. As a person, I want the spec writer and the ticket writer each to return a list of new answers, each with a slug, a title, a why, and a body, so that the program and not the writer puts each answer on the map (#st-spec-answers).
115. As a person, I want each answer proposed as a ghost that refines the subtree root, with the id formed from the root id and the slug, so that I find every new answer under the subtree it belongs to (#st-spec-answers).
116. As a person, I want the plan to report an answer that it cannot propose, such as an id already in the map, and exit with an error, so that no answer is lost without a sign (#st-spec-answers).
117. As a person, I want each ticket that passes its checks to merge straight onto the main line, with no integration branch, so that there is one line to read (#st-plan-main).
118. As a person, I want a merge to move a checkout of the main line with a fast-forward, and to stop when local changes block the fast-forward, so that my files follow the branch and my local work is never overwritten (#st-plan-main).
119. As a person, I want G2 to open for the tip of the main line when every ticket of one subtree is merged and every held-out step is green, and a later merge to open it again, so that each approval covers the current tree (#st-plan-main, #st-g2-heldout).
120. As a person, I want up to 3 unblocked tickets to build at the same time, and two tickets to build together only when they touch no common module, so that a run goes faster without two builds editing the same module (#werk-board-control, #st-build-parallel).
121. As a person, I want a plan to archive an open ticket that the current spec no longer needs, with that reason, and a restore to put it back, so that old tickets do not build and nothing is lost (#werk-board-control, #st-plan-archive).
122. As a person, I want v0 built in a new git repository whose first commit holds no files, so that no file, history, or map state of the prototype becomes v0's base (#werk-base-repo).
123. As a builder, I want the first tickets to set up the project from the empty tree — package files, build and test targets, and the folder layout — so that every later ticket has a project to build in (#werk-base-repo).
124. As a builder, I want the held-out set built and gated on the run's tree before the merge loop calls it at each merge, so that a red result points at one part only (#werk-heldout-before-merge).

### Module shape and the ticket checks

125. As a builder, I want each command-line verb in its own module, registered by that module, so that a ticket that adds a verb edits no shared list of verbs (#werk-verb-registry).
126. As a person, I want the verb list that the command line prints to come from the registered verbs, so that the list is never out of step with the verbs that exist (#werk-verb-registry).
127. As a scheduler, I want werk's modules single-purpose and small, with a shared list that holds only entries, so that two independent tickets touch no common module and can build at the same time (#werk-stack-modules, #st-build-parallel).
128. As a person, I want to run the ticket checks on a folder of ticket files from the command line, outside a plan, so that the ticket format and its checks work before the plan that calls them exists (#werk-ticket-check-verb).
129. As a person, I want the ticket-check operation to print each failure with its ticket, its check, and its field, and to run the same checks as the plan, so that a failure is found the same way in both places (#werk-ticket-check-verb, #st-ticket-checks-run, #st-ticket-own-checks, #st-ticket-set-checks).
130. As an agent that changes a ticket on a person's request, I want to run the set checks again with the ticket-check operation, so that my change keeps the ticket set valid (#werk-ticket-check-verb, #werk-board-control).
131. As a person, I want the set checks to count only the tickets that passed their own checks, so that a ticket that is not on the board never counts as coverage for a card or a story (#st-ticket-set-checks).
132. As a person, I want a failed blocked_by check to block only the ticket that names a blocker not in the set and the tickets on a cycle, so that a correct ticket and its correct blockers can still start (#st-ticket-set-checks, #st-ticket-partial).
133. As a person, I want a part of a card that the diff does not build yet to pass its grader line, so that a ticket is not failed for work that another ticket builds (#lp-prod-judge, #st-ticket-set-checks).

134. As a person, I want the ticket-check operation to give three different exit codes for a pass, a failed check, and a call that could not run the checks, so that a malformed call never reads as a pass (#st-ticket-checks-run).
135. As a person, I want a set failure that no ticket owns, such as an uncited card or an undelivered story, to name the ticket set, so that I find the place to fix without reading the rest of the output (#st-ticket-checks-run).

### The test harness and the fake agent

136. As a test writer, I want each command-line, server, and browser test to get a fresh project directory with a git repository and an empty map, removed when the test ends, also when it fails, so that no test reads what another test wrote (#werk-base-test-project, #werk-test-store).
137. As a test writer, I want a test that must edit werk's own source to edit a copy of the code and run the app from that copy, so that the checkout stays clean when the test fails (#werk-test-store).
138. As a person, I want the unit test run to remove every setting that points at a real project before the first test, so that no test can write to the map I work in (#werk-test-env, #werk-test-external).
139. As a person, I want the unit test run to put the fake agent first in the program search list and to make process spawn, program lookup, and the shell default to that cleaned environment, so that a test that starts an agent with no environment of its own still finds the fake (#werk-test-env).
140. As a person, I want the browser test server to refuse to start when the fake agent is not first in the program search list, so that a leak fails at once and not as a bill or a changed map (#werk-test-env).
141. As a test writer, I want one fake agent for the command-line, server, and browser tests, which exits with an error when no script is installed, so that the harnesses test the same behaviour and a fake never invents an answer (#werk-test-env, #werk-test-external).
142. As a test writer, I want a script to be an ordered list of steps, each an event to print or a file to write, plus an exit code, so that a test can check what was on disk when each event arrived (#werk-v0-seams-fake-script).
143. As a person, I want a scripted edit whose path leads outside the temporary project to fail and write nothing, so that a wrong script cannot change files on the machine (#werk-test-fake-edit-inside).
144. As a test writer, I want each launch of the fake agent to record its arguments in the temporary project, so that a test checks what werk asked the agent (#werk-test-fake-launch-log).
145. As a test writer, I want an ask step to print the permission request without waiting, and the next steps to play at once, so that I can script an ask followed by a stall, a loop, or a crash (#werk-test-fake-ask-open).
146. As a test writer, I want the fake to take an ask's answer from its input channel, to deny it at the end of the turn when it has no input channel, and to exit with no tool result and no final result on a crash with an ask open, so that the fake behaves as a real agent does (#werk-test-fake-ask-open).
147. As a test writer, I want each scripted pause to add a 20 ms margin, so that a test never measures a silence shorter than the script asks for (#werk-test-fake-ask-open).
148. As a test writer, I want every agent that werk starts to carry a role name in its environment, in production and in tests, so that the fake picks the scripted reply for that role and a prompt rewording breaks no test (#st-build-seam-role-env).
149. As a test writer, I want the fake in the chat role to play one scripted reply per message and to exit only when its input closes, so that a chat test can send many messages to one conversation (#werk-chat-fake-role, #werk-onechat).
150. As a test writer, I want the fake in every other role to read the first message, play one reply, and exit with the script's code, with a permission answer counted as part of that reply, so that a build-pass test never hangs on an open input (#werk-chat-fake-role, #lp-stateless).

## Implementation Decisions

### Project base

- v0 is built in a new git repository, separate from the prototype's repository. Its first commit holds no files. The main branch of that repository is the main line of every #werk build (#werk-base-repo, #st-plan-main). The prototype stays in its own repository. A builder may read it, but no build starts from it and nothing merges into it.
- The spec and the first tickets set up the project from the empty tree: the package files, the build and test targets, and the folder layout (#werk-base-repo).
- v0 has its own package list, lockfile, compiler configuration, and test configuration, and nothing in it imports from the prototype. Every check runs inside v0's repository and installs the locked packages first when they are missing (#werk-base-dir, #werk-test-fresh-tree). These files sit at the root of v0's own repository, not in a directory inside the prototype's repository (see the proposed card #werk-base-dir-root).
- v0 starts empty. Nothing is ported. The decided cards that #werk depends on are the spec. The prototype is a reference to read, not to copy (#werk-base).
- The kill criterion for the from-scratch choice is recorded on #werk. The prototype's behaviour sets the bar. If the criterion fires, the fallback is to extend the prototype code (#werk-base).
- Three parts: the log, the fold, and the web view (#werk). werk's log is its own working implementation of #pr-log, not a consumer of a separate engine.
- Bun runs the server TypeScript directly under `bun --hot` in dev (#werk-hmr). The client is React, transformed by Vite, so v0 has a client build step (#werk-stack). Islands are the hydration pattern, and progressive loading is a shape of the API, not a framework feature (#werk-stack).

### Modules

1. **Log.** An append-only file of events. Append and read only. No event is ever rewritten or deleted (#pr-log). A proposed card is its own event type, not a flag on an added card (#werk-propose-new).
2. **Fold.** A pure function from the event list to the map state: nodes with their latest words and status, live edges, held ghost edges, rollups, stale and paused marks with their trace, and the unchallenged count. A ghost sits in the nodes with a proposed flag and outside every derivation. Its edges wait in a separate set and go live when both ends are real (#werk-propose-new). Stale marks the next hop; paused marks every downstream card; stale wins over paused (#pr-wf-paused).
3. **Command line.** The only write path (#werk-write). Each verb appends events. It holds the contract check at the move to decided (#werk-contract), the accept gate for ghosts with its actor claim (#werk-propose-new), the find and remove verbs (#werk), the quote verb for excerpts (#werk-excerpt), the note verbs (#werk-chat), the build verbs (#werk-loop), and the ticket-check verb (#werk-ticket-check-verb). Each verb is its own module and registers itself, so a new verb edits no central list, and the printed verb list comes from the registered verbs (#werk-verb-registry). The command form of each verb lives on its own card under #werk-cli.
   - Every module is single-purpose and named for that purpose. A behaviour that more than one feature needs is its own module. A shared list, such as the routes or the views, holds only entries, and each entry's code lives in its own module (#werk-stack-modules).
4. **Server.** One process per project directory, guarded by a lock with a 5-second wait and a port retry of 20 tries at 250 ms (#werk-dev). A guard on the global object keeps a hot reload from starting a second server or a second agent (#werk-hmr). It serves the client, the read API, and one live event channel (SSE). The channel pushes "changed" when the log changes and "reload" when the client code changes (#werk-dev). In dev, the server runs Vite inside its own process to transform the client. A client change that Vite cannot apply in place sends the "reload" event, and the composer draft is kept in session storage across it (#werk-client-reload).
5. **Conversation manager.** One Claude Code child per conversation, spoken to over stream-json (#werk-chat). It forks a session with the fork-session option (#werk-mc-fork), stores the session id and the home card of each conversation (#werk-mc-split), parks, un-parks, and reaps idle children after 30 minutes (#werk-mc-park), and keeps one ask at a time per conversation (#werk-mc-asks). It reports running, waiting, and dead per conversation (#werk-mc-live).
6. **Board state.** Ticket state is its own append-only log beside the decision log (#vi-board-state). The board view folds it into the five columns (#werk-board-columns). The board actions write to it through the server (#werk-board-control).
7. **Build pipeline.** Plan (spec, then tickets), builder loop, merge loop, held-out set, and overseer (#werk-loop). Each pass is a fresh headless agent in a worktree that starts from the tip of the main line, never from a snapshot of a working tree (#lp-stateless, #st-plan-main). Inside one pass, the checks stop at the first red, then the grader runs, then the review (#st-build-ticket-order). Every time limit is a parameter (#st-build-seam). Every run writes a feature tier event first (#werk-loop-tier).
   - The plan reads the spec writer's and the ticket writer's answer records and proposes each one as a ghost that refines the subtree root. The id is the root id, a hyphen, and the slug. The one who decides is the agent. A record that the plan cannot propose is reported, and the plan exits with an error (#st-spec-answers).
   - The plan runs the eight checks on each ticket, each read from the ticket file alone: title, shape, size (4,000 characters or fewer), what-to-build, acceptance, no-file-paths, make-targets, and touches (#st-ticket-own-checks). A file with no title line is not parsed, and no other check runs on it. It then runs the three checks on the whole set: cards cited, stories delivered, and blocked_by (#st-ticket-set-checks). The set checks read only the tickets that passed their own checks. The blocked_by check fails a number that is not a ticket in the set, and a cycle. No check compares blocked_by with the depends_on edges between the cited cards. A failed set check blocks only the tickets it names (#st-ticket-partial). The plan and the ticket-check verb call the same checks (#werk-ticket-check-verb). A plan archives an open ticket that the current spec no longer needs (#st-plan-archive).
   - The merge loop merges onto the main line, with no integration branch. A checkout of the main line moves by fast-forward. Local changes that block the fast-forward stop the merge, and nothing moves (#st-plan-main).
   - Up to 3 unblocked tickets build at the same time. Two tickets build together only when their touches lines name no common module (#st-build-parallel).
   - The held-out set is its own slice before the merge loop: the step author, the binder, the run on the run's tree, the feedback to the builder, and the G2 refusal while a step is red. The merge loop then adds the run after each merge and the follow-up ticket on a red step (#werk-heldout-before-merge).
8. **Client.** Three views: the map, the board, and the chat pane (#werk). The Markdown renderer adds card links by the rules of #werk-reflink and boxes fenced code with highlighting (#werk-codeblock). The open card lives in the location hash. Each tab owns its card, its map position, and its draft (#werk-mc-follow).
9. **Fake agent.** One scripted binary that stands in for every Claude Code child: the chat agent, the builder, the grader, the reviewers, the classifiers, the step author, and the binder (#st-build-seam, #werk-v0-seams). It is found first in the program search list under the real agent's name, and reads the script of its temporary project at launch. A script is an ordered list of steps — an event printed as one line of the agent's output stream, or a file written inside the project — and an exit code (#werk-v0-seams-fake-script). An edit outside the project fails (#werk-test-fake-edit-inside). Each launch records its arguments in the project (#werk-test-fake-launch-log). An ask step does not block the steps after it; open asks are settled just before the final result (#werk-test-fake-ask-open). With no script installed, the fake exits with an error (#werk-test-env).
   - The fake picks its reply by the role name in the environment of its launch, not by the prompt text or the launch order (#st-build-seam-role-env). The role also sets its lifetime: in the chat role it plays one reply per message and exits when its input closes; in every other role it plays one reply and exits (#werk-chat-fake-role).
10. **Test harness.** It gives every test a fresh project directory with a git repository and an empty map, and removes it and stops any server on it when the test's scope ends (#werk-base-test-project, #werk-test-store). Before the first unit test it removes every setting that points at a real project, puts the fake agent first in the program search list, and makes process spawn, program lookup, and the shell default to that cleaned environment. The browser test server refuses to start when the fake agent is not first in the search list (#werk-test-env, #werk-test-external).

### Interfaces between the modules

- The command line and the server both append through the log module. Neither writes a card in any other way (#werk-write).
- Every read goes through the fold. The browser, the command line, and the build pipeline read the same fold of the same log (#pr-log).
- The server talks to each agent over stream-json, as a child process (#werk-chat). The build pipeline starts a headless one-shot child per pass (#lp-stateless).
- The client gets the graph from the read API and refetches it on a "changed" event. It reloads itself on a "reload" event (#werk-dev).
- The board reads ticket state from its own log, not from card status (#vi-board-state).

### Contracts

- The chat request carries the text, the pasted images, the open card, and the active conversation tab. The reply streams over the live channel (#werk-chat).
- The server has no note route. A person writes through the composer, and the agent reads a card's thread and writes a note to it from the command line (#werk-chat).
- An edge proposed with a card accepts or discards with that card, never alone. Accepting a child accepts its ghost refines ancestors. Discarding a card discards its ghost descendants. Accept is one card at a time (#werk-propose-new).
- A ticket starts with five header lines in this order: title, cites, blocked_by, stories, and touches. Three sections follow in this order: What to build, Acceptance criteria, and Checks. Cites, blocked_by, and stories may be empty, and Checks may have no bullet, but every line and heading must be present. Cites holds card ids, with or without the hash sign. Blocked_by and stories hold numbers separated by commas. Touches holds module names as concepts. A ticket names no file paths (#st-ticket, #st-ticket-shape, #st-ticket-stories).
- blocked_by is the delivery order that the planner decides. It is not derived from the depends_on edges between the cited cards (#st-ticket).
- The ticket-check operation reads a folder of ticket files, runs the checks on each ticket and the checks on the whole set, and prints each failure with the ticket, the check, and the field (#werk-ticket-check-verb, #st-ticket-checks-run). It needs the folder, the decided cards the tickets may cite, and the spec whose stories they deliver. A set failure that no ticket owns names the ticket set. The exit code separates three outcomes: a pass, a failed check, and a malformed call (#st-ticket-checks-run). The line form and the codes 0, 1, and 2 live on the command card #werk-ticket-check-verb-form.
- Every agent process that werk starts carries a role name, a short fixed word such as builder or grader, in its environment. The real agent ignores it. A new kind of agent gets a new role name (#st-build-seam-role-env).
- An answer record from a writer has a slug, a title, a why that names the question it settles, and a body (#st-spec-answers).
- G2 belongs to the tip of the main line for the tickets of one subtree. It opens when every ticket of that subtree is merged and every held-out step is green. A later merge opens it again (#st-plan-main, #st-g2-heldout).
- The grader scores two kinds of line. Each acceptance criterion of the ticket is a delivery line. Each decided card in the ticket's depends_on closure, cited or not, is a contradiction line. A part of a card that the diff does not build yet passes its contradiction line. For each line the grader returns a score from 1 to 5, where 3 passes, and what is wrong, with the file, line, or test that shows it. On a fail, the next builder pass gets that text with the brief (#lp-prod-judge, #lp-stateless). A review finding has a severity, a file and a line, an impact, and a fix (#lp-prod-review).
- A builder pass appends one line to the run's record: check results, time, and cost (#lp-stateless).

### Scope cuts inside v0

- Board: all five columns and all actions, no subset (#werk-board).
- Multichat: fork, split, shared memory, open, tabs, park, follow, asks, live (#werk-mc-scope).
- Build loop: plan, builder loop, merge loop with the held-out set, overseer, stateless passes, pipeline tests, at full scope. The risk tier is fixed at feature (#werk-loop-tier).
- Alignment: no separate feature. The accept gate (#werk-propose-new), the plan's proposed answers (#st-spec, #st-spec-answers), and the build gates (#werk-loop-tier) carry it. The rest of #align is out of v0 (#werk-align-v0).
- Trend reports are not built. The review still records MEDIUM and LOW findings per ticket, so a later trend report has its input (#werk-loop, #lp-prod-review).

## Testing Decisions

### What makes a good test

A test checks what a person or an agent sees from outside: a page in a browser, the exit code and output of a command, the events in the log, the branch and its commits, the board state. It does not check internal function calls (#st-build-seam). A visual test asserts on structure, and its screenshot is kept as evidence, not as the verdict (#werk-test).

### The seams

v0 is tested at two seams (#werk-v0-seams). Both are the highest seam for their half of the product, and both put one scripted fake agent binary first on the PATH, so no test reaches a real agent (#werk-test-env). Each test runs on its own fresh project directory with an empty map (#werk-base-test-project).

1. **The command line**, run against a temporary project directory and a temporary git repository (#st-build-seam). It covers every write path: the log events of each map verb, the ghost and accept rules, the contract check, reopen reasons and marks, excerpts, notes, and the whole build pipeline: plan, builder loop, merge loop, held-out set, and overseer. Every time limit is set to milliseconds.
2. **The browser**, through the Playwright test runner against a real server on a copy of a fixture project (#werk-test). It covers the map, card rendering and links, ghosts and the ✓, the chat pane, multichat tabs, park and follow, ask and death signals, and the board with its drawer and actions.

The command-line seam also covers the new plan and merge rules. A test feeds the fake writers a ticket with a missing header line and checks that its own check fails and names the field. A test feeds answer records and checks the ghost cards under the subtree root, and that a record with an id already in the map makes the plan exit with an error. A test merges onto a temporary main line with a checkout, and checks the fast-forward, and the stop when local changes block it. A test checks that two tickets whose touches lines share a module do not build at the same time (#st-ticket-shape, #st-spec-answers, #st-plan-main, #st-build-parallel). A test runs the ticket-check operation on a fixture folder of ticket files, with one valid set and sets that break each own check and each set check, and checks the printed ticket and field and the exit code (#werk-ticket-check-verb). The same fixture folder holds a ticket that fails its own checks and is the only one to cite a card, and a ticket that names that failed ticket as its blocker. The test checks that the cards-cited check lists the card, and that the blocked_by failure names the waiting ticket and not its correct blockers (#st-ticket-set-checks). A test feeds the fake grader a ticket with two acceptance criteria and checks that the grader receives one delivery line per criterion and one contradiction line per decided card in the closure (#lp-prod-judge). A test adds a verb module to a temporary copy of the command line and checks that the printed verb list names it with no edit to any other module (#werk-verb-registry). The ticket-check test also checks the three exit codes: a valid set, a broken set, and a call with a missing spec (#st-ticket-checks-run).

The fake agent and the harness are tested at the same command-line seam, as the first slice that later slices depend on. A test scripts an event, an edit, and a second event, and checks that the file is on disk when the second event arrives (#werk-v0-seams-fake-script). A test scripts an edit to a path outside the project and checks that the step fails and nothing is written (#werk-test-fake-edit-inside). A test reads the launch record and checks the arguments werk passed (#werk-test-fake-launch-log). A test scripts an ask, a pause, and a crash, and checks that the pause and the crash play before any answer, and that the crash leaves no tool result and no final result (#werk-test-fake-ask-open). A test starts the fake in the chat role, sends two messages, closes the input, and checks two replies and one exit; a second test starts it in the builder role with an ask, answers the ask, and checks one reply and the script's exit code (#werk-chat-fake-role, #st-build-seam-role-env). A test starts an agent with no environment of its own and checks that the fake answers, and a test checks that the run removed every setting that points at a real project (#werk-test-env). A browser-harness test checks that the server refuses to start when the fake is not first in the search list (#werk-test-env).

The browser seam also checks that a building ticket shows the archive action and a merging or done ticket does not, and that archiving a building ticket ends its pulse and keeps it restorable (#werk-board-control, #vi-board).

No seam sits below these two for behaviour. Pure code — the fold, the link rule, the Markdown renderer, the board fold — also gets unit tests and a 90% coverage gate over an explicit list of pure files (#werk-test). An I/O module gets a sampled list of named behaviours as its test cases, not a percentage (#werk-test).

### Runner and commands

`bun test` runs the server code and the React components. `bun run test:coverage` runs the same tests with coverage and then the 90% gate. `bun run e2e` runs the browser tests against the real server (#werk-test).

### Prior art in the prototype

- The prototype's browser specs boot the real server on a copy of a fixture project with a fake `claude` first on the PATH. They block the chat route and outside script hosts, clear local storage, and save a screenshot per test as evidence. The board specs run in order on one server, and the specs that write run last.
- The prototype has one fake Claude binary that replays a scripted event stream, and a test harness that makes a temporary project. The build tests use the same fake for the grader, the reviewers, and the classifiers.
- The prototype has a coverage-gate script that reads the pure-file list after the coverage run.

## Out of Scope

- The product diagram, the 3D graph, and the Flow view (#werk).
- The tracker export to Linear or GitHub Issues (#werk).
- The validate stage against production, and pipeline self-measurement (#werk).
- Trend reports across tickets (#werk-loop, #lp-trend).
- A spoken tier, tier escalation, and any tier other than feature (#werk-loop-tier).
- Any port of prototype code (#werk-base).
- Batch accept of ghosts (#werk-propose-new).
- Direct edit of a ticket on the board (#werk-board-control).
- A push of "what changed since your fork" into a tab (#werk-mc-shared).
- An integration branch per subtree (#st-plan-main).
- Every part of #align except the accept gate, the plan's proposed answers, and the build gates (#werk-align-v0).
- Any build in, or merge into, the prototype's repository (#werk-base-repo).

## Further Notes

- #werk-mc-live leaves one point open: a dead background child pushes a line into the focused pane, while a pending ask only blinks. #werk-mc-asks sets red over yellow on every surface. v0 builds both signals for a dead child, the red dot and the pane line, because the card decides the line and rejects a silent dot.
- The overseer's 60-second silence and 5-minute loop check are tested only with parameterised limits and the fake agent (#werk-loop, #st-build-seam).
- #werk-base-repo and #werk-base-dir conflict. #werk-base-dir puts v0 in one directory inside the prototype's repository. #werk-base-repo puts v0 in a new repository and rejects every layout that shares the prototype's repository. #st-build-target also says every project builds in a repository of its own. This spec follows #werk-base-repo and keeps the parts of #werk-base-dir that do not depend on the location: v0's own packages and checks, and no import from the prototype. The choice is the proposed card #werk-base-dir-root. One of the two cards needs a reopen.
- Story 83 now describes how a person ends a build: by archiving its ticket. #werk-board-control removed the drag from building back to ready. Story 81 adds the building ticket to the tickets that can be archived.
- #werk-chat rejects a note route on the server. The earlier contract for that route is gone.
- The ticket order follows #werk-ticket-check-verb: the ticket format and its checks are a slice of their own, shown working from the command line before the plan slice that calls them.
- #werk-verb-registry and #werk-stack-modules exist so that the touches lines of independent tickets do not overlap. The first tickets that set up the project (#werk-base-repo) put the verb registration in place, so that later verb tickets can build at the same time.
- #lp-stateless says a pass makes its worktree from a snapshot of the working tree. #st-plan-main says each build starts from the tip of the main line, never from a snapshot. This spec follows #st-plan-main, which is the more specific rule for a ticket build.
- The ticket order follows #werk-heldout-before-merge: the held-out set slice comes before the merge-loop slice that calls it at each merge.
- The from-scratch build is itself the test of #werk-base: if the decided cards are not enough to rebuild a behaviour, the gap is a missing card, and the right fix is a new card, not a copy of prototype code.
