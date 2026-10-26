## Steps

### 02.1

Ticket: werk/02

Scenario: A pure file covered by its own test passes the gate
Given a project with a list of pure files
And one listed pure file has its own test file that runs every line of it
When the user runs "make test-coverage"
Then the output shows one line for that file with a percentage of 100%
And the run exits with success

### 02.2

Ticket: werk/02

Scenario: A pure file whose own test is deleted fails even when another test runs its lines
Given a listed pure file at 100% from its own test
And another file's test also runs every line of that pure file
When the user deletes the pure file's own test file
And the user runs "make test-coverage"
Then the output shows that file at 0%
And the output names the missing test file
And the run exits with failure

### 02.3

Ticket: werk/02

Scenario: A pure file under 90% fails the gate
Given a listed pure file whose own test runs only part of its lines, below 90%
When the user runs "make test-coverage"
Then the output shows that file with its percentage
And the run exits with failure

### 02.4

Ticket: werk/02

Scenario: A pure file of type declarations only passes
Given a listed pure file that holds only type declarations and has no executable lines
When the user runs "make test-coverage"
Then the output shows that file as passing
And the run exits with success

### 02.5

Ticket: werk/02

Scenario: Plain test run never runs the gate
Given a listed pure file with no own test file
When the user runs "make test"
Then the unit tests run
And no coverage line appears for any pure file
And the missing test file is not reported

### 03.1

Ticket: werk/03

Scenario: Roles get their own scripted replies, whatever the prompt says
Given a project where the builder is scripted to write a note and the grader is scripted to report a pass
And no script is wrong or missing for either role
When I start a build whose builder prompt says "Build the ticket" instead of "Implement the ticket"
Then the builder plays its scripted reply and the note appears in the project
And the grader plays its own scripted reply and not the builder's
And the record of launches lists one launch for the builder and one for the grader, each with its role and arguments

### 03.2

Ticket: werk/03

Scenario: A chat answers two messages and ends when its input closes
Given a project where the chat role is scripted with two replies
When I send the first message in the chat
Then I see the first reply and the chat stays open
When I send the second message
Then I see the second reply
When I close the chat input
Then the chat agent exits

### 03.3

Ticket: werk/03

Scenario: A crash after an open ask prints no final result
Given a build role scripted with an ask, then a pause, then a crash
When the build starts
Then I see the permission request
And the steps after it play before any answer
And the agent exits without a tool result and without a final result

### 03.4

Ticket: werk/03

Scenario: A build with an ask ends after one reply, and a bad edit path changes nothing
Given a build role scripted with a permission ask, an edit to a path outside the project, and exit code 0
And an outside file with known content
When the build starts and I answer the permission request
Then the build ends after that one reply with the script's exit code
And the edit step is reported as failed
And the outside file keeps its content

### 03.5

Ticket: werk/03

Scenario: With no script the fake agent fails at once
Given a project with no script installed
When any agent starts
Then it exits with an error at once and plays no reply

### 05.1

Ticket: werk/05

Scenario: An agent proposes a card under a parent and reads it back
Given a project with a decided card "auth" and an empty command-line session
When the agent adds a card "login" titled "Use magic links" under the parent "auth"
Then the command prints "proposed"
And the log has exactly one new event
When the agent shows "login"
Then the output shows the words "Use magic links"
And the output shows the status as proposed
And the output shows the parent "auth"
And the output shows a rollup line

### 05.2

Ticket: werk/05

Scenario: A second add with the same id is refused and the log stays as it was
Given a project where the agent has already added the card "login"
And the agent notes the number of events in the log
When the agent adds another card with the id "login"
Then the command exits with a non-zero code
And the message names the duplicate id rule
And the log has the same number of events as before
When the agent shows "login"
Then the card still has its first words

### 05.3

Ticket: werk/05

Scenario: A decided status is refused on add
Given a project with a decided card "auth"
When the agent adds a card "pay" under "auth" with the status decided
Then the command exits with a non-zero code
And the message says that a decided status is not allowed on add
And the log has no new event
When the agent shows "pay"
Then the output says the card is not found

### 05.4

Ticket: werk/05

Scenario: A hash sign on an id is optional, but a title keeps its hash sign
Given a project with a card "auth"
When the agent adds a card "#login" titled "#1 priority: magic links" under the parent "#auth"
Then the command prints "proposed"
When the agent shows "#login"
And the agent shows "login"
Then both outputs show the same card under the parent "auth"
And both outputs show the title "#1 priority: magic links" with its hash sign

### 05.5

Ticket: werk/05

Scenario: A hand-written bad line is listed as a problem and later cards still show
Given a project whose log has the card "auth", then a hand-written line that adds a card under an unknown parent, then the card "login" added after it
When the agent shows "login"
Then the output shows the card "login" as proposed
When the agent asks for the problems of the map
Then the bad line is listed with its place in the log
And the output names the rule it breaks
And the log file still holds the bad line

### 06.1

Ticket: werk/06

Scenario: A new excerpt for a card stages as a ghost and waits for the ✓
Given a decided card on the map
When an agent adds an excerpt that supports that card
Then the command output says "proposed", not "added"
And the map shows the new excerpt as a ghost, waiting for the ✓
And the link from the card to the excerpt shows as pending
And the card keeps its status and its words until the ✓ is given

### 06.2

Ticket: werk/06

Scenario: An accepted excerpt stops being a ghost and its link goes live
Given an agent added an excerpt for a card, and the excerpt shows as a ghost
When the person gives the excerpt the ✓
Then the excerpt is no longer a ghost
And the person opens the card view and sees the excerpt under the card as supporting evidence
And the link from the card to the excerpt is live without a second accept

### 08.1

Ticket: werk/08

Scenario: Removing a card takes its subtree out in one step, and a restore brings everything back
Given a map with a decided card "auth" that refines into two child cards "login" and "session"
And "login" links to a card "audit" outside the subtree
When the person runs `werk remove auth --actor you`
Then the map no longer shows "auth", "login" or "session" in any view
And the log has one new removal event for all three cards
And `werk removed` lists "auth" with its two children
And the link from "login" to "audit" no longer shows
When the person runs `werk restore auth --actor you`
Then "auth" shows again with "login" and "session" under it
And the link from "login" to "audit" shows again
And `werk removed` lists nothing

### 08.2

Ticket: werk/08

