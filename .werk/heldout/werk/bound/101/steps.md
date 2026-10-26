# Held-out steps (verbatim)

### 100.1

Scenario: A new chat conversation starts with the card wording rules in its system prompt
Given werk runs with the fake agent in place of the real agent
And the map holds at least one card
When the user opens the map in the browser
And the user starts a new chat conversation
And the user sends the message "hello"
Then the fake agent's launch record for that conversation shows a system prompt
And the system prompt contains the card instructions text
And the instructions text says that a card describes its own subject and not the session that wrote it
And the instructions text says that a card does not narrate who said what or its own edit history

### 100.2

Scenario: The instructions forbid code names in card text
Given werk runs with the fake agent in place of the real agent
When the user starts a chat conversation from a card in the map
And the user sends a message in that conversation
Then the fake agent's launch record for that conversation shows the card instructions text in its system prompt
And the instructions text says that a card names behaviour and concepts
And the instructions text says that a card does not name a file, a function, a class, a constant, a line number or an internal endpoint
And the instructions text says that a card does not list its child cards

### 100.3

Scenario: The instructions tell the agent to read a card from the map before it writes it
Given werk runs with the fake agent in place of the real agent
When the user starts a chat conversation
And the user asks the agent to change the body of a card
Then the fake agent's launch record for that conversation shows the card instructions text in its system prompt
And the instructions text says that the agent reads a card from the map before it writes that card

### 100.4

Scenario: A second chat conversation also gets the instructions
Given werk runs with the fake agent in place of the real agent
And the user has one chat conversation that already has a reply
When the user starts a second chat conversation
And the user sends a message in the second conversation
Then the fake agent's launch record for the second conversation shows the card instructions text in its system prompt
And the instructions text in the second launch record is the same as the text in the first launch record

### 100.5

Scenario: A resumed conversation after a restart still carries the instructions
Given werk runs with the fake agent in place of the real agent
And the user has a chat conversation with one reply
When the user restarts werk
And the user sends a new message in the same conversation
Then the conversation transcript still shows the earlier reply
And the fake agent's launch record for the resumed start shows the card instructions text in its system prompt

### 101.1

Scenario: A server edit during a running chat turn keeps the turn alive
Given the app runs in dev mode from a copy of werk's code
And the person opens the page and sends a chat message to the fake agent
And the agent turn is running
When the agent edits a server module in the app copy
Then the server log says the reload reuses the live server
And the server log does not show the lock taken a second time
And the agent child keeps the same process id
And the agent turn completes, and its reply appears in the chat

### 101.2

Scenario: A page opened after a server edit sees the running turn
Given the app runs in dev mode from a copy of werk's code
And a fake-agent turn is running
And a server module in the app copy is edited
When the person opens the page in a new tab
Then the new tab shows the turn as running
And the new tab shows the reply when the turn completes

### 101.3

Scenario: A client change that cannot apply in place keeps the composer draft
Given the app runs in dev mode from a copy of werk's code
And the person opens the page and types a draft in the composer without sending it
When a client file in the app copy changes in a way that cannot apply in place
Then the page reloads itself
And the composer still holds the same draft
And the page shows the changed client code

### 101.4

Scenario: A client change that applies in place reaches the page without a reload
Given the app runs in dev mode from a copy of werk's code
And the person opens the page and types a draft in the composer
When a client style in the app copy changes
Then the page shows the new style
And the page does not reload
And the composer still holds the same draft

### 101.5

Scenario: A failed hot-reload test leaves the checkout clean
Given the checkout has no changed file
And a hot-reload test runs the app from a copy of werk's code
When the test edits a server module in its copy and then fails
Then the app from the copy is stopped
And the copy is removed
And the checkout still has no changed file

### 107.1

Scenario: A valid ticket set passes the ticket check
Given a project with a decided subtree whose decided cards each appear in the cites of at least one ticket
And a spec whose every story number appears in the stories of at least one ticket
And a folder of tickets that each have all five header lines and all three sections
When the person runs the ticket-check verb on the folder, the spec and the subtree root
Then the command exits with code 0
And the output reports no failure

### 107.2

Scenario: A ticket that fails its shape check makes the run fail
Given the same valid ticket folder, spec and subtree as a passing run
And one ticket in the folder has no "## Acceptance criteria" heading
When the person runs the ticket-check verb on the folder, the spec and the subtree root
Then the command exits with code 1
And the output names that ticket, the shape check and the missing acceptance criteria heading
But the output names no other ticket as failed

### 107.3

Scenario: A call with a missing spec cannot run the checks and says so
Given a valid ticket folder and a subtree root that exists
When the person runs the ticket-check verb with a spec that does not exist
Then the command exits with code 2
And the output names the spec that is missing
And the exit code is neither 0 nor 1, so the person does not read it as a pass or as a failed check

### 107.4

Scenario: An uncited decided card is reported against the ticket set
Given a valid ticket set for a subtree
And the person adds a new decided card under that subtree that no ticket cites
When the person runs the ticket-check verb on the folder, the spec and the subtree root
Then the command exits with code 1
And the output has exactly one line about that card
And that line names the ticket set, the cards-cited check and the uncited card
And that line names no single ticket as its place

### 107.5

Scenario: An undelivered story is reported against the ticket set
Given a valid ticket set for a subtree
And the person adds a new numbered story to the spec that no ticket lists in its stories
When the person runs the ticket-check verb on the folder, the spec and the subtree root
Then the command exits with code 1
And the output has exactly one line about that story
And that line names the ticket set, the stories check and the story number
And that line names no single ticket as its place

### 108.1

Scenario: Only ready, blocked, and building tickets offer archive
Given an active run with a ticket in ready, a ticket in blocked, a ticket in building, a ticket in merging, and a ticket in done
When the person opens the board
Then the ready ticket, the blocked ticket, and the building ticket each show the archive action
And the merging ticket does not show the archive action
But the done ticket does not show the archive action either

### 108.2

Scenario: Archiving a building ticket ends its build and keeps its branch
Given an active run with a ticket in building
And a builder session is running for that ticket
And the ticket pulses on the board
When the person presses the archive action on the building ticket
Then a confirmation appears that says the ticket can be restored
When the person confirms the archive
Then the ticket leaves the board
And the builder session for that ticket is no longer running
And no ticket on the board pulses for that build
And the ticket's branch still exists in the repository

### 108.3

Scenario: Cancelling the confirmation leaves the build running
Given an active run with a ticket in building and a running builder session
When the person presses the archive action on the building ticket
And the person cancels the confirmation
Then the ticket stays in building
And the ticket still pulses
And the builder session for that ticket is still running

### 108.4

Scenario: An archived building ticket is restored onto the board
Given an active run with a ticket in building and a running builder session
And the person archives the building ticket and confirms
When an agent restores the archived ticket
Then the ticket appears on the board again with its title
And the ticket's branch still exists in the repository

### 108.5

Scenario: A drag from building into ready is refused and the build goes on
Given an active run with a ticket in building and a running builder session
And the ticket pulses on the board
When the person drags the building ticket into the ready column
Then the ticket does not appear in ready
And the ticket stays in building
And the ticket still pulses
And the builder session for that ticket is still running

### 61.1

Scenario: A fresh clone builds on an empty first commit and passes every check
Given a person clones the werk repository
When the person lists the files of the first commit on the main branch
Then the first commit holds no files
And every later commit on the main branch has the first commit as an ancestor
When the person installs the dependencies and runs `make test`, `make test-coverage`, `make typecheck`, `make lint` and `make e2e` one after the other
Then each of the five commands exits with success
And `make e2e` passes although the project has no browser spec yet

### 61.2

Scenario: The help verb lists every registered verb, and a new verb module appears in it with no other edit
Given a person has a copy of the werk project with its dependencies installed
When the person runs `werk help`
Then the output names every verb that the command line registers, and `help` is one of them
When the person adds one new module that defines and registers a verb named `ping`
And the person changes no other file in the project
And the person runs `werk help` again
Then the output names `ping` together with every verb it named before
And `git status` shows the new module as the only changed file

### 61.3

Scenario: The tests pass on a machine with no real agent installed
Given a person has a copy of the werk project with its dependencies installed
And no `claude` program is installed or reachable on the PATH of the person's shell
When the person runs `make test`
Then `make test` exits with success
And the tests that run the command line read the scripted events and the file edit of the fake agent from a temporary project
And the working tree of the person's project has no new or changed files after the run

