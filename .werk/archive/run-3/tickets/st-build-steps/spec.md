# Spec — Build: a builder loop per ticket and a merge loop per run

Source subtree: #st-build-steps (19 cards). Written per #st-spec from #to-spec's template.

## Problem Statement

A person has a decided subtree and a set of tickets for it. Today they must drive an agent by hand for each ticket: start it, read the failures, paste them back, decide when the work is done, and merge the result. Nobody can leave the build running. A long agent session also degrades as its context grows, and nothing records how much work each ticket cost, so a codebase that gets harder to change over many merges goes unseen.

## Solution

One command builds a set of tickets into merged, checked code with no person in the middle.

Each ticket gets its own worktree and a builder loop. Each pass is a fresh agent. The agent gets the brief, the decided cards, the ticket's stories, and the last failure, and nothing else. The repository is the memory between passes. After each pass the loop runs the checks, then a grader, then five reviewers. A fail at any step starts a new pass with the failure in its input. A retry cap stops a ticket that does not converge.

A merge loop takes the finished tickets one at a time. It checks the run's tree plus the ticket before it merges. After each merge it runs the held-out set. A red held-out step files a follow-up ticket.

An overseer process watches every agent session. It answers permission asks, cancels frozen tool calls, and restarts a stuck or looping agent with a fresh pass.

Every ticket records its effort. A trend report divides the effort by the ticket's size and raises an information-only alert when the effort rises.

## User Stories

Builder loop

1. As a person running a build, I want to build one ticket with one command, so that I do not drive the agent by hand.
2. As a person running a build, I want each pass to start a fresh agent, so that a long context does not degrade the work.
3. As a person running a build, I want each pass to get the brief, the decided cards in the ticket's depends_on closure, the ticket's stories, and the last failure, and nothing else, so that every pass starts from the same known input.
4. As a person running a build, I want the loop to commit the worktree after each pass, so that the next pass reads the history with git and I can see what each pass did.
5. As a person running a build, I want the loop to run the checks itself after each pass, so that an agent cannot claim green without it.
6. As a project owner, I want each check to be a make target, so that a change of test tool does not change the rubric.
7. As a person running a build, I want a red check to give the next pass the failed command and the end of its output, so that the next pass knows what to fix.
8. As a person running a build, I want a retry cap to stop a ticket and keep its branch, so that a ticket that does not converge does not run forever and I can read what it did.

Grader

9. As a person running a build, I want a grader to read the diff against each decided card in the ticket's closure after the checks pass, so that green code that builds the wrong thing does not merge.
10. As a person running a build, I want each card to get a score from 1 to 5, where 3 passes, so that the bar is the same on every ticket.
11. As a person running a build, I want a grader fail to give the next pass the gap for each failed card, with the file, line, or test that shows it, so that the next pass has something to fix.

Review

12. As a person running a build, I want five reviewers, one per rubric area, to read the diff at the same time after the grader passes, so that problems no card names get caught.
13. As a person running a build, I want each reviewer to report only on the diff and the code it directly affects, so that a ticket does not fail for old code.
14. As a person running a build, I want a CRITICAL or HIGH finding to fail the pass and go into the next pass, so that serious problems do not merge.
15. As a person running a build, I want MEDIUM and LOW findings recorded without blocking, so that they show in the trend and do not stop the ticket.

Merge loop

16. As a person running a build, I want to build a whole ticket set with one command, in blocked_by order, so that I do not start each ticket by hand.
17. As a person running a build, I want each finished ticket checked on the run's tree plus the ticket before it merges, so that two tickets that are green alone cannot break the run's tree.
18. As a person running a build, I want a red merge check to send the ticket back to its builder loop with the failure, and merge nothing, so that the run's tree stays green.
19. As a person running a build, I want the held-out set to run on the run's tree after each merge, so that a break between parts is found where it starts.
20. As a person running a build, I want a red held-out step to file a follow-up ticket with the step text, and keep the merge, so that build goes on and the break gets fixed.
21. As a person running a build, I want the follow-up's builder to get the failed step word for word and not the test code, so that it fixes the product and not the test.
22. As a person running a build, I want the run to end only when every ticket is merged and every held-out step passes, so that the pull request carries no known break.

Overseer

23. As a person running a build, I want the overseer to answer every permission ask with a classification agent, allow or deny with a comment, so that no agent waits for a person.
24. As a person reviewing a run, I want every ask and its answer in the event log, so that I can read the answers later.
25. As a person running a build, I want a session that writes no event for 60 seconds to be cancelled and restarted as a fresh pass, so that an unknown cause of a stall does not stop the ticket.
26. As a person running a build, I want a tool call in flight to be read as working or frozen from its CPU time, output, and open connections, so that a long build is not cancelled like a hang.
27. As a person running a build, I want a frozen tool call cancelled and the agent told why, so that the agent continues without it.
28. As a person running a build, I want a classifier to say every 5 minutes whether each agent is looping, so that a repeat that looks new to a program still gets caught.
29. As a person running a build, I want a looping agent cancelled and the classifier's reason put in the next pass's brief, so that the next pass does not repeat it.