Scenario: Removing with reparent moves the children up, and a restore puts them back
Given a map where card "platform" refines into "auth", and "auth" refines into "login" and "session"
When the person runs `werk remove auth --actor you --reparent`
Then "auth" no longer shows in the map
And "login" and "session" show directly under "platform"
When the person runs `werk restore auth --actor you`
Then "auth" shows under "platform" again
And "login" and "session" show under "auth" and not directly under "platform"

### 08.3

Ticket: werk/08

Scenario: A link waits until both of its ends are back
Given a map with cards "login" and "session" in different branches
And "login" links to "session"
When the person removes "login" with `--actor you`
And the person removes "session" with `--actor you`
And the person restores "login" with `--actor you`
Then "login" shows in the map
But the link between "login" and "session" does not show
When the person restores "session" with `--actor you`
Then the link between "login" and "session" shows again

### 08.4

Ticket: werk/08

Scenario: A removed card's id stays taken, and a cited source stays
Given a map where cards "login" and "billing" both cite the source "rfc-6749"
When the person removes "login" with `--actor you`
Then the source "rfc-6749" still shows in the map, cited by "billing"
When the person tries to add a new card with the id "login"
Then the add is refused
And the refusal message names the restore of "login"
And no new proposal for "login" appears in the map

### 08.5

Ticket: werk/08

Scenario: Remove and restore refuse without the person's say-so
Given a map with a card "login"
When the agent runs `werk remove login` without `--actor you`
Then the command refuses
And "login" still shows in the map
And the log has no new event

### 08.6

Ticket: werk/08

Scenario: When the agent runs `werk restore login` without `--actor you`
Given the person has removed "login" with `--actor you`
When the agent runs `werk restore login` without `--actor you`
Then the command refuses
And "login" still does not show in the map
And the log has no new event

### 09.1

Ticket: werk/09

Scenario: An agent lists the index of decided cards
Given a map with three decided cards, one open card, and one ghost card that was decided before it became a ghost
When the agent runs `werk search` with no term
Then the agent sees one line for each of the three decided cards, with the card id and title
And the agent does not see the open card
And the agent does not see the ghost card

### 09.2

Ticket: werk/09

Scenario: An agent searches with two terms and sees the best match first
Given a decided card "Cache layout" whose title says "cache" and whose body says "Cache eviction" and "eviction policy"
And an open card "Eviction timer" whose why says "eviction" and whose body says "CACHE warmup"
And a decided card "Cache size" that says "cache" but never says "eviction"
And a card that says "cache eviction" and was then removed from the map
When the agent runs `werk search cache eviction`
Then the agent sees two lines, each with the card id, status and title
And the first line is "Cache layout" with status decided, because it holds the most hits
And the second line is "Eviction timer" with status open
And the agent does not see "Cache size"
And the agent does not see the removed card

### 09.3

Ticket: werk/09

Scenario: An agent finds a card by a word in a rejected option and narrows the search
Given a decided card "Storage format" with an option whose why-not says "SQLite needs a native build"
And no title, why or body in the map says "sqlite"
And a decided card "Parent topic" that refines into "Storage format"
And an open card outside that subtree whose body says "sqlite"
When the agent runs `werk search sqlite`
Then the agent sees "Storage format" with status decided
And the agent sees the open card outside the subtree
When the agent runs `werk search sqlite --under` with the id of "Parent topic"
Then the agent sees only "Storage format"
When the agent runs `werk search sqlite --status decided`
Then the agent sees only "Storage format"

### 09.4

Ticket: werk/09

Scenario: An agent finds the open work under one card
Given a decided card "Client" that refines into an open card "Routing" and a proto card "Theme"
And "Routing" refines into an open card "Route guards"
And "Client" also refines into an open card marked paused, an open card marked stale, and an open card marked postponed
And "Routing" has an option and a source attached to it
And an open card "Billing" sits in a different tree of the map
When the agent runs `werk find` with the id of "Routing"
Then the agent sees "Routing" first and "Route guards" after it
And the agent does not see "Billing", the option, or the source
When the agent runs `werk find` with the id of "Client"
Then the agent sees "Routing" and "Theme" before "Route guards"
And the agent does not see "Client", because it is decided
And the agent does not see the paused, the stale, or the postponed card

### 09.5

Ticket: werk/09

Scenario: A card reopened as rejected comes back as work in every tree
Given a map with two separate trees, each with one open card
And a decided card "Auth flow" that a person then reopened as rejected
When the agent runs `werk find` with no id
Then the agent sees the open card from each tree
And the agent sees "Auth flow"
And the agent sees no decided card

### 11.1

Ticket: werk/11

Scenario: The rollup counts the card and its whole refines subtree
Given a map with a root card that has two refining child cards
And one child card has one refining grandchild card
And the root card is decided, one child is open, the other child is a prototype, and the grandchild is decided
When the user prints the root card with werk show and its id
Then the user sees one rollup line for the root card that counts 4 cards
And the rollup line shows 1 open, 1 proto and 2 decided
And the open, proto and decided counts add up to the card count

### 11.2

Ticket: werk/11

Scenario: Each incoming refines link shows the child's own rollup
Given a map with a parent card refined by a child card
And the child card is refined by two grandchild cards, one open and one decided
When the user prints the parent card with werk show and its id
Then the user sees the incoming refines link to the child card
And that link shows a rollup that counts 3 cards, not the parent's count
And the parent card's own rollup line counts 4 cards

### 11.3

Ticket: werk/11

Scenario: A card prints its options, excerpts and a proposed source with their words
Given a card that depends on another card for a stated reason
And the card has an option with a title and a why-not
And the card is supported by an excerpt with a speaker and verbatim words
And the card has a ghost source with a title and a finding
When the user prints the card with werk show and its id
Then the user sees the depends-on link with its reason
And after the links the user sees an Options section with the option's title and why-not
And the user sees a Say section with the speaker and the exact words of the excerpt
And the user sees an Ev section with the source's title and finding
And the source carries the word proposed

### 11.4

Ticket: werk/11

Scenario: A card with no options prints no Options section
Given a card that has an excerpt and a source but no options
When the user prints the card with werk show and its id
Then the user sees the Say section and the Ev section
But the user sees no Options section

### 11.5

Ticket: werk/11

Scenario: Show with no id prints the root card
Given a map with a root card that a second card refines
When the user runs werk show with no id
Then the user sees the root card's title and its rollup line
And the user sees the incoming refines link from the second card with that card's rollup

### 14.1

Ticket: werk/14