### 61.4

Scenario: The coverage gate fails below 90% on a pure file and passes again at 90% or above
Given a person has a copy of the werk project where `make test-coverage` passes
When the person deletes enough unit tests that one file on the pure-file list drops below 90% coverage
And the person runs `make test`
Then `make test` exits with success, because plain unit tests do not check coverage
When the person runs `make test-coverage`
Then `make test-coverage` exits with an error
And the output names that file and its coverage percentage
When the person restores the deleted tests and runs `make test-coverage` again
Then `make test-coverage` exits with success

### 62.1

Scenario: An agent proposes a card and a person accepts it into the map
Given a map whose log already holds some events
When the agent adds a new card with an id, a title, a body and a why from the command line
Then the command output says "proposed"
And the log has exactly one more event, at the end, and every earlier line is unchanged
When the person shows that card from the command line
Then the output prints its title, body and why, and marks the card as a ghost
When the agent accepts the card and states that the person asked for it
Then the command succeeds
And the log has exactly one more event, at the end, and every earlier line is unchanged
And showing the card prints the same title, body and why, and marks the card as real, not as a ghost

### 62.2

Scenario: An accept without the person's claim refuses and leaves the ghost waiting
Given the agent has proposed a card from the command line
When the agent accepts that card without stating that the person asked for it
Then the command exits with a failure
And the log has no new event
And showing the card still marks it as a ghost
When the agent accepts the card again and states that the person asked for it
Then showing the card marks it as real

### 62.3

Scenario: The words of a ghost are frozen
Given the agent has proposed a card with the title "Use a log"
When the agent edits the body of that card
Then the command exits with a failure and the log has no new event
When the agent retitles that card to "Use an append-only log"
Then the command exits with a failure and the log has no new event
When the agent adds a card again with the same id and a different title
Then the command exits with a failure and the log has no new event
And showing the card prints the title "Use a log" and marks it as a ghost

### 62.4

Scenario: A retitle on a real card shows only the new title and keeps the old one in the log
Given the agent has proposed a card with the title "Use a log"
And the card is accepted with the person's claim
When the agent retitles the card to "Use an append-only log"
Then the command succeeds and the log has exactly one more event, at the end
And showing the card prints "Use an append-only log" and does not print "Use a log"
And the log file still contains the title "Use a log" on its earlier line
When the agent edits the body of the card
Then showing the card prints the new body and the title "Use an append-only log"

### 62.5

Scenario: An option, a source and an excerpt also enter as ghosts
Given a map with one accepted real card
When the agent adds an option with a why-not reason under that card
And the agent adds a source
And the agent adds an excerpt
Then each add command says "proposed" and appends exactly one event at the end of the log
And showing each of the three prints its fields and marks it as a ghost
When the agent accepts the option with the person's claim
Then showing the option marks it as real, with its why-not reason unchanged
And the source and the excerpt still show as ghosts

### 63.1

Scenario: A link to a ghost is held, and it goes live on accept with no extra link event
Given a project with a real card "Storage"
And an agent proposes a new card "Use SQLite" under "Storage"
When the agent links "Use SQLite" to "Storage" as its basis
Then the show output for "Use SQLite" lists that edge as held
And the live edges of "Storage" do not include that edge
When the person accepts "Use SQLite"
Then the show output for "Use SQLite" lists that edge as live
And the log holds exactly one link event for that edge

### 63.2

Scenario: Accepting a ghost child also accepts its ghost parent, but not a ghost it depends on
Given a project with a real card "Platform"
And an agent proposes a ghost card "Auth" under "Platform"
And the agent proposes a ghost card "Magic links" under "Auth"
And the agent proposes a ghost card "Email service" under "Platform"
And the agent links "Magic links" so that it depends on "Email service"
When the person accepts "Magic links"
Then "Magic links" shows as a real card
And "Auth" shows as a real card under "Platform"
And "Email service" still shows as a ghost
And the depends-on edge from "Magic links" to "Email service" still shows as held

### 63.3

Scenario: An accept takes the card's own ghost options and sources with it
Given a project with a real card "Storage"
And an agent proposes a ghost card "Use SQLite" under "Storage"
And the agent proposes a ghost option "Use Postgres" for "Use SQLite" with a why-not reason
And the agent proposes a ghost source "Benchmark notes" and links it to "Use SQLite"
And the agent sets the status of "Use SQLite" to decided and sets its who field
When the person accepts "Use SQLite"
Then "Use SQLite" is a real decided card with the who field the agent set
And "Use Postgres" is a real option with its why-not reason
And "Benchmark notes" is a real source linked to "Use SQLite" by a live edge
And the agent got no refusal for the status change or the who change while the card was a ghost

### 63.4

Scenario: Discarding a ghost parent discards its whole ghost branch
Given a project with a real card "Platform"
And an agent proposes a ghost card "Auth" under "Platform"
And the agent proposes a ghost card "Magic links" under "Auth"
And the agent proposes a ghost option "Passwords" for "Magic links"
When the person discards "Auth"
Then "Auth", "Magic links" and "Passwords" no longer show in the map or in the show output
And "Platform" still shows as a real card with no ghost children

### 63.5

Scenario: A ghost changes no count of a real card until it is accepted
Given a project with a real card "Storage" that has one real decided child
And the person notes the rollup count and the unchallenged count of "Storage"
And "Storage" shows no staleness mark
When an agent proposes a ghost card "Use SQLite" under "Storage" with status decided and a ghost option
Then the rollup count and the unchallenged count of "Storage" are the same as before
And "Storage" still shows no staleness mark
When the person accepts "Use SQLite"
Then the rollup count of "Storage" includes "Use SQLite"

### 64.1

Scenario: A card that lacks a kill criterion stays open, and the printed command fixes it
Given a map with an open card that has a decider, a depends_on edge, and a rejected option
But the card has no kill criterion
When an agent sets the card to decided
Then the command exits with a failure
And the output names the kill criterion as the missing fact
And the output prints the exact command that adds a kill criterion to that card
And the card still shows as open on the map
And the log has no new status event for the card
When the agent runs the printed command
And the agent sets the card to decided again
Then the command succeeds
And the card shows as decided on the map

### 64.2

Scenario: A card that lacks several facts reports each missing fact with its own command
Given a map with an open card that has only a title and body text
When an agent sets the card to decided
Then the command exits with a failure
And the output names the missing decider, the missing depends_on basis, the missing rejected option, and the missing kill criterion
And the output prints a command to fix each missing fact
And the card still shows as open on the map
When the agent runs each printed command in turn
And the agent sets the card to decided again
Then the card shows as decided on the map

### 64.3

Scenario: A ghost card obeys the same check through its held edges
Given a proposed ghost card whose held edges give a decider, a depends_on basis, a rejected option, and a kill criterion
And a second proposed ghost card whose held edges give no depends_on basis
When an agent sets the first ghost to decided
Then the command succeeds
And the first ghost shows as decided
When the agent sets the second ghost to decided
Then the command exits with a failure
And the output names the missing depends_on basis and prints the command that adds it
And the second ghost does not show as decided

### 64.4

Scenario: An amend that removes a required fact is refused and the decided card stays the same
Given a decided card with a decider, a depends_on edge, a rejected option, and a kill criterion
When an agent amends the card so that it no longer has its depends_on edge
Then the command exits with a failure
And the output names the missing depends_on basis and prints the command that adds it
And the card still shows as decided
And the card shows the same words and edges that it had before the amend

### 64.5

Scenario: An amend that keeps every fact succeeds, and card text is not checked
Given a decided card with a decider, a depends_on edge, a rejected option, and a kill criterion
When an agent amends the card to replace its body with one short sentence and keeps every fact
Then the command succeeds
And the card shows as decided with the new body text
And the log shows the amend as a reopen and a decide of the card

### 65.1

Scenario: A rejected reopen marks only the next hop as stale
Given a map with three decided cards A, B and C
And card B depends on card A
And card C depends on card B
When the user reopens card A with the reason rejected and the sentence "the storage choice is wrong"
Then the stale list shows card B as stale
And the entry for card B names card A as the cause, the depends_on link, and the reason rejected
And card C does not appear in the stale list
And card C shows no stale mark and no paused mark on the map

### 65.2