Effort and trend

30. As a person reading the trend, I want each ticket to record its passes, tokens, wall time, grader fails, and review fails, so that the effort per ticket is known.
31. As a person reading the trend, I want each ticket to record its check runtime, its flaky checks, and its MEDIUM and LOW findings, so that signals that predict a rise in effort are known early.
32. As a person reading the trend, I want a judgement on the drift between the project's agent docs and its code, so that docs that no longer match the code show in the trend.
33. As a person reading the trend, I want the effort divided by the number of stories the ticket delivers, with an empty list counted as 1, so that a run of large tickets does not look like rot.
34. As a person reading the trend, I want an alert when a metric in the last 10 tickets is 20% or more above the first 10, so that I know when the trend needs a person.
35. As a person running a build, I want the alert to not block a merge or stop the build, so that the trend informs and does not gate.

Log

36. As a person building a UI for the pipeline, I want every state change of a build to be an event in an append-only log, so that a UI can render the build without a change to the engine.

## Implementation Decisions

- **One engine module for build.** It owns the builder loop and the merge loop. The `werk loop` prototype for #lp-stateless is its starting point: fresh passes, a commit per pass, the loop's own check run as the verdict, one record line per pass.
- **Two new commands.** `werk build <ticket>` runs the builder loop for one ticket. `werk run <ticket-dir>` runs every ticket in the directory in blocked_by order, then the merge loop. `werk trend` prints the trend report.
- **A ticket file is the input.** The builder reads its title, what to build, acceptance criteria, stories, cites, and checks. The decided cards come from the depends_on closure of the cited cards. The spec's stories that the ticket lists go into the brief as the definition of done from the user's side (#st-ticket-stories).
- **Checks are make targets.** `make test`, `make typecheck`, `make lint`. The project's Makefile binds each name to a command (#lp-checks-scripts).
- **The retry cap is 5 passes.** This is the prototype's default. #werk-loop-done still holds the cap as open. A change there is one constant.
- **The grader and the reviewers are headless agents.** Each one gets a fresh context, the diff, and its own input: the grader gets the decided cards (#lp-prod-judge), each reviewer gets one of the five areas (#lp-prod-review). Each returns structured output that the loop parses. Bad output counts as a fail with the parse error as the gap.
- **One ticket builds at a time.** See #st-build-serial. The merge queue is one at a time by #st-build-run anyway.
- **The held-out set lives outside the builder's worktree.** The merge loop runs it on the run's tree. This spec runs whatever held-out tests exist. How they are written and bound is #lp-heldout-author and #lp-heldout-binder, outside this spec.
- **The overseer is a separate plain process** (#lp-overseer-det). It reads each agent's stream of events, the process tree of each shell call, and a clock. Each agent runs with streamed JSON output and with permission asks sent on its pipe, the same protocol the chat pane uses today. The overseer acts by answering an ask, by killing a process tree, or by cancelling a session and telling the builder loop to start a fresh pass.
- **On silence, the session is cancelled and a fresh pass starts.** See #st-build-silence-act.
- **Effort records go one line per pass and one summary per ticket**, beside the run, as the prototype does now. The trend report reads them. Ticket size comes from the ticket's stories list, never from the diff (#lp-trend-size).
- **Every state change is an event** in the run's append-only log (#pr-log): pass start, pass end, check result, grader verdict, review findings, merge, held-out result, follow-up filed, overseer action, alert.

## Testing Decisions

- **One seam: the command line, with a scripted fake agent.** See #st-build-seam. Tests run `werk build`, `werk run`, and `werk trend` against a temporary git repository. A fake `claude` on the PATH replays a scripted stream of events and edits files the way a real agent does. Every time limit (60 seconds, 5 minutes) is a parameter, so a test sets it to milliseconds.
- **A good test checks what the person sees:** the exit code, the branch and its commits, the merged tree, the event log, and the records. It does not check internal function calls.
- **What gets tests:** each story above gets at least one test at this seam. The overseer gets one test per row of the working-or-frozen table in #lp-overseer-inflight.
- **Prior art:** the fold tests (`bun test`) for plain assertions, and the permission tests for a child process that speaks the stdio protocol.

## Out of Scope

- Running builders in parallel, and file-overlap scheduling (#werk-loop-fanout).
- Writing and binding held-out steps (#lp-heldout-author, #lp-heldout-binder).
- Resuming a killed run from the log. The events make it possible later.
- A limit on follow-up tickets per run (#st-build-run-cap: none in v0).
- The ticket board and the human trigger (#werk-board-control).
- The `e2e` check and the coverage check (#lp-prod-checks). They need the browser harness from #werk-test first.
- Writing results back to the map (#werk-loop-state).

## Further Notes

- #lp-stateless is still proto. This spec is its test input: the same tickets run once with fresh passes and once in one long session. The spec builds the fresh-pass loop because #st-build-ticket, which is decided, depends on it.
- It is not known how the overseer can put its evidence into the result of a shell call it killed. The killed call's result shows only what the process printed. Finding the mechanism for story 27 is the first task of that ticket.