Scenario: A card added from the command line appears on the open page without a reload
Given the werk server runs for a project with a root card "Root"
And the person has the page for "Root" open in the browser
And the person has typed "half a thought" in the chat composer
When the person adds a card "Fresh idea" under "Root" with the werk command line in a terminal
Then the open page shows "Fresh idea" in the map without the person doing anything
And the page did not reload
And the chat composer still holds "half a thought"

### 14.2

Ticket: werk/14

Scenario: In dev, a server edit changes a response and the live page stays connected
Given the person runs werk in dev mode on a copy of the app
And the person has a card page open in the browser
When the person edits a route handler in the server code of that app copy and saves the file
Then the server log says that it reuses the live server
And the same server process still runs on the same port
And the next request to that route returns the edited response
When the person adds a card "After edit" with the werk command line
Then the open page shows "After edit" without a reload, because its live channel did not drop

### 14.3

Ticket: werk/14

Scenario: In dev, a client edit that cannot apply in place reloads the page and keeps the draft
Given the person runs werk in dev mode on a copy of the app
And the person has the page for a card open in the browser
And the person has typed "draft that must survive" in the chat composer
When the person makes an edit in the client code of that app copy that cannot apply in place, and saves the file
Then the page reloads by itself
And the page shows the same card title as before the reload
And the chat composer holds "draft that must survive"

### 17.1

Ticket: werk/17

Scenario: A person opens a deep card and follows the breadcrumbs back
Given a map where a card sits four levels below #root
And the left pane is narrower than 700px
When the person opens the home view and opens the deep card from the map
Then the header shows the path on one line, with a `…`, then the parent card, then the open card in bold
And the segments are separated by `›`
When the person hovers over the path
Then an overlay shows the full path from Home to the open card
When the person clicks the parent card in the path
Then the map shows the parent card, and the path ends with the parent card in bold

### 17.2

Ticket: werk/17

Scenario: The header counts follow the open card
Given a map where #root has children with the statuses open, proto, and decided, and one child is stale
When the person opens #root
Then the header shows a total count and a dot count for each status that has cards
And the dot counts for open, proto, and decided add up to the total
And no count shows for a status that has zero cards
And hovering a count shows a title that names that status
When the person opens a child card that has a smaller subtree
Then the header counts change to the numbers for that subtree

### 17.3

Ticket: werk/17

Scenario: A person finds a card by id and opens it from the search box
Given a map with a card #werk and other cards whose ids start with or contain "werk"
And one of those cards is stale
When the person types `#werk` in the search box
Then a list shows at most twelve rows, and the first row is #werk
And the rows with ids that start with "werk" come before the rows with ids that only contain it
And each row shows a dot, the title, and the id
And the row of the stale card has a red dot
When the person presses the down arrow and then the up arrow
Then the first row is selected again
When the person presses Enter
Then the map opens #werk, the breadcrumbs end with its title in bold, and the search box is empty

### 21.1

Ticket: werk/21

Scenario: A conversation keeps its model and context fill across a server restart
Given a person has a conversation open in werk
And the person picks "Opus" in the model selector above the composer
And the person sends a message and the agent answers
And the context pie shows a fill value
When the werk server restarts
And the person opens the same conversation again
Then the model selector shows "Opus"
And the context pie shows the same fill value as before the restart
When the person asks "What did I ask you before?"
Then the agent answers with the earlier message, because the same session continues

### 21.2

Ticket: werk/21

Scenario: A dead stored session starts again and the waiting message is delivered
Given a person has a conversation with an earlier answered turn
And the agent's stored session no longer exists in Claude Code
When the werk server restarts
And the person sends a new message in that conversation
Then the agent answers the new message in a new session
And the pane shows no "Your message was not delivered. Send it again." message
And the person does not need to send the message a second time

### 21.3

Ticket: werk/21

Scenario: A crash with another error retries once, then asks the person to send again and shows the whole error
Given a person has a conversation with an earlier answered turn
And the agent exits early with a multi-line error each time it starts, and the error is not "No conversation found with session ID"
When the person sends a message
Then the agent starts one more time before werk gives up
And the pane shows "Your message was not delivered. Send it again."
And the pane shows every line of the agent's error output
When the agent can start again and the person sends the message again
Then the agent answers in the same session as the earlier turn

### 21.4

Ticket: werk/21

Scenario: A login problem shows its error at once with no retry
Given a person has a conversation open in werk
And the agent fails at start with a login error
When the person sends a message
Then the agent does not start a second time
And the pane shows every line of the login error
And the pane shows "Your message was not delivered. Send it again."

### 21.5

Ticket: werk/21

Scenario: The model switch and clear context refuse during a turn and restart quietly when idle
Given a person has a conversation open with "Sonnet" in the model selector
And the context pie is blue before the first turn
When the person sends a message that makes a long turn
And the person picks "Opus" in the model selector while the turn runs
Then werk refuses the switch and the model selector still shows "Sonnet"
When the turn ends and the person picks "Sonnet with Opus advisor"
Then the model selector shows "Sonnet with Opus advisor"
And the pane shows no crash message
When the person clicks the context pie
Then a popover shows the fill percentage and a "Clear context" action
When the person clicks "Clear context"
Then the pane shows no crash message
And the next message the person sends gets an answer

### 23.1

Ticket: werk/23

Scenario: Two conversations with different home cards stay apart
Given a person has card "A" open and starts a conversation on it
And the person opens card "B" and starts a new conversation on it
When the person sends a message in the "A" tab
And the person sends a message in the "B" tab
Then the tab strip below the composer shows two chips, labelled with the titles of card "A" and card "B"
And each tab's chat log shows only its own message and its own agent's reply
When the agent in the "A" tab asks the person a question
Then the "A" chip blinks yellow
And the "B" tab's pane does not show the question
When the person switches to the "A" tab
Then the person sees the question and can answer it there

### 23.2

Ticket: werk/23

Scenario: Switching to a tab shows its newest message
Given a person has two conversations in tabs, and the second tab has a long chat log
And the person is looking at the first tab
When the agent in the second tab sends a new reply
And the person switches to the second tab
Then the chat log of the second tab is scrolled to the bottom
And the newest reply is visible
When the person scrolls up in that chat log and the agent sends another reply
Then the chat log stays where the person scrolled it

### 23.3

Ticket: werk/23