Scenario: A postponed reopen pauses every downstream card and keeps their status
Given a map with four cards A, B, C and D
And card B depends on card A, card C depends on card B, and card D depends on card C
And card D has the status decided
When the user reopens card A with the reason postponed and the sentence "the engine build waits for next quarter"
Then cards B, C and D each show the paused mark
And card D still shows the status decided
And the stale list shows card D as paused, with card A as the cause and the reason postponed
But no card shows the stale mark

### 65.3

Scenario: Stale wins when a postponement and a rejection reach the same card
Given a map with decided cards A, B and C
And card C depends on card A
And card C also refines card B
When the user reopens card A with the reason postponed
And the user reopens card B with the reason rejected
Then card C shows as stale, not as paused
And the stale list shows card C with card B as the cause and the reason rejected

### 65.4

Scenario: Rederive clears the mark on one card and leaves the others
Given a decided card A with two direct dependents, cards B and C
And the user reopened card A with the reason rejected
And the stale list shows both card B and card C as stale
When the user rederives card B and confirms it
Then the stale list no longer shows card B
And the stale list still shows card C as stale, with card A as the cause and the reason rejected
And card B shows no stale mark on the map

### 65.5

Scenario: Deciding a postponed card again clears the paused marks downstream
Given a card B that depends on card A, and a card C that depends on card B
And the user reopened card A with the reason postponed
And cards B and C show the paused mark
When the user decides card A again
Then cards B and C no longer show the paused mark
And the stale list shows neither card B nor card C
And card C still shows the status it had before the reopen

### 66.1

Scenario: An agent removes a bad branch and the log keeps its history
Given a map with a card "Storage" that has two child cards, "Cache" and "Index"
And "Cache" has its own child card "Eviction"
And the agent notes how many events the log holds
When the agent removes "Cache"
Then showing "Cache" reports it as removed
And showing "Eviction" reports it as removed
And "Cache" and "Eviction" no longer appear under "Storage" in the map
But "Index" still appears under "Storage"
And the list of removed cards shows "Cache"
And the log still holds every event it held before the remove, plus one new event

### 66.2

Scenario: A person restores a removed card and its subtree with their links
Given a map with a card "Storage" that has a child card "Cache"
And "Cache" has a child card "Eviction"
And "Cache" depends on a card "Memory budget"
And the agent removes "Cache"
When the agent restores "Cache"
Then showing "Cache" no longer reports it as removed
And "Cache" appears under "Storage" in the map again
And "Eviction" appears under "Cache" again
And showing "Cache" lists its dependency on "Memory budget"
And the list of removed cards no longer shows "Cache"

### 66.3

Scenario: An agent removes a bad parent but keeps its good children
Given a map with a card "Storage" that has a child card "Bad layer"
And "Bad layer" has two child cards, "Write path" and "Read path"
When the agent removes "Bad layer" with the option that lifts its children
Then showing "Bad layer" reports it as removed
And "Write path" and "Read path" appear directly under "Storage" in the map
And showing "Write path" does not report it as removed
And showing "Read path" does not report it as removed

### 66.4

Scenario: An agent finds the open cards it can work on in a subtree
Given a map with a card "Storage" that has four open child cards: "Cache", "Index", "Backup", and "Quota"
And "Backup" depends on a card that is reopened with the reason postponed, so "Backup" is paused
And "Quota" depends on a card that is reopened with the reason rejected, so "Quota" is stale
And a card outside the "Storage" subtree is open
When the agent finds the open cards in the "Storage" subtree
Then the output lists "Cache" and "Index"
But the output does not list "Backup"
And the output does not list "Quota"
And the output does not list the open card outside the subtree

### 66.5

Scenario: A removed branch drops out of the find result and comes back after a restore
Given a map with a card "Storage" that has two open child cards, "Cache" and "Index"
And the agent removes "Cache"
When the agent finds the open cards in the "Storage" subtree
Then the output lists "Index"
But the output does not list "Cache"
When the agent restores "Cache"
And the agent finds the open cards in the "Storage" subtree again
Then the output lists both "Cache" and "Index"

### 67.1

Scenario: A quote found once in a transcript becomes a ghost excerpt on the citing card
Given a map with a card "#werk-excerpt"
And a recorded session whose transcript has a user message "Every quote in the imported map was written from memory" at a known message index
When the person asks werk to quote "written from memory" from that session for the card "#werk-excerpt"
Then the command succeeds
And the map shows a new excerpt as a ghost
And the excerpt shows the session, the message index of that user message, the speaker "user", and the start and end of the quoted text inside that message
And the card "#werk-excerpt" shows the excerpt as supported_by evidence

### 67.2

Scenario: The excerpt lets the person find the quote again in the transcript
Given a card "#werk-excerpt" with an excerpt quoted from an assistant message in a recorded session
When the person opens the excerpt
And the person goes to the session, message index and span that the excerpt records
Then the text at that span is the quoted text, character for character
And the speaker of that message is "assistant", the same as the excerpt shows

### 67.3

Scenario: A quote with one changed character fails and changes nothing
Given a recorded session whose transcript contains "the tool never guesses"
And the person notes the current event count of the map
When the person asks werk to quote "the tool never gueses" from that session for an existing card
Then the command exits with a non-zero status
And the error says that the text has no exact match in the session
And the event log has the same number of events as before
And the map shows no new excerpt

### 67.4

Scenario: A quote that occurs in two messages fails and names both messages
Given a recorded session where the text "fails instead of guessing" occurs in message 3 and in message 7
When the person asks werk to quote "fails instead of guessing" from that session for an existing card
Then the command exits with a non-zero status
And the error names message 3 and message 7
And the event log has no new event
And the map shows no new excerpt

### 67.5

Scenario: A ghost excerpt is accepted the same way as every other ghost
Given a card with a ghost excerpt that werk quoted from a recorded session
When the person accepts the ghost excerpt
Then the excerpt shows as a normal node and no longer as a ghost
And the card still shows the excerpt as supported_by evidence

### 68.1

Scenario: An agent writes a note on a card and sees it on the card
Given a map that holds a decided card "#werk-chat" with the title "The composer sends a live agent turn"
When the agent runs the say verb on "#werk-chat" with the text "The reply streams over SSE"
Then the command exits with success
And the log holds one new note event that names "#werk-chat"
When the agent runs the show verb on "#werk-chat"
Then the output shows the note "The reply streams over SSE"

### 68.2

Scenario: An agent reads a whole card thread in order from the inbox
Given a map that holds a card "#werk-chat"
And the agent wrote the note "first" on "#werk-chat"
And the agent then wrote the note "second" on "#werk-chat"
And the agent then wrote the note "third" on "#werk-chat"
When the agent runs the inbox verb
Then the output shows a group for "#werk-chat"
And that group shows "first", "second", and "third" in that order

### 68.3

Scenario: The inbox groups notes by card
Given a map that holds the cards "#werk-chat" and "#visual"
And the agent wrote the note "chat one" on "#werk-chat"
And the agent then wrote the note "visual one" on "#visual"
And the agent then wrote the note "chat two" on "#werk-chat"
When the agent runs the inbox verb
Then the group for "#werk-chat" shows "chat one" and then "chat two"
And the group for "#visual" shows "visual one"
But the group for "#visual" does not show "chat one" or "chat two"

### 68.4

Scenario: An agent writes a note on a ghost card
Given a map where the card "#visual" links to "#werk-pane"
And "#werk-pane" is a ghost with no body
When the agent runs the say verb on "#werk-pane" with the text "Describe the pane here"
Then the command exits with success
When the agent runs the inbox verb
Then the output shows a group for "#werk-pane" with the note "Describe the pane here"

### 68.5

Scenario: A note on an unknown card fails and changes nothing
Given a map that holds a card "#werk-chat"
And the agent notes the current size of the log
When the agent runs the say verb on "#no-such-card" with the text "lost note"
Then the command exits with a non-zero status
And the output names "#no-such-card" as unknown
And the log has the same size as before
When the agent runs the inbox verb
Then the output does not show "lost note"

### 69.1

Scenario: The map shows the fixture project as a refines tree
Given a project with a root card, two child cards that refine the root, and one grandchild card that refines a child
And the person starts the server on that project
When the person opens the map in a browser
Then the person sees the root card
And the person sees the two child cards under the root card
And the person sees the grandchild card under its parent card, not under the root card