Scenario: A crashed agent marks its tab and tells the other tabs
Given a person has two conversations in tabs, "A" and "B"
And the agent in tab "A" exits with code 1 and an error message while the person looks at tab "B"
Then the "A" chip blinks red
And the pane of tab "B" shows one line that names tab "A" and its error
When the person switches to tab "A"
Then the pane of tab "A" shows the whole error
When the person sends a new message in tab "A"
Then a new agent starts for tab "A" and replies
And the "A" chip stops blinking red
And the line about tab "A" is gone from the pane of tab "B"

### 23.4

Ticket: werk/23

Scenario: A model switch is not a crash
Given a person has a conversation in a tab with a working agent
When the person switches the model for that conversation
Then the chip of that tab does not blink red
And no other tab shows a line about a dead agent
And the next message the person sends gets a reply

### 23.5

Ticket: werk/23

Scenario: A running background agent and a suggested next action
Given a person has a conversation in a tab
When the agent starts one background task and ends its turn
Then the pane shows a line under the chat log for the running background agent
And the tab counts as running
When the agent reports an empty list of background tasks
Then the line under the chat log is gone and the tab counts as idle
When the agent ends a reply with the line Next: say "merge it"
Then the pane shows a button labelled "merge it"
When the person clicks the button
Then "merge it" appears in the chat log as the person's message and the agent replies to it
And the "merge it" button is gone

### 24.1

Ticket: werk/24

Scenario: Pick a card from the hash menu
Given a project whose map holds a card "werk-shots" titled "Pasted screenshots"
And the person opens a conversation in werk
When the person types "Look at #wer" in the composer
Then a menu opens below the caret with the cards whose id or title matches "wer"
And the menu lists "werk-shots" with its title
When the person moves to "werk-shots" with the arrow keys and presses Enter
Then the composer reads "Look at #werk-shots"
And the menu closes
But when the person types "`#wer" with a backtick before the hash, no menu opens

### 24.2

Ticket: werk/24

Scenario: A pasted PNG uploads at once and reaches the agent as a stored path
Given the person opens a conversation in werk
When the person types "What is wrong here? " in the composer
And the person pastes a PNG screenshot
Then the composer shows "[Image #1]" at the caret
And a chip for image 1 shows a spinner, then a thumbnail of the screenshot
When the person presses Enter
Then the turn reaches the agent with "[Image #1]" mapped to a path in the project's attachments folder
And the agent is told to open that image
And the stored image does not show as a change in the project's version control

### 24.3

Ticket: werk/24

Scenario: An oversized image is refused and is not sent
Given the person opens a conversation in werk
When the person drops a 25 MB PNG image on the composer
Then the composer shows "[Image #1]" and a chip for it
And the chip shows a refusal that names the size limit
When the person presses Enter
Then the turn the agent gets carries no path for the refused image
And no file for that image appears in the project's attachments folder

### 24.4

Ticket: werk/24

Scenario: Removing the first of two images renumbers the second
Given the person opens a conversation in werk
And the person pastes a first PNG image and then a second JPEG image
And the composer shows "[Image #1]" and "[Image #2]" with two thumbnail chips
When the person removes the chip for image 1
Then the composer no longer contains the first token
And the remaining token reads "[Image #1]"
And one chip remains, with the thumbnail of the JPEG image
When the person presses Enter
Then the turn maps "[Image #1]" to the stored path of the JPEG image

### 24.5

Ticket: werk/24

Scenario: A bad image request does not harm the server
Given werk is running and a conversation is open
When someone requests an image with an empty name
Then the answer is 404
When someone requests an image whose name climbs out of the attachments folder
Then the answer is 404 and no file outside the folder is returned
When the person then types "/" in the composer
Then the menu of the agent's slash commands opens, so the server still runs

### 25.1

Ticket: werk/25

Scenario: A pasted screenshot becomes a numbered image the agent reads by path
Given the person has the chat composer open on a project
When they paste a PNG screenshot into the composer
Then a chip appears above the composer showing a spinner
And the composer text contains "[Image #1]" at the caret
When the upload finishes
Then the chip shows a thumbnail of the screenshot and the token "[Image #1]"
When they type "Why is this red?" and press Enter
Then the message appears in the chat with the image shown under "[Image #1]"
And the agent's turn says "[Image #1]" is a path in the project's attachments folder
And the agent's turn tells it to open each image with a file read
And the agent's turn does not contain the image bytes

### 25.2

Ticket: werk/25

Scenario: An oversized image shows its refusal and is not sent
Given the person has the chat composer open
When they paste a 2 MB PNG and then a 25 MB PNG
Then the first chip shows its thumbnail with "[Image #1]"
And the second chip shows a reason that the image is larger than 20 MB
When they remove the second chip
Then "[Image #2]" disappears from the composer text
When they type "Why is this red?" and press Enter
Then the agent's turn lists only "[Image #1]" with its stored path
And the refused image is absent from the turn

### 25.3

Ticket: werk/25

Scenario: Removing a chip renumbers the remaining images
Given the person has pasted two PNG screenshots
And the composer shows chips and tokens "[Image #1]" and "[Image #2]"
When they remove the chip for "[Image #1]"
Then the text "[Image #1]" in the composer is removed
And the remaining chip now shows "[Image #1]"
And the composer text contains "[Image #1]" once and no "[Image #2]"
When they press Enter
Then the agent's turn maps "[Image #1]" to the path of the image that stayed

### 25.4

Ticket: werk/25

Scenario: Enter waits for a running upload
Given the person pastes a PNG and its chip still shows a spinner
When they type a question and press Enter before the upload ends
Then the message does not go out yet
When the upload finishes and the chip shows its thumbnail
Then the message goes out with the stored image path as "[Image #1]"

### 25.5

Ticket: werk/25

Scenario: A request for an image with no name answers 404 and the server stays up
Given the werk server is running with a stored screenshot
When the person's browser asks for an image with an empty name
Then the server answers 404
And a request with a name that climbs out of the attachments folder also answers 404
When they then paste a PNG into the composer
Then the chip shows its thumbnail and the chat still works

### 27.1

Ticket: werk/27

Scenario: Archive a blocked ticket and restore it to the same column and reason
Given a project whose board has a planned ticket "auth/01" in the ready column
When the person runs `werk ticket move auth/01 blocked --reason "waits for the token API"`
And the person runs `werk ticket archive auth/01`
Then `werk ticket list` shows "auth/01" as archived
And the listing still records the blocked column and the reason "waits for the token API"
When the person runs `werk ticket restore 01 --actor you`
Then `werk ticket list` shows "auth/01" in the blocked column with the reason "waits for the token API"
And the board log has exactly one new restore event, and its actor is "you"
And the decision log beside the board log is unchanged

### 27.2

Ticket: werk/27

Scenario: A move without a reason is refused
Given a project whose board has a planned ticket "auth/01" in the ready column
When the person runs `werk ticket move auth/01 blocked` with no reason
Then the command fails with a message that asks for a reason
And `werk ticket list` still shows "auth/01" in the ready column
And the board log has no new event

### 27.3

Ticket: werk/27

Scenario: Restoring a ticket that is not archived changes nothing
Given a project whose board has a ticket "auth/02" in the ready column that was never archived
When the person runs `werk ticket restore 02`
Then the command exits with status 1
And the board log is byte-for-byte the same as before
When the person runs `werk ticket restore 99`, a number that is not on the board
Then the command exits with status 1
And the board log is byte-for-byte the same as before

### 27.4

Ticket: werk/27

Scenario: A done ticket cannot be archived
Given a project whose board has a ticket "auth/03" in the done column
When the person runs `werk ticket archive auth/03`
Then the command fails with a message that a done ticket cannot be archived
And `werk ticket list` still shows "auth/03" in the done column and not archived
And the board log has no new event

### 27.5

Ticket: werk/27

Scenario: The board listing shows every ticket in the column its events lead to
Given a project whose board log holds planned events for "auth/01", "auth/02" and "auth/03"
When the person moves "auth/02" to blocked with a reason
And the person archives "auth/03"
And the person runs `werk ticket list`
Then the listing shows "auth/01" in ready, "auth/02" in blocked with its reason, and "auth/03" as archived
And every event in the board log names the actor that wrote it

### 29.1

Ticket: werk/29

Scenario: A second plan of the same subtree extends the spec and continues the ticket numbers
Given a person has planned a subtree once, and the board shows its one spec and tickets 1 to 3 as ready
And ticket 1 is building and ticket 2 is done
When the person adds a new decided card under that subtree and plans the same subtree again
Then the board still shows one spec for the subtree, and the spec text now covers the new card
And ticket 3 keeps its number and shows the rewritten text
And a new ticket appears with number 4, and no ticket number repeats
And ticket 1 still shows building and ticket 2 still shows done, with their text unchanged

### 29.2

Ticket: werk/29

Scenario: An open ticket the new spec no longer needs is archived and can be restored
Given a person has planned a subtree, and the board shows a ready ticket that delivers one of its cards
When the person removes that card from the subtree and plans the subtree again
Then the ticket leaves the open tickets on the board
And the archive shows the ticket with the reason that the current spec no longer needs it
When the person restores the ticket from the archive
Then the ticket shows on the board again under its old number

### 29.3

Ticket: werk/29

Scenario: Retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block
Given a person has planned a subtree, and the board shows a ready ticket that cites a decided card
When the person gives that card a new title
Then the ticket moves to blocked on the board
And the block reason names the card and says that its title changed
When the person plans the subtree again
Then the ticket is no longer blocked, and its text cites the card with the new title

### 29.4

Ticket: werk/29

Scenario: A note on a cited card blocks nothing, and a building ticket is never blocked
Given a person has planned a subtree, and the board shows a ready ticket and a building ticket that both cite the same card
When the person adds a note to that card
Then both tickets keep their status, and neither shows a block reason
When the person changes the body of that card
Then the ready ticket moves to blocked with a reason that names the card and a changed body
But the building ticket still shows building, with no block reason

### 29.5

Ticket: werk/29

Scenario: A card added under a planned subtree reports a failed check without blocking tickets
Given a person has planned a subtree, and the board shows ready tickets for it
When the person adds a new card under that subtree that no ticket cites
Then werk reports that the cards-cited check fails and names the new card
And every ticket of the subtree keeps its status, with no block reason

### 30.1

Ticket: werk/30

Scenario: A folder of correct tickets passes
Given a spec whose User stories heading lists stories 1 and 2
And a root card with two decided cards under it
And a folder of two hand-written tickets in the fixed format
And the first ticket cites one decided card and delivers story 1
And the second ticket cites the other decided card, delivers story 2, and is blocked by the first ticket
And each ticket has a name for what it touches, a What to build text, an acceptance bullet, and only make targets under Checks
When I run ticket-check on the folder with the root card and the spec
Then I see no failure lines
And I see a last line that counts 2 tickets, 0 own-check failures, 0 failures, 2 decided cards and 2 stories
And the exit code is 0

### 30.2

Ticket: werk/30

Scenario: Own-check failures name the ticket, the check and the field
Given a spec, a root card and a folder of three tickets
And the first ticket is correct
And the second ticket mentions a source file path with a slash and a file extension on the 12th line of its body
And the third ticket has no touches line
When I run ticket-check on the folder
Then I see a line for the second ticket that names the no-file-paths check, the path and line number 12
And I see a line for the third ticket that names the shape check and the touches field
And I see no failure line for the first ticket
And the last line counts 3 tickets and 2 own-check failures
And the exit code is 1

### 30.3

Ticket: werk/30

Scenario: An uncited decided card fails the set, and a ghost does not count
Given a root card with three cards under it that have status decided
And one of the three is a ghost
And a folder of correct tickets that cite the root card and one of the other two decided cards
And no ticket cites the third decided card, which is a real card
And no ticket cites the ghost
When I run ticket-check on the folder
Then I see one line that begins with "ticket set" and names the uncited real card
And no line names the ghost
And the last line counts 2 decided cards
And the exit code is 1

### 30.4

Ticket: werk/30

Scenario: A cycle in blocked_by names only the tickets on the cycle
Given a folder of four correct tickets numbered 1 to 4
And ticket 2 is blocked by ticket 3
And ticket 3 is blocked by ticket 2
And ticket 4 is blocked by ticket 3
And ticket 1 has no blocker
And the cards and stories are all covered
When I run ticket-check on the folder
Then I see a blocked_by failure line for ticket 2
And I see a blocked_by failure line for ticket 3
And I see no failure line for ticket 1 or ticket 4
And the exit code is 1

### 30.5

Ticket: werk/30

Scenario: A spec with no User stories heading is a malformed call
Given a folder of correct tickets and a root card that is in the map
And a spec file that has no User stories heading
When I run ticket-check on the folder with that spec
Then I see a message that the spec has no User stories heading
And I see no pass result and no ticket failure lines
And the exit code is 2