### 69.2

Scenario: A card added and accepted from the command line appears with no reload
Given the server runs on a project, and the person has the map open in a browser
And the map does not show a card titled "Use an append-only log"
When the person adds a card titled "Use an append-only log" under the root card from the command line
And the person accepts that card from the command line
Then the map shows the card "Use an append-only log" under the root card within a few seconds
But the person did not reload the page or click anything in the browser

### 69.3

Scenario: The open card survives a reload and has no control that edits its text
Given the server runs on a project, and the person has the map open in a browser
When the person opens a child card from the map
Then the address bar shows the id of that card
And the page shows the detail of that card
And the page has no text box or button that changes the title or the body of the card
When the person reloads the page
Then the page opens the same card again, with the same id in the address bar

### 69.4

Scenario: A second server on the same project waits, then refuses
Given a server runs on a project
When the person starts a second server on the same project directory
Then the second server prints that it waits for the process id of the first server
And within about 5 seconds the second server stops with an error
And the error names the process id of the first server
And the map in the browser still loads from the first server and shows the same cards as before

### 69.5

Scenario: The person runs the browser tests and gets one screenshot per test
Given a checkout of werk with the browser specs
When the person runs `make e2e`
Then the browser specs run against a real server on a copy of the fixture project
And the run reports a pass or fail result for each spec
And the run leaves one screenshot for each test that ran
And the project the person works in has no new events in its log after the run

### 70.1

Scenario: A proposed card shows as a ghost under its proposed parent
Given the map shows a real card "Payments"
And an agent proposes a new card "Refunds" that refines "Payments"
When the person opens the map
Then "Refunds" shows under "Payments" in the refines tree
And "Refunds" is drawn grey and dashed
But "Payments" is drawn as a normal real card, not grey and not dashed

### 70.2

Scenario: The person accepts one ghost with the ✓ button and it becomes real
Given the map shows a ghost card "Refunds" under the real card "Payments"
When the person opens the card view of "Refunds"
And the person presses the ✓ button
Then the log has one new accept event for "Refunds" with the person as the actor
And the map redraws "Refunds" as a real card under "Payments"
And the card view of "Refunds" no longer shows a ✓ button

### 70.3

Scenario: Accepting a ghost child under a ghost parent makes both real
Given the map shows a real card "Payments"
And a ghost card "Refunds" under "Payments"
And a ghost card "Partial refunds" under "Refunds"
When the person opens the card view of "Partial refunds" and presses ✓
Then the map redraws "Partial refunds" as a real card
And the map redraws "Refunds" as a real card
And "Partial refunds" still shows under "Refunds", and "Refunds" still shows under "Payments"

### 70.4

Scenario: An accept takes only the accepted card's branch, not other ghosts
Given the map shows a real card "Payments"
And two ghost cards "Refunds" and "Chargebacks" under "Payments"
And "Refunds" has a proposed option and a proposed source
When the person presses ✓ on "Refunds"
Then "Refunds" redraws as a real card, with its option and its source as real
But "Chargebacks" still shows grey and dashed
And the map shows no control that accepts "Refunds" and "Chargebacks" together

### 70.5

Scenario: A second view sees the accept because it reads the same log
Given the person has the map open in two browser windows
And both windows show a ghost card "Refunds"
When the person presses ✓ on "Refunds" in the first window
Then the second window redraws "Refunds" as a real card without a manual edit

### 71.1

Scenario: Known card ids in a card body become links, and other text stays plain
Given the map holds a card "al-diff" and a card "align"
And a card "notes-card" has a body that mentions "#al-diff", "#ghost-card", the bare word "al-diff", the bare word "align", and a code span "node src/cli.ts show #al-diff"
When the user opens the card "notes-card" in the map
Then the body shows "#al-diff" as a link
And the body shows the bare "al-diff" as a link
But the body shows "#ghost-card" as plain text
And the body shows the bare word "align" as plain text
And the body shows the code span "node src/cli.ts show #al-diff" as code with no link in it

### 71.2

Scenario: A click on a card link in a why line opens that card
Given the map holds a card "al-diff" with the summary "Diff the alignment"
And a card "pr-iface" has a why line that mentions "#al-diff"
When the user opens the card "pr-iface" in the map
And the user clicks the "#al-diff" link in the why line
Then the map shows the card "al-diff"
And the user sees the summary "Diff the alignment"

### 71.3

Scenario: Headings, URL fragments and fenced blocks keep their own form
Given the map holds a card "al-diff"
And a card "doc-card" has a body with the heading "# al-diff", the URL "https://example.com/page#al-diff", a code span "`#al-diff`", and a fenced block that holds "#al-diff"
When the user opens the card "doc-card" in the map
Then the heading shows the text "al-diff" with no link
And the URL fragment "#al-diff" is not a card link
And the fenced block shows "#al-diff" as code with no link
But the code span "#al-diff" shows as a link to the card "al-diff"

### 71.4

Scenario: A grid tile summary with a card id holds no link, but a note on the open card does
Given the map holds a card "al-diff"
And a card "ref-card" has the summary "Follows up on #al-diff"
And the card "ref-card" has a note that says "See al-diff first"
When the user looks at the grid
Then the tile for "ref-card" shows the text "Follows up on #al-diff" with no link in it
When the user clicks the tile for "ref-card"
Then the map opens the card "ref-card"
And the notes thread shows "al-diff" as a link

### 71.5

Scenario: Fenced code in a card shows boxed, highlighted, and with its own indentation
Given a card "code-card" has a body with a fenced "json" block
And the block holds a nested object with four-space indentation and one line longer than the card is wide
When the user opens the card "code-card" in the map
Then the code shows inside a box with syntax highlighting
And every line keeps the indentation the writer gave it
And the user can scroll the box sideways to read the end of the long line
And the rest of the card body does not grow wider than the card

### 72.1

Scenario: A rejected reopen marks only the direct dependent as stale, in red
Given a map with card A, card B that depends on A, and card C that depends on B
And all three cards are decided
When the person reopens card A from the command line with the reason rejected and a sentence that says why
And the person opens the map in the browser
Then card B shows a red stale mark
And card B still shows the decided status colour under the mark
But card C shows no stale mark
And card C shows no paused mark

### 72.2

Scenario: A postponed reopen marks every downstream card as paused, in grey, and keeps the status colour
Given a map with card A, card B that depends on A, and card C that depends on B
And card B is decided and card C is decided
When the person reopens card A from the command line with the reason postponed and a sentence that says why
And the person opens the map in the browser
Then card B shows a grey paused mark
And card C, two hops away from card A, shows a grey paused mark
And card C still shows the decided status colour under the grey mark
And neither card B nor card C shows a red stale mark

### 72.3

Scenario: The card view of a stale card explains the change, the link, and the reason
Given a map with card A and card B that depends on A
And the person reopens card A from the command line with the reason rejected and the sentence "The vendor dropped this API"
When the person opens the map in the browser
And the person opens card B
Then the card view shows the heading "Why this card is stale"
And under that heading the person sees that card A was reopened
And the person sees that card B depends on card A
And the person sees the reason rejected and the sentence "The vendor dropped this API"

### 72.4

Scenario: The card view of a paused card two hops away names the reopened card and the reason
Given a map with card A, card B that depends on A, and card C that depends on B
And the person reopens card A from the command line with the reason postponed and the sentence "We build the engine next quarter"
When the person opens the map in the browser
And the person opens card C
Then the card view shows the heading "Why this card is stale"
And the person sees that card A was reopened
And the person sees the reason postponed and the sentence "We build the engine next quarter"

### 72.5

Scenario: A stale mark wins over a paused mark on the same card
Given a map with card A, card X, and card B that depends on both card A and card X
And the person reopens card X from the command line with the reason postponed
And the person reopens card A from the command line with the reason rejected
When the person opens the map in the browser
Then card B shows a red stale mark
But card B does not show a grey paused mark
And when the person opens card B, the card view names card A and the reason rejected

### 80.1

Scenario: A folder of valid tickets passes the ticket check
Given a map with a subtree whose decided cards are "map-reopen" and "map-stale"
And a spec for that subtree with stories 1, 2 and 3
And a folder with two ticket files that each have the five header lines and the three sections in order
And ticket 1 cites "map-reopen", lists stories 1 and 2, and touches "map view"
And ticket 2 cites "map-stale", is blocked by ticket 1, lists story 3, and touches "decision log"
When the person runs the ticket check on the folder, with the subtree root and the spec
Then the output shows no failure
And the command exits with code zero