### 35.1

Ticket: werk/35

Scenario: A failed grade on one criterion sends its gap to the next builder pass
Given a ticket "Paste a screenshot" with two acceptance criteria is on the board
And its checks pass on the first pass
When I start the build
And the grader scores one criterion 2 and gives the gap "an empty list is still sent"
Then the first pass shows as failed at the grade step
And the ticket does not move to merging
And the second builder pass starts with that gap in its input
And the board shows the ticket still building

### 35.2

Ticket: werk/35

Scenario: A later grade does not fail a line that passed before
Given a ticket cites two decided cards, "A message carries its images" and "The composer shows a menu"
And in the first grade the first card's line fails with a named gap and the second card's line passes
When the second builder pass closes the gap
And the grader now names a new small detail on the second card that already existed at the first grade
Then the second grade passes the second card's line
And the first card's line passes because its gap is closed
And the pass goes on to the review

### 35.3

Ticket: werk/35

Scenario: One HIGH security finding alone fails a passing grade
Given a ticket whose checks and grade pass
When the five reviewers of design, maintainability, tests, security and dependencies, and performance read the diff at the same time
And only the security reviewer reports a HIGH finding with a file, a line, an impact and a fix
And the other four reviewers report no finding
Then the pass fails at the review
And I see the failure name the security finding
And the next builder pass starts with that finding in its input

### 35.4

Ticket: werk/35

Scenario: MEDIUM and unknown findings are recorded and do not block
Given a ticket whose checks and grade pass
When the reviewers report one MEDIUM finding and one finding with an unknown severity
And no reviewer reports a CRITICAL or HIGH finding
Then the review passes
And I see both findings recorded on the ticket
And the ticket goes on to merging

### 35.5

Ticket: werk/35

Scenario: The grader starts with read-only tools only
Given a ticket reaches the grade step in a build
When the grader starts
And I open the grader's launch record in the pipeline log
Then I see a tool list that holds reading files, searching text, finding files, and git diff, log and show
And I see no tool that writes or edits a file
And the grader's scores still come back to the loop

### 35.6

Ticket: werk/35

Scenario: The last counted pass with only a small gap merges and files a follow-up
Given a ticket "Paste a screenshot" with a retry cap of 5 cites the decided card "A message carries its images"
And passes 1 to 4 failed at the grade step
When pass 5 fails the grade only on that card's line, one point under a pass, with the gap "an empty list is still sent"
And no person must settle that gap and the diff builds that card
And the review passes
Then the ticket moves to merging and then to done
And a follow-up ticket appears on the board that cites that card and quotes the gap
And the follow-up waits for the original ticket before it builds

### 35.7

Ticket: werk/35

Scenario: The last counted pass with a missed criterion parks the ticket
Given a ticket with a retry cap of 5 has failed passes 1 to 4
When pass 5 fails on a small gap and also misses one acceptance criterion
Then the ticket reaches the cap and shows as blocked with the stop reason
And no follow-up ticket is filed
And the tickets that need it stay blocked behind it

### 37.1

Ticket: werk/37

Scenario: A silent builder is cancelled and the next pass is told why
Given a ticket on the board with the silence limit set to a few milliseconds
And the builder session writes its first event and then goes quiet with no tool call running
When the person starts the build run
Then the first pass is cancelled for silence
And the session log shows a line from the overseer saying the pass was cancelled for silence
And a fresh builder pass starts, and its brief says the last pass was silent
And the fresh pass counts against the ticket's retry cap

### 37.2

Ticket: werk/37

Scenario: A slow start is not treated as silence
Given a ticket on the board with the silence limit set to a few milliseconds
And the builder session writes no event for longer than the silence limit after it starts
When the person starts the build run
Then the pass is not cancelled during that wait
And the pass runs after its first event arrives
And the session log has no silence cancel line for that pass

### 37.3

Ticket: werk/37

Scenario: A permission ask is decided by the classifier, and no verdict means deny
Given a ticket in a build run
And the builder asks permission to run a tool during its pass
When the classifier answers allow
Then the builder's call goes ahead
And the answer and its comment appear in the session log
When the builder asks permission again and the classifier gives no verdict
Then the ask is denied
And the denial appears in the session log
And the builder continues without that call

### 37.4

Ticket: werk/37

Scenario: A looping verdict cancels the pass and the reason reaches the next brief
Given a builder pass that repeats the same failing tool call
And the progress check is set to run on a short interval
When the classifier looks at the brief and the new tool calls and says the builder is looping, with a reason
Then the pass is cancelled
And the session log shows the looping verdict and its reason
And the next builder pass has that reason in its brief
But when no new tool call came since the last verdict, the classifier is not asked

### 37.5

Ticket: werk/37

Scenario: A failed process probe cancels nothing
Given a builder pass with a long tool call running
And the process check cannot read the process table
When the overseer samples the tool call
Then the pass is not cancelled
And the session log shows a line saying the probe failed
And the pass ends only when the tool call returns or the wall-clock limit is reached

### 43.1

Ticket: werk/43

Scenario: A build miss on a done ticket is recorded and listed
Given the ticket "app/01" is done and has no follow-up records
When the person runs `werk followup app/01 --class build --found after-merge --why "the link expires after 1 minute, the card says 15" --catchable yes`
Then the command reports that it recorded the follow-up
When the person runs `werk followup app/01 --list`
Then the list shows record 1 for "app/01"
And record 1 shows the class build, found after merge, the reason line, and catchable yes

### 43.2

Ticket: werk/43

Scenario: A plan miss is recorded without a catchable answer
Given the ticket "app/01" is done
When the person runs `werk followup app/01 --class plan --found review --why "no card said how long the link lasts"`
Then the command reports that it recorded the follow-up
When the person runs `werk followup app/01 --list`
Then the list shows record 1 with the class plan, found at review, and the reason line
And the record shows no catchable answer

### 43.3

Ticket: werk/43

Scenario: A wrong catchable answer is refused and nothing is recorded
Given the ticket "app/01" is done and has no follow-up records
When the person runs `werk followup app/01 --class build --found review --why "the button label is wrong"` with no catchable answer
Then the command refuses and says a build miss needs a catchable answer
When the person runs `werk followup app/01 --class plan --found review --why "the card was silent" --catchable no`
Then the command refuses and says a plan miss does not take a catchable answer
When the person runs `werk followup app/01 --list`
Then the list shows no records for "app/01"