### 80.2

Scenario: A ticket with a missing touches line and a path in its body fails its own checks by name
Given a map subtree, a spec, and a folder of tickets that pass every check together
When the person deletes the touches line from ticket 2
And the person adds the text "edit src/loop.ts" to the What to build section of ticket 3
And the person changes the touches line of ticket 1 to "map view, server/routes"
And the person runs the ticket check on the folder, with the subtree root and the spec
Then the output names ticket 2 with the shape check and the touches field
And the output names ticket 3 with the no-file-paths check, the path "src/loop.ts" and its line number
And the output names ticket 1 with the touches check
And the command exits with a non-zero code

### 80.3

Scenario: A ticket that fails its own checks does not count in the set checks
Given a map subtree with the decided card "map-stale", which only ticket 2 cites
And a spec in which only ticket 2 lists story 3
And ticket 4 is blocked by ticket 2
When the person removes the What to build heading from ticket 2
And the person runs the ticket check on the folder, with the subtree root and the spec
Then the output names ticket 2 with the shape check and the missing What to build heading
And the output reports "map-stale" as a card that no ticket cites
And the output reports story 3 as a story that no ticket delivers
And the output names ticket 4 for a blocker that is not in the set
And the command exits with a non-zero code

### 80.4

Scenario: A ticket set with coverage and order errors names each card, story and ticket
Given a map subtree whose decided cards include "map-reopen", which no ticket cites
And a spec with stories 1 to 4, where no ticket lists story 4
And ticket 1 lists story 9, which is not in the spec
And ticket 2 is blocked by ticket 3, and ticket 3 is blocked by ticket 2
And ticket 5 is blocked by ticket 8, which is not in the folder
And ticket 1 and ticket 4 are on no cycle and name no unknown blocker
When the person runs the ticket check on the folder, with the subtree root and the spec
Then the output reports "map-reopen" as an uncited card
And the output reports story 4 as missing and story 9 as unknown
And the output names tickets 2 and 3 for the cycle and ticket 5 for the unknown blocker
But the output names neither ticket 1 nor ticket 4 under the blocked_by check
And the command exits with a non-zero code

### 80.5

Scenario: An agent fixes a ticket on request and the next ticket check passes
Given a folder of tickets where the ticket check fails only because no ticket lists story 3
When an agent changes ticket 2 to list story 3, on the person's request
And the agent runs the ticket check again on the same folder, subtree root and spec
Then the output shows no failure
And the command exits with code zero

### 81.1

Scenario: A person sees every fixture ticket in the column its last event names
Given the test project has a board log with tickets in each ticket state
And one ticket was moved to building and then moved again to merging
When the person opens the test project in the browser
And the person switches from the map to the board
Then the person sees five columns in the order blocked, ready, building, merging, done
And each ticket appears as one card in the column that its last event names
And the ticket that moved from building to merging appears only in merging

### 81.2

Scenario: A ticket card shows a retry count only after more than one retry
Given the test project has a board log with one ticket that retried two times
And another ticket that retried one time
When the person opens the board
Then the card of the ticket with two retries shows its title and a retry count of 2
And the card of the ticket with one retry shows its title and no retry count
And neither card shows the ticket brief, the cited cards, or the checks

### 81.3

Scenario: A ticket card counts only the blockers that are not done
Given the test project has a board log with a ticket blocked by two other tickets
And one of the two blocking tickets is in done
And the other blocking ticket is in ready
When the person opens the board
Then the card of the blocked ticket shows a blocker count of 1
And a ticket with no blockers shows no blocker count

### 81.4

Scenario: A click on a ticket opens a drawer with the slice and its metadata
Given the person has the board of the test project open
When the person clicks a ticket card that has a long brief, cited cards, a blocker, and two retries
Then a drawer opens under the board
And the left side of the drawer shows the full text of the ticket slice
And the right side of the drawer shows the cited card ids, the blocking ticket, the retry count, and the checks
And the board columns stay visible above the drawer

### 81.5

Scenario: A click on a cited card id in the drawer opens that card on the map
Given the person has the board of the test project open
And the person has opened the drawer of a ticket that cites a card on the map
When the person clicks that cited card id in the drawer
Then the view switches from the board to the map
And the map shows that card open, with its title and body
When the person switches back to the board
Then the person sees the same five columns with the same tickets

### 82.1

Scenario: A plan over a decided subtree records a feature run, writes a spec and tickets, and puts the writers' answers on the map as proposals
Given a map with a decided subtree under the root card "#auth"
And the spec writer returns one spec and one answer record with the slug "token-ttl", a title, a why and a body
And the ticket writer returns two tickets that pass all checks and one answer record with the slug "split-login"
When the person runs the plan over "#auth"
Then the first event of the run in the log is a tier event with the tier "feature"
And the board shows the two tickets
And the map shows a ghost card "#auth-token-ttl" that refines "#auth", with the agent as the one who decides
And the map shows a ghost card "#auth-split-login" that refines "#auth", with the agent as the one who decides
And each ghost shows the title, the why and the body from its record
And the person can accept each ghost one at a time with the ✓ button

### 82.2

Scenario: A plan stops with an error when an answer record has an id that is already in the map
Given a map with a decided subtree under the root card "#auth"
And the map already has a card "#auth-token-ttl"
And the spec writer returns an answer record with the slug "token-ttl"
When the person runs the plan over "#auth"
Then the plan exits with an error
And the output names the record "token-ttl"
And the map shows no second card with the id "#auth-token-ttl"

### 82.3

Scenario: A ticket that fails its own checks stays off the board and gives no coverage
Given a map with a decided subtree under the root card "#auth" that holds the decided card "#auth-session"
And the ticket writer returns a ticket "login" that has no stories header line and is the only ticket that cites "#auth-session"
And the ticket writer returns a ticket "logout" that passes all checks and cites other cards
When the person runs the plan over "#auth"
Then the board shows "logout" and does not show "login"
And the output names the missing field in "login"
And the output reports "#auth-session" as a card that no ticket cites

### 82.4

Scenario: A ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready
Given a map with a decided subtree under the root card "#auth"
And the ticket writer returns a ticket "a" that fails its own checks
And the ticket writer returns a ticket "b" that passes all checks and has no blockers
And the ticket writer returns a ticket "c" that names "a" and "b" as its blockers
When the person runs the plan over "#auth"
Then the board does not show "a"
And the board shows "c" as blocked
And the board shows "b" as ready

### 82.5

Scenario: A second plan archives an open ticket that the new spec drops, and a restore puts it back
Given a person ran the plan over "#auth" and the board shows the open tickets "login" and "logout"
And the ticket writer now returns only the ticket "login"
When the person runs the plan over "#auth" again
Then the board log shows "logout" as archived with the reason that the current spec no longer needs it
And the board shows "login" as open
When the person restores "logout"
Then the board shows "logout" as open again

### 83.1

Scenario: A ticket that fails its checks once is green on the second pass
Given a project repository with a main line and one ready ticket on the board
And the ticket has one check command
And the builder agent leaves the check red on its first pass and makes it green on its second pass
When the person starts the build of the ticket
Then the build ends with a green result
And the ticket branch has exactly two pass commits, "pass 1" and "pass 2"
And the run record for the build has two lines, one for each pass
And each line shows the check results, the time, and the cost of its pass
And the first line shows the check as red and the second line shows the check as green

### 83.2

Scenario: The next pass receives the last failure, cut to about 4,000 characters
Given a project repository with one ready ticket
And the ticket has a check command that prints about 20,000 characters and exits with an error on the first run
And the builder agent makes the check pass on its second pass
When the person starts the build of the ticket
Then the prompt of the second builder agent names the failed check command
And it holds the end of that command's output
And the failure text in that prompt is not longer than about 4,000 characters
And the prompt of the first builder agent holds no failure text

### 83.3

Scenario: The build starts from the tip of the main line, not from the working tree
Given a project repository whose main line has a new commit at its tip
And the main checkout has local changes that are not committed
When the person starts the build of a ready ticket
Then the first parent of the ticket's first pass commit is the commit that was the main line's tip when the build started
And the local, uncommitted changes are not in any commit on the ticket branch
And the main checkout still has its local changes