### 43.4

Ticket: werk/43

Scenario: A ticket that is not done, or does not exist, is refused
Given the ticket "app/02" is in building
And no ticket "app/99" exists
When the person runs `werk followup app/02 --class build --found review --why "rename the button" --catchable no`
Then the command refuses and says the ticket is not done
When the person runs `werk followup app/99 --class plan --found review --why "missing rule"`
Then the command refuses and says the ticket does not exist
When the person runs `werk followup app/02 --list`
Then the list shows no records for "app/02"

### 43.5

Ticket: werk/43

Scenario: The last correction of a record is the class in force
Given the ticket "app/01" is done
And record 1 of "app/01" is a build miss found after merge, catchable yes
When the person runs `werk followup app/01 --class plan --found after-merge --why "the card never said 15 minutes" --of 1`
And the person runs `werk followup app/01 --list`
Then the list shows record 1 with the class plan in force
And the list shows the correction as a record that corrects record 1
When the person runs `werk followup app/01 --class build --found after-merge --why "the card does say 15 minutes" --catchable yes --of 1`
And the person runs `werk followup app/01 --list`
Then the list shows record 1 with the class build in force

### 44.1

Ticket: werk/44

Scenario: Tickets appear in their columns and a command line move redraws the board
Given a project whose board log holds tickets in blocked, ready, building, merging and done
When the person opens the board page
Then the board shows five columns in the order blocked, ready, building, merging, done
And each ticket card sits in the column its state names
And a ticket with two unfinished blockers shows a blocker count of 2
And a ticket that has been tried three times shows a retry count of 3
When the person moves a ready ticket into building from the command line
Then the board redraws without a page reload
And the ticket now shows in the building column and no longer in the ready column

### 44.2

Ticket: werk/44

Scenario: A long title is cut on the card and shown in full in the drawer
Given a ready ticket titled "Import ticket files from the plan folder and skip ids that already exist on a second run"
And the column is narrow enough that this title needs four lines
When the person looks at the card
Then the card shows two lines of the title ending in an ellipsis
When the person points at the title
Then a tooltip shows the full title
When the person clicks the card
Then a drawer opens beneath the board
And the drawer header shows the ticket id on the first line and the full title on the line below

### 44.3

Ticket: werk/44

Scenario: A building ticket pulses only while its session process is alive
Given a building ticket whose board log has a session start that names a builder process
And that process is running
When the person opens the board
Then the ticket card shows a pulsing dot in its top-left corner
And the first line of the title sits a few pixels to the right of the dot
When the person kills the builder process from a terminal
And nothing writes a session end
Then the dot goes away from the card
And the first line of the title moves back to the left edge
And a building ticket with no running process never shows a dot

### 44.4

Ticket: werk/44

Scenario: The drawer of a building ticket shows the live log, the sidebar and the decisions
Given a building ticket whose session log holds many stream events
And the ticket cites a decided card
And an earlier build of the ticket proposed a card that the person has not accepted
When the person clicks the ticket card
Then the drawer shows a fixed-height live log above the ticket text
And each log line shows one summarised event with its full time
And the sidebar lists the cites, blockers, retries, checks, stories and touches
And the Decisions section lists the proposed card marked as a proposal
When the person clicks the cited card in the sidebar
Then the map opens on that card
When the person returns to the board and opens the drawer again
And the person folds the sidebar to a narrow rail and reloads the page
Then the sidebar is still folded
And when the ticket leaves building, the live log is gone from its drawer
But the ticket text and the sidebar remain

### 44.5

Ticket: werk/44

Scenario: A narrow pane scrolls the board sideways and keeps columns readable
Given a board with tickets in all five columns
When the person opens the board in a pane 600 pixels wide
Then the board has a sideways scrollbar
And no column is narrower than 200 pixels
And the person scrolls sideways to reach the done column
When the person widens the pane to 1600 pixels
Then the five columns share the full width
And the sideways scrollbar is gone

### 48.1

Ticket: werk/48

Scenario: A make target runs freely while an accept command still asks
Given an agent works in werk's repository with the shared Claude Code settings
And a person's personal settings file allows every werk command
When the agent runs a make target such as `make lint`
Then the target runs with no permission question
When the agent runs the werk command that accepts a card
Then Claude Code asks the person for permission before it runs
And the personal allow entry does not turn the question off
And the same question appears for the remove command and the restore command

### 48.2

Ticket: werk/48

Scenario: An edit that leaves an unused import is repaired and the agent hears nothing
Given an agent works in werk's repository
And a client source file has wrong indentation
When the agent edits the file and the edit leaves an unused import
Then the edit is saved and is not blocked
And the file on disk has the unused import removed and the indentation fixed
And the agent receives no lint output after the edit
When the agent next edits the file to add a React hook with a missing dependency
Then the edit is still saved
And the agent sees the lint error about the missing dependency in the hook output
And the agent fixes the file in its next edit and then sees no error

### 48.3

Ticket: werk/48

Scenario: A copied subagent fails the check and a restored link passes it
Given werk ships subagents and the repository's subagent folder holds a link to each one
When a person runs the check for the repository setup
Then the check passes
When a person replaces one subagent link with a copy of the same file
And runs the check again
Then the check fails and names that subagent as not a link
When a person restores the link and runs the check again
Then the check passes
When a person removes the link of a shipped subagent
And runs the check again
Then the check fails and names the shipped subagent that has no link
But a subagent that only werk's own development uses stays a plain file and does not fail the check

### 48.4

Ticket: werk/48

Scenario: The shared settings stay small, safe and free of skills and servers
Given a person opens the shared Claude Code settings of the repository
When the person reads the allowed commands
Then every make target and the werk command line are allowed
And no allowed command writes outside the repository
And no allowed command reaches the network
When the person looks for project skills and MCP server entries
Then the repository has no skill definition and no MCP server entry
When the person adds a personal settings file with their own tools
Then git shows the file as ignored and does not list it as a new file

### 49.1

Ticket: werk/49

Scenario: The release build makes four executables with checksums
Given a checkout of werk with its dependencies installed
When the person runs the release build
Then the build finishes without an error
And the output has one executable each for macOS on ARM, macOS on Intel, Linux on ARM and Linux on Intel
And each executable has a checksum file beside it
And each checksum matches the executable it sits beside

### 49.2

Ticket: werk/49