### 83.4

Scenario: A builder that never converges stops at the retry cap and keeps its branch
Given a project repository with one ready ticket
And the builder agent never makes the ticket's check pass
When the person starts the build of the ticket with the default retry cap
Then the build stops after 5 passes and reports a failed result
And the ticket branch still exists with 5 pass commits
And the run record has 5 lines, each with a red check result, a time, and a cost

### 83.5

Scenario: The board shows the ticket in building with its retry count
Given a project repository with one ready ticket shown in the ready column of the board
And the builder agent leaves the check red on its first two passes and makes it green on its third pass
When the person starts the build of the ticket
Then the board shows the ticket in the building column
And the board shows the retry count of the ticket as 2 when the build ends

### 84.1

Scenario: A grader score of 2 fails the pass and the gap reaches the next pass
Given a ticket that cites one decided card and has two acceptance criteria
And the checks for the ticket pass
And the grader scores the contradiction line of that card 2, with the gap "the diff writes the card in place, the card forbids it" and the file and line that show it
When the person starts the build of the ticket
Then the first pass fails at the grader step
And no reviewer runs for the first pass
And a second pass starts
And the prompt of the second pass holds the gap "the diff writes the card in place, the card forbids it" with its file and line

### 84.2

Scenario: The grader judges every decided card in the depends_on closure, cited or not
Given a ticket with three acceptance criteria that cites one decided card
And the cited card depends on a second decided card that the ticket does not cite
And the second card depends on a third card that is still open
When the person starts the build of the ticket and the checks pass
Then the grader receives three delivery lines, one per acceptance criterion
And the grader receives one contradiction line for the cited card and one for the uncited decided card
And the grader receives no line for the open card
And the grader's brief states that a part of a card the diff does not build yet passes its contradiction line

### 84.3

Scenario: An unbuilt part of a card passes its line and the pass goes on to the review
Given a ticket that cites a decided card with two parts, and the ticket builds only the first part
And the checks for the ticket pass
And the grader scores every line 3 or more, and marks the second part of the card as not built yet with score 3
When the person starts the build of the ticket
Then the pass does not fail at the grader step
And five reviewers start for the pass, one each for design, maintainability, tests, security and dependencies, and performance
And each reviewer receives the diff of the ticket only

### 84.4

Scenario: A HIGH review finding fails the pass and goes into the next prompt
Given a ticket whose checks pass and whose grader scores every line 3 or more
And the security and dependencies reviewer reports one HIGH finding with a file, a line, the impact "the token is written to the log" and a fix
And the other four reviewers report no finding
When the person starts the build of the ticket
Then the first pass fails at the review step
And a second pass starts
And the prompt of the second pass holds the HIGH finding with its file, line, impact and fix
And the second pass runs the checks, the grader and all five reviewers again

### 84.5

Scenario: Only MEDIUM and LOW findings let the pass go green and the run record keeps them
Given a ticket whose checks pass and whose grader scores every line 3 or more
And the maintainability reviewer reports one MEDIUM finding and the tests reviewer reports one LOW finding
And no reviewer reports a CRITICAL or HIGH finding
When the person starts the build of the ticket
Then the first pass goes green and no second pass starts
And the ticket leaves building
And the run record of the ticket holds the MEDIUM finding and the LOW finding with their severity, file, line, impact and fix

### 85.1

Scenario: An unanswered permission ask gets an answer and the build continues
Given a temporary git repository with one ticket ready to build
And a fake build agent that emits a permission ask, waits for an answer, then edits a file and finishes
When the person starts the build
Then the event log shows the permission ask and an answer to it from the overseer
And the fake agent continues after the answer and finishes its pass
And the ticket branch has a commit with the agent's file edit
And the build exits with a success code

### 85.2

Scenario: A silent agent is cancelled and a fresh pass starts
Given a temporary git repository with one ticket ready to build
And the silence limit is set to a few milliseconds
And a fake build agent that goes silent with no tool call in flight on its first pass, and finishes normally on its second pass
When the person starts the build
Then the event log shows that the overseer cancelled the first session for silence
And the event log shows a second build pass for the same ticket
And the ticket branch has the commit from the second pass
And the build exits with a success code

### 85.3

Scenario: A looping agent gets one warning, then its session is cancelled
Given a temporary git repository with one ticket ready to build
And the loop check interval is set to a few milliseconds
And a fake build agent that repeats the same failing tool call again and again
And a fake loop classifier that always answers "looping"
When the person starts the build
Then the event log shows one warning from the overseer to the agent about the loop
And after the warning, the event log shows that the overseer cancelled the session for looping
But the event log shows no cancellation before the warning

### 85.4

Scenario: A long tool call in flight is not cancelled as silence
Given a temporary git repository with one ticket ready to build
And the silence limit is set to a few milliseconds
And a fake build agent that starts a tool call, emits no events for many times the silence limit, then gets the tool result, edits a file, and finishes
When the person starts the build
Then the event log shows no silence cancellation for that session
And the event log shows only one build pass for the ticket
And the ticket branch has a commit with the agent's file edit
And the build exits with a success code

### 86.1

Scenario: The builder never sees the held-out steps
Given a planned ticket with acceptance criteria on the board
And a person starts the build of that ticket
When the builder starts work on the ticket
Then a step author starts at the same time and writes Given, When, Then steps from the ticket
And a binder turns those steps into tests
And the person finds the steps and the tests outside the builder's worktree
But no file in the builder's worktree holds any held-out step text
And no prompt the builder receives holds any held-out step text

### 86.2

Scenario: A held-out run on a broken tree reports the red step
Given a run whose ticket has held-out steps and bound tests
And the run's tree has a break that one user path hits
When the person runs the held-out set on the run's tree
Then the result names the step whose path hits the break as red
And the result shows the other steps as green
And the held-out run exits with a failure

### 86.3

Scenario: The builder gets the failed step's text, not the test
Given a held-out run on the run's tree reported one red step
When the builder starts its next pass on the ticket
Then the builder's prompt holds the Given, When, Then text of the red step
But the builder's prompt holds none of the test code bound to that step
And the builder's prompt holds no text of the steps that passed

### 86.4

Scenario: The gate refuses G2 while a held-out step is red
Given a run where every ticket is built
And the last held-out run on the run's tree reported one red step
When the person asks the gate to open G2
Then the gate refuses and exits with a failure
And the gate names the red held-out step as the reason
And G2 stays closed

### 86.5

Scenario: G2 opens after the red step turns green
Given a run where the gate refused G2 because of one red held-out step
And the builder fixed the break on the run's tree
When the person runs the held-out set on the run's tree again
And every held-out step is green
And the person asks the gate to open G2
Then the gate succeeds
And G2 shows as open for the run

### 87.1

Scenario: Two green tickets merge onto the main line one after the other
Given a project whose main line has a plan with two ready tickets for one subtree
And both tickets pass their checks alone and together
When the person starts the run
Then the board shows each ticket move through building, merging, and done
And the main line history shows the first ticket's merge before the second ticket's merge
And the repository has no new branch besides the main line and the ticket branches
And no ticket card on the board shows a held-out badge

### 87.2

Scenario: A ticket that is red on the merged tree goes back to building and the main line stays where it was
Given a project whose main line has one ticket already merged
And a second ticket that passes its checks alone but fails them on top of the first ticket
When the person starts the run and the second ticket reaches merging
Then the board moves the second ticket from merging back to building
And the second ticket's drawer shows the failed check and its output
And the main line tip is the same commit as before the second ticket reached merging

### 87.3

Scenario: A merge moves a clean checkout of the main line and stops at a checkout with a blocking local change
Given a project whose main line is checked out in a folder with no local changes
And a ready ticket that changes a file in that folder
When the person starts the run and the ticket merges
Then the checked-out folder shows the ticket's change without any action from the person
When the person edits that same file in the checked-out folder without committing
And a second ticket that changes the same file reaches merging with green checks
Then the merge stops and the board shows the second ticket did not reach done
And the main line tip is the same commit as before
And the person's uncommitted edit is still in the file

### 87.4

Scenario: A red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket
Given a project with a ready ticket that passes its checks
And a held-out step that fails on the main line once that ticket is merged
When the person starts the run and the ticket merges
Then the ticket is in done and the main line contains its merge
And a new follow-up ticket appears in ready, naming the failed held-out step
And the done ticket's card shows a held-out badge
And the person opens the done ticket's drawer and sees the same badge in its metadata
And the person clicks the badge and the follow-up ticket opens

### 87.5

Scenario: G2 opens after the last merge with all held-out steps green and opens again after a later merge
Given a project whose subtree has two ready tickets and a held-out set that passes once both are merged
When the person starts the run and the first ticket merges
Then G2 is not open for the subtree
When the second ticket merges and every held-out step is green
Then G2 opens for the current tip of the main line
When the person approves G2 and a new ticket of the same subtree later merges with every held-out step green
Then G2 opens again for the new tip of the main line

### 88.1

Scenario: Nothing builds before the person starts the run
Given a plan run with three unblocked tickets on the board in ready
When the person opens the board and waits
Then every ticket stays in ready
And no ticket shows in building
When the person starts the merge loop on the plan run
Then the tickets move to building without any other action from the person

### 88.2

Scenario: Four unblocked tickets with distinct modules build three at a time
Given a plan run with four unblocked tickets whose touches lines name four different modules
When the person starts the merge loop on the plan run
Then three tickets show in building at the same time
And the fourth ticket stays in ready
When one of the three building tickets merges and shows in done
Then the fourth ticket moves to building
And the fourth ticket's build contains the change of the merged ticket

### 88.3

Scenario: Two tickets that touch a common module never build at the same time
Given a plan run with two unblocked tickets whose touches lines both name the module "decision log"
And a third unblocked ticket whose touches line names only "map view"
When the person starts the merge loop on the plan run
Then one of the two "decision log" tickets and the "map view" ticket show in building
And the other "decision log" ticket stays in ready
When the first "decision log" ticket merges and shows in done
Then the other "decision log" ticket moves to building
And at no time during the run do both "decision log" tickets show in building

### 88.4

Scenario: A ticket waits until its blocker is merged
Given a plan run with ticket 1 that has no blocker
And ticket 2 whose blocked_by line names ticket 1
And the two tickets touch different modules
When the person starts the merge loop on the plan run
Then ticket 1 shows in building
And ticket 2 does not show in building while ticket 1 is in building or merging
When ticket 1 shows in done
Then ticket 2 moves to building

### 88.5

Scenario: The merge queue merges one ticket at a time while three build
Given a plan run with three unblocked tickets whose touches lines name three different modules
When the person starts the merge loop on the plan run
And all three tickets finish their builds
Then at most one ticket shows in merging at any time
And all three tickets end in done

### 89.1

Scenario: Nothing builds before the start, and the start builds the tickets in the order the person chose
Given a plan run with two ready tickets, "Alpha" above "Beta", that change the same module
And the merge loop is not started
When the person waits on the board
Then both tickets stay in ready
When the person drags "Beta" above "Alpha" within ready
And the person reloads the board
Then "Beta" shows above "Alpha" in ready
When the person presses the control that starts the merge loop on the plan run
Then "Beta" moves to building
And "Alpha" stays in ready while "Beta" builds
And "Beta" later moves through merging to done, and then "Alpha" moves to building

### 89.2

Scenario: A person archives a ready ticket and restores it
Given a plan run with a ready ticket "Gamma", a blocked ticket "Delta", and a building ticket "Epsilon"
When the person looks at the three tickets on the board
Then "Gamma" and "Delta" each show an archive action
But "Epsilon" shows no archive action
When the person presses archive on "Gamma"
Then a confirmation appears that says the ticket can be restored
When the person confirms
Then "Gamma" is gone from the board
And "Gamma" stays gone after the person reloads the board
When the person restores "Gamma" through the restore verb
Then "Gamma" shows again in ready on the board

### 89.3

Scenario: A person starts one ready ticket early with the trigger icon, and it goes through the merge queue
Given an active run in which a ticket builds and a ready ticket "Zeta" waits
When the person presses the trigger icon on "Zeta"
Then "Zeta" moves to building
And "Zeta" later moves to merging
And "Zeta" then moves to done

### 89.4

Scenario: A person starts a ticket by a drag into building, then stops it by a drag back into ready
Given an active run with a ready ticket "Eta"
When the person drags "Eta" from ready into building
Then "Eta" shows in building and its build runs
When the person drags "Eta" from building back into ready
Then "Eta" shows in ready
And the build of "Eta" stops and does not move "Eta" to merging
And "Eta" stays in ready after the person reloads the board

### 89.5

Scenario: The board refuses every other manual move and has no edit control
Given an active run with a ready ticket "Theta", a blocked ticket "Iota", and a building ticket "Kappa"
When the person drags "Theta" into merging
Then the board refuses the move and "Theta" stays in ready
When the person drags "Kappa" into done
Then the board refuses the move and "Kappa" stays in building
When the person drags "Iota" into building
Then the board refuses the move and "Iota" stays in blocked
And no ticket on the board shows a control to edit its text

### 90.1

Scenario: A building ticket pulses while its fake builder runs and stops when the pass exits
Given a board with one ticket in the ready column
And the builder for this project is a fake agent that runs for a few seconds and then exits
When the person starts the build of that ticket
Then the ticket moves to the building column
And the ticket card on the board pulses
When the fake agent's pass exits
Then the ticket card stops pulsing

### 90.2

Scenario: The drawer of a building ticket shows the agent's log as it arrives
Given a board with one ticket in the ready column
And the builder for this project is a fake agent that writes a new log event every second
When the person starts the build of that ticket
And the person clicks the ticket card in the building column
Then the drawer opens beneath the board
And the drawer shows a log preview above the slice
And the log preview shows the fake agent's first event
When the fake agent writes its next event
Then the log preview shows the new event without the person reloading the page
And the log preview stays the same height while its content scrolls

### 90.3

Scenario: The log preview is gone after the ticket moves to merging
Given a ticket in the building column with a running fake agent
And the person has the drawer of that ticket open with the log preview visible
When the fake agent's pass exits and the ticket moves to the merging column
Then the ticket card is in the merging column
And the ticket card does not pulse
And the drawer of the ticket shows the slice and the sidebar
But the drawer shows no log preview

### 90.4

Scenario: A failed attempt stops the pulse while the ticket waits for its retry
Given a board with one ticket in the ready column
And the builder for this project is a fake agent whose first pass fails
When the person starts the build of that ticket
Then the ticket card in the building column pulses
When the fake agent's first pass exits with a failure
Then the ticket card stops pulsing
And the ticket card stays in the building column while it waits for the next attempt

### 90.5

Scenario: A person stops the build by hand and the pulse and preview end
Given a ticket in the building column with a running fake agent
And the ticket card pulses
When the person stops the build of that ticket by hand
Then the ticket card stops pulsing
When the ticket moves back to the ready column
And the person opens the drawer of that ticket
Then the drawer shows no log preview

### 95.1

Scenario: Two tests that each write a card see only their own card
Given a test writer has two command-line tests in one run
And each test asks the harness for a project
And the first test adds a card titled "Alpha" with werk commands
And the second test adds a card titled "Beta" with werk commands
And the first test is made to fail after it adds its card
When the test writer runs the unit tests
Then the first test's map shows only the card "Alpha"
And the second test's map shows only the card "Beta"
And each project directory has its own git repository
And the run reports one failed test and one passed test
And neither project directory exists after the run ends

### 95.2

Scenario: A server test's server stops when the test ends
Given a test writer has a server test that asks the harness for a project
And the test starts a server that serves that project's map on its own port
And the test opens the map from that port and sees an empty map
When the test ends
Then a new request to that port gets no answer
And the project directory no longer exists

### 95.3

Scenario: A real project setting and a real agent never reach a test
Given a person has a setting in their shell that points at the map they work in
And the real agent program is on the person's program search list
And a unit test reads the project setting from its environment
And a unit test starts the agent by name and passes no environment of its own
When the person runs the unit tests from that shell
Then the first test finds no project setting
And the second test gets the fake agent's reply
And the map the person works in has no new events after the run

### 95.4

Scenario: The browser test server refuses to start when the fake agent is not first
Given a person puts the real agent's directory first in the program search list
When the person starts the browser tests
Then the browser test server exits with a non-zero code
And the message names the fake agent and the program search list as the cause
And no browser test runs

### 95.5