Scenario: The executable serves the client from an empty folder
Given the release build has made the executable for the build machine
And the person copies only that executable into a new empty folder
And the machine has no source folder of werk and no separate Bun install on the path used
When the person starts the executable in that empty folder
Then werk starts and prints the address where it serves
And the person opens that address in a browser
And the werk client page loads and shows its screen with no missing file error
And no new folder of werk files appears next to the executable

### 49.3

Ticket: werk/49

Scenario: The help of the executable lists every command
Given the executable runs from an empty folder as in the start scenario
When the person asks the executable for its help
Then the help lists every werk command that the same help lists when werk runs from a checkout
And the help is not an empty list
And the person runs one of the listed commands with the executable
And the command works and does not say that a file or folder is missing

### 49.4

Ticket: werk/49

Scenario: The agent and the commands name the executable that is running
Given the person starts the executable in an empty project folder
And the person opens the client in a browser
When the person sends a message in the chat pane that makes the agent run a werk command
Then the agent runs the command through the path of the executable that is running
And the command that the person sees names that executable path
And the command does not name Bun or a source file path
And the agent's answer shows that the werk command worked

### 50.1

Ticket: werk/50

Scenario: A push to the main line runs every check and starts the executable
Given a person merges a change and the main line is pushed to GitHub
When the GitHub Actions run for that push starts on a clean machine
Then the run installs the locked packages from a clean state
And the run shows lint, typecheck, test with coverage, and e2e as separate steps that pass
And the run builds the executable for the runner's platform
And the run starts the executable once and reads the map from it
And the run ends green
And the commit shows as able to be released

### 50.2

Ticket: werk/50

Scenario: A pull request gets the same run and merges only on green
Given a person opens a pull request with a change
When the GitHub Actions run for the pull request finishes
Then the pull request page shows the same checks as a push to the main line, including the build and the start of the executable
And the merge button is available only when every step is green
But when a step is red, the page names the failed step and the pull request does not merge

### 50.3

Ticket: werk/50

Scenario: A red run on the main line blocks the release and keeps the merge
Given a change is merged and its commit is on the main line
And one check fails on the clean machine, for example a typecheck error that the builder's machine did not show
When the run for that push ends
Then the run is red and names the failed step
And the commit stays on the main line
And the person sees that this commit cannot be released
And the failure is available as the basis for a follow-up ticket

### 50.4

Ticket: werk/50

Scenario: The run uses the Bun version that the repository pins
Given the repository pins one exact Bun version
When a run starts for a push
Then the run installs that exact Bun version before any check
And the log of the run shows the same Bun version as the pinned one
And when a later change sets a new pinned version, the next run installs the new version

### 50.5

Ticket: werk/50

Scenario: An executable that does not serve the map fails the run
Given every check passes and the executable builds
And the executable, when started, does not answer a read of the map
When the run reaches the start step
Then the start step fails
And the run ends red, even though lint, typecheck, test with coverage, and e2e are green
And the commit cannot be released

### 61.1

Ticket: werk/61

Scenario: A fresh clone builds on an empty first commit and passes every check
Given a person clones the werk repository
When the person lists the files of the first commit on the main branch
Then the first commit holds no files
And every later commit on the main branch has the first commit as an ancestor
When the person installs the dependencies and runs `make test`, `make test-coverage`, `make typecheck`, `make lint` and `make e2e` one after the other
Then each of the five commands exits with success
And `make e2e` passes although the project has no browser spec yet

### 61.2

Ticket: werk/61

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

Ticket: werk/61

Scenario: The tests pass on a machine with no real agent installed
Given a person has a copy of the werk project with its dependencies installed
And no `claude` program is installed or reachable on the PATH of the person's shell
When the person runs `make test`
Then `make test` exits with success
And the tests that run the command line read the scripted events and the file edit of the fake agent from a temporary project
And the working tree of the person's project has no new or changed files after the run

### 61.4

Ticket: werk/61

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

Ticket: werk/62

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

Ticket: werk/62

Scenario: An accept without the person's claim refuses and leaves the ghost waiting
Given the agent has proposed a card from the command line
When the agent accepts that card without stating that the person asked for it
Then the command exits with a failure
And the log has no new event
And showing the card still marks it as a ghost
When the agent accepts the card again and states that the person asked for it
Then showing the card marks it as real

### 62.3

Ticket: werk/62

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

Ticket: werk/62

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

Ticket: werk/62

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

### 64.1

Ticket: werk/64

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

Ticket: werk/64

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

Ticket: werk/64

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

Ticket: werk/64

Scenario: An amend that removes a required fact is refused and the decided card stays the same
Given a decided card with a decider, a depends_on edge, a rejected option, and a kill criterion
When an agent amends the card so that it no longer has its depends_on edge
Then the command exits with a failure
And the output names the missing depends_on basis and prints the command that adds it
And the card still shows as decided
And the card shows the same words and edges that it had before the amend

### 64.5

Ticket: werk/64

Scenario: An amend that keeps every fact succeeds, and card text is not checked
Given a decided card with a decider, a depends_on edge, a rejected option, and a kill criterion
When an agent amends the card to replace its body with one short sentence and keeps every fact
Then the command succeeds
And the card shows as decided with the new body text
And the log shows the amend as a reopen and a decide of the card

### 65.1

Ticket: werk/65

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

Ticket: werk/65

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

Ticket: werk/65

Scenario: Stale wins when a postponement and a rejection reach the same card
Given a map with decided cards A, B and C
And card C depends on card A
And card C also refines card B
When the user reopens card A with the reason postponed
And the user reopens card B with the reason rejected
Then card C shows as stale, not as paused
And the stale list shows card C with card B as the cause and the reason rejected

### 65.4

Ticket: werk/65

Scenario: Rederive clears the mark on one card and leaves the others
Given a decided card A with two direct dependents, cards B and C
And the user reopened card A with the reason rejected
And the stale list shows both card B and card C as stale
When the user rederives card B and confirms it
Then the stale list no longer shows card B
And the stale list still shows card C as stale, with card A as the cause and the reason rejected
And card B shows no stale mark on the map

### 65.5

Ticket: werk/65

Scenario: Deciding a postponed card again clears the paused marks downstream
Given a card B that depends on card A, and a card C that depends on card B
And the user reopened card A with the reason postponed
And cards B and C show the paused mark
When the user decides card A again
Then cards B and C no longer show the paused mark
And the stale list shows neither card B nor card C
And card C still shows the status it had before the reopen