Scenario: A fresh clone passes its checks with no manual step
Given a person makes a fresh clone of the repository
And v0's directory has no installed packages
When the person runs `make test`
Then the run installs the locked packages first
And the tests run inside v0's own directory
And the run passes

### 96.1

Scenario: An edit lands on disk between the two events that surround it
Given a fresh temporary project with the fake agent first in the program search list
And a script is installed with an event "first", then an edit that writes "notes/plan.md", then an event "second", and exit code 0
When the test writer starts the agent by its real name in the project
Then the agent prints the event "first" as one line of its output stream
And at the moment "first" arrives, "notes/plan.md" is not in the project
And the agent then prints the event "second" as the next line
And at the moment "second" arrives, "notes/plan.md" is in the project with the scripted content
And the agent exits with code 0

### 96.2

Scenario: The fake agent exits with the exit code of its script after the last step
Given a fresh temporary project with the fake agent first in the program search list
And a script is installed with two events and exit code 3
When the test writer starts the agent
Then the agent prints both events in the script order
And the agent exits with code 3 after the second event
And the agent prints nothing after the second event

### 96.3

Scenario: An edit that leads outside the project fails and writes nothing there
Given a fresh temporary project with the fake agent first in the program search list
And a script is installed with an edit to "../escaped.txt" and exit code 0
When the test writer starts the agent
Then the edit step fails and the agent reports the failure
And no file "escaped.txt" exists in the parent directory of the project
And no file outside the project changed

### 96.4

Scenario: Two launches are recorded in order with their arguments
Given a fresh temporary project with the fake agent first in the program search list
And a script is installed with one event and exit code 0
When werk starts the agent with the request "first request"
And werk starts the agent again with the request "second request"
Then the launch record in the project holds two entries
And the first entry holds the arguments with "first request"
And the second entry holds the arguments with "second request"

### 96.5

Scenario: The fake agent refuses to run when no script is installed
Given a fresh temporary project with the fake agent first in the program search list
And no script is installed in the project
When the test writer starts the agent
Then the agent exits with a non-zero code
And the agent shows an error that says no script is installed
And the agent prints no event on its output stream

### 97.1

Scenario: A pause and a tool call play while a permission ask is still open
Given a test writer scripts the fake agent with an ask step, a pause of 100 ms, and a tool call
And the fake agent runs with an input channel
When the test writer starts a turn and sends no answer to the ask
Then the output shows the permission request
And the output shows the tool call after the pause
And the output shows no final result while the ask stays unanswered

### 97.2

Scenario: An answer on the input channel settles the open ask and the turn finishes
Given a test writer scripts the fake agent with an ask step followed by a tool call
And the fake agent runs with an input channel
When the test writer starts a turn
And the output shows the permission request and the tool call
And the test writer sends an answer that allows the ask on the input channel
Then the output shows the final result
And the final result comes after the answer is sent

### 97.3

Scenario: With no input channel the open ask is denied at the end of the turn
Given a test writer scripts the fake agent with an ask step followed by a tool call
And the fake agent runs with no input channel
When the test writer starts a turn
Then the output shows the permission request
And the output shows the tool call
And the ask is denied at the end of the turn
And the output shows the final result after the denial

### 97.4

Scenario: A crash with an ask open ends the run like a real agent that dies
Given a test writer scripts the fake agent with an ask step followed by a crash
When the test writer starts a turn and sends no answer
Then the output shows the permission request
And the fake agent exits
But the output shows no tool result
And the output shows no final result

### 97.5

Scenario: A scripted pause keeps the output silent for at least its length plus the margin
Given a test writer scripts the fake agent with an ask step, a pause of 100 ms, and a tool call
When the test writer starts a turn
And the test writer measures the time from the permission request to the next line of output
Then the output stays silent for at least 120 ms
And the tool call shows after that silence

### 98.1

Scenario: A build pass and its grader each get the reply scripted for their role
Given a temporary project with a decided ticket and a temporary git repository
And the fake agent is first on the PATH
And the script holds one reply for the builder role that edits a file and exits with code 0
And the script holds one reply for the grader role that gives a passing grade
And the builder prompt and the grader prompt contain no words the script refers to
When the test writer runs a build of the ticket
Then the builder launch plays the builder reply and the edited file is in the pass commit
And the grader launch plays the grader reply and the build reports the pass as graded
And the builder launch never plays the grader reply, and the grader launch never plays the builder reply

### 98.2

Scenario: Every agent of a full build and plan shows its role in the launch record
Given a temporary project and a temporary git repository with the fake agent first on the PATH
And the script holds a reply for the spec writer, ticket writer, builder, grader, reviewer, classifier, step author and binder roles
When the test writer runs the spec step and the ticket step of the plan
And the test writer runs a build of one ticket through its loop to a merge
Then the launch record shows one launch with role spec writer and one with role ticket writer
And the launch record shows each build pass with role builder and its grader with role grader
And the launch record shows five launches with role reviewer
And the launch record shows the loop classifier with role classifier, the step author with role step author and the binder with role binder
And each launch record entry shows the role next to the arguments of that launch

### 98.3

Scenario: A chat conversation answers each message and stays open until its input closes
Given a werk server on a copy of a fixture project with the fake agent first on the PATH
And the script holds two replies for the chat role, R1 and R2
When the user opens the chat pane and sends message M1
Then the chat pane shows R1
And the chat agent is still running
When the user sends message M2 in the same conversation
Then the chat pane shows R2 under R1 in one conversation
And the launch record shows one launch with role chat, not two
When the conversation input closes
Then the chat agent exits

### 98.4

Scenario: A build pass with a permission ask plays one turn and exits with the script's code
Given a temporary project with a decided ticket and a temporary git repository with the fake agent first on the PATH
And the script holds one builder reply that prints a permission ask, then finishes, with exit code 0
When the test writer runs a build of the ticket
And werk answers the permission ask on the builder input
Then the builder finishes the same reply after the answer and does not start a second turn
And the builder exits with code 0 and the build does not hang
And the launch record shows one builder launch for that pass

### 98.5

Scenario: A reworded prompt does not change which reply a role gets
Given a build that passes with one builder reply and one grader reply scripted by role
When the builder prompt text changes to new wording
And the test writer runs the same build again with the same script
Then the builder launch still plays the builder reply and the grader launch still plays the grader reply
And the build ends with the same result as before

### 99.1

Scenario: Enter sends the message with its full context and the reply streams into the pane
Given the person has the map open with card "#werk-chat" open
And the "main" conversation tab is active in the chat pane
And the fake agent has a scripted reply in three parts
When the person types "What does this card decide?" in the composer
And the person pastes an image into the composer
And the person presses Enter
Then the server receives one request with the text, the image, the open card "#werk-chat" and the tab "main"
And the reply text appears in the chat pane part by part, before the full reply is complete
And the full scripted reply shows in the pane when the turn ends
And the launch record of the agent shows the chat role
And the turn input that the fake agent records starts with the id "#werk-chat"

### 99.2

Scenario: A second message reuses the same agent and names the card open at that moment
Given the person has card "#werk-chat" open and sent one message from the composer
And the reply to that message is complete in the chat pane
When the person opens card "#werk-onechat" on the map
And the person types "And this one?" in the composer and presses Enter
Then the first reply is still in the chat pane
And the second reply streams into the same pane below the first
And the same agent process receives the second turn, and no new agent starts
And the first line of the second turn input names "#werk-onechat", not "#werk-chat"

### 99.3

Scenario: The chat pane keeps its content as the person moves through the map
Given the person sent a message and the reply shows in the chat pane
When the person opens three different cards on the map, one after the other
Then the chat pane shows the same message and reply after each move
And the composer stays beside the map and accepts new text

### 99.4

Scenario: A card id in the reply opens that card on the map
Given the fake agent has a scripted reply that mentions "#werk-chat-stdin"
And the person has card "#werk-chat" open
When the person sends a message from the composer
And the reply shows in the chat pane
Then "#werk-chat-stdin" in the reply shows as a link, with the same style as card links in a card body
And the reply Markdown renders the same way a card body renders
When the person clicks the "#werk-chat-stdin" link
Then the map opens card "#werk-chat-stdin"
And the chat pane still shows the reply

### 99.5

Scenario: The server has no note route for the person
Given the werk server runs with the map loaded
When a person sends a request to add a note to card "#werk-chat" through a note route
Then the server answers that the route does not exist
And card "#werk-chat" shows no new note on the map
