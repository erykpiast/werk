## Steps

### 01.1

Scenario: The agent runs the unit tests and then the coverage gate
Given the werk repository with its first pure helper and that helper's own test file
When the agent runs `make test`
Then the unit tests pass
And the run reports its results without a coverage check
When the agent runs `make test-coverage`
Then the output shows one line for each file on the pure-file list with its line percentage
And the coverage command passes
When the agent deletes the own test file of a file on the pure-file list
And the agent runs `make test-coverage` again
Then the output shows 0% for that file
And the coverage command fails and names the missing test file
But `make test` still passes without a coverage failure

### 04.1

Scenario: An agent's new card waits as a ghost until the person accepts it
Given a map with a real card "Checkout flow"
When an agent adds a card "Retry payment" under "Checkout flow"
Then the add output says "proposed" and not "added"
And the log has exactly one new event, a proposed event that names "Checkout flow" as the parent
And showing "Retry payment" prints it as a ghost with "Checkout flow" as its parent
When the agent runs `werk accept` on "Retry payment" with `--actor you`
Then the log has one new accept event
And showing "Retry payment" prints it as a real card under "Checkout flow"
And every other ghost in the map is still a ghost

### 04.2

Scenario: Accepting a ghost child also accepts its ghost parent, and its held link goes live with no further event
Given a map with a real card "Payments" and a real card "Fraud rules"
And an agent proposes a card "Refunds" under "Payments"
And the agent proposes a card "Partial refunds" under "Refunds"
And the agent links "Partial refunds" so that it depends on "Fraud rules", with a reason
And the agent proposes an option and a source that "Partial refunds" is supported by
Then showing "Partial refunds" prints the depends-on link as held, not live
When the agent runs `werk accept` on "Partial refunds" with `--actor you`
Then the log has accept events and no separate event for the link
And showing "Refunds" and "Partial refunds" prints both as real cards
And the option and the source of "Partial refunds" show as real
And showing "Partial refunds" prints the depends-on link to "Fraud rules" as live

### 04.3

Scenario: Discarding a ghost parent drops its ghost children
Given a map with a real card "Onboarding"
And an agent proposes a card "Email verification" under "Onboarding"
And the agent proposes a card "Resend email" under "Email verification"
When the agent discards "Email verification"
Then showing "Email verification" and showing "Resend email" both report that the card is not in the map
And showing "Onboarding" lists no ghost child

### 04.4

Scenario: The words of a ghost are frozen
Given a map with a real card "Search"
And an agent proposes a card "Search index" under "Search" with a title and a why
When the agent adds a card with the same id "Search index" again with different words
Then the add refuses and names the rule that ghost words are frozen
And the log has no new event
And showing "Search index" prints its first title and why

### 04.5

Scenario: An accept from the command line needs the statement that the person asked for it
Given an agent proposes a card "Audit log" under a real card
When the agent runs the accept command for "Audit log" without `--actor you`
Then the command exits with a failure
And the log has no new event
And showing "Audit log" still prints it as a ghost
When the accept command for "Audit log" is run with `--actor you`
Then the command succeeds
And showing "Audit log" prints it as a real card

### 06.1

Scenario: A new excerpt for a card stages as a ghost and waits for the ✓
Given a decided card on the map
When an agent adds an excerpt that supports that card
Then the command output says "proposed", not "added"
And the map shows the new excerpt as a ghost, waiting for the ✓
And the link from the card to the excerpt shows as pending
And the card keeps its status and its words until the ✓ is given

### 06.2

Scenario: An accepted excerpt stops being a ghost and its link goes live
Given an agent added an excerpt for a card, and the excerpt shows as a ghost
When the person gives the excerpt the ✓
Then the excerpt is no longer a ghost
And the person opens the card view and sees the excerpt under the card as supporting evidence
And the link from the card to the excerpt is live without a second accept

### 08.1

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

Scenario: Removing with reparent moves the children up, and a restore puts them back
Given a map where card "platform" refines into "auth", and "auth" refines into "login" and "session"
When the person runs `werk remove auth --actor you --reparent`
Then "auth" no longer shows in the map
And "login" and "session" show directly under "platform"
When the person runs `werk restore auth --actor you`
Then "auth" shows under "platform" again
And "login" and "session" show under "auth" and not directly under "platform"

### 08.3

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

Scenario: A removed card's id stays taken, and a cited source stays
Given a map where cards "login" and "billing" both cite the source "rfc-6749"
When the person removes "login" with `--actor you`
Then the source "rfc-6749" still shows in the map, cited by "billing"
When the person tries to add a new card with the id "login"
Then the add is refused
And the refusal message names the restore of "login"
And no new proposal for "login" appears in the map

### 08.5

Scenario: Remove and restore refuse without the person's say-so
Given a map with a card "login"
When the agent runs `werk remove login` without `--actor you`
Then the command refuses
And "login" still shows in the map
And the log has no new event

### 08.6

Scenario: When the agent runs `werk restore login` without `--actor you`
Given the person has removed "login" with `--actor you`
When the agent runs `werk restore login` without `--actor you`
Then the command refuses
And "login" still does not show in the map
And the log has no new event

### 09.1

Scenario: An agent lists the index of decided cards
Given a map with three decided cards, one open card, and one ghost card that was decided before it became a ghost
When the agent runs `werk search` with no term
Then the agent sees one line for each of the three decided cards, with the card id and title
And the agent does not see the open card
And the agent does not see the ghost card

### 09.2

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

Scenario: A card reopened as rejected comes back as work in every tree
Given a map with two separate trees, each with one open card
And a decided card "Auth flow" that a person then reopened as rejected
When the agent runs `werk find` with no id
Then the agent sees the open card from each tree
And the agent sees "Auth flow"
And the agent sees no decided card

### 10.1

Scenario: An agent's note appears on the card's thread in the map
Given a map with a decided card "#auth-login" titled "Login uses magic links"
When the agent runs `werk say auth-login "Should expired links show a retry button?"`
And the person opens the map and selects the card "Login uses magic links"
Then the card's thread shows the note "Should expired links show a retry button?"
And the note shows that the agent wrote it

### 10.2

Scenario: The agent reads the person's notes in the inbox, starting after a log position and capped by count
Given a map with a card "#auth-login"
And the person types the notes "first", "second", "third" and "fourth" on that card's thread in the map, in that order
When the agent runs `werk inbox`
Then the agent sees the four notes in the order the person typed them
And each note shows its card id and its log position
When the agent runs `werk inbox --since <the log position of "first">`
Then the agent sees "second", "third" and "fourth", and does not see "first"
When the agent runs `werk inbox --since <the log position of "first"> -n 2`
Then the agent sees only "second" and "third"

### 10.3

Scenario: A corrected ghost keeps its earlier notes, with one marker where the new words begin
Given the agent proposes a new card "#auth-retry" with the words "Retry sends a new link"
And the person sees a ghost card "#auth-retry" in the map
And the person types the note "No — retry must reuse the same link" on the ghost's thread
And the agent runs `werk say auth-retry "Understood, I will correct it"`
When the agent discards the ghost "#auth-retry"
And the agent proposes "#auth-retry" again with the words "Retry reuses the same link"
And the person opens the thread of the ghost "#auth-retry"
Then the thread shows "No — retry must reuse the same link" and "Understood, I will correct it"
And below those notes the thread shows exactly one "proposed again" marker
And the ghost shows the words "Retry reuses the same link"
When the person types the note "Good, accept" on the thread
Then the note "Good, accept" appears below the "proposed again" marker

### 10.4

Scenario: A note on a discarded ghost stays in the inbox and on the thread
Given the agent proposes a new card "#cache-ttl" and the person types the note "Why 60 seconds?" on its thread
When the agent discards the ghost "#cache-ttl" and does not propose it again
And the agent runs `werk inbox`
Then the agent still sees the note "Why 60 seconds?" for "#cache-ttl"
And when the agent proposes "#cache-ttl" again, its thread in the map shows "Why 60 seconds?" above one "proposed again" marker

### 10.5

Scenario: An agent writes a note on an excerpt
Given a map with a source and an excerpt "#src-rfc-quote" taken from it
When the agent runs `werk say src-rfc-quote "This quote supports the retry decision"`
Then the command succeeds
And the person opens the excerpt "#src-rfc-quote" in the map and sees the note "This quote supports the retry decision" on its thread

### 11.1

Scenario: The rollup counts the card and its whole refines subtree
Given a map with a root card that has two refining child cards
And one child card has one refining grandchild card
And the root card is decided, one child is open, the other child is a prototype, and the grandchild is decided
When the user prints the root card with werk show and its id
Then the user sees one rollup line for the root card that counts 4 cards
And the rollup line shows 1 open, 1 proto and 2 decided
And the open, proto and decided counts add up to the card count

### 11.2

Scenario: Each incoming refines link shows the child's own rollup
Given a map with a parent card refined by a child card
And the child card is refined by two grandchild cards, one open and one decided
When the user prints the parent card with werk show and its id
Then the user sees the incoming refines link to the child card
And that link shows a rollup that counts 3 cards, not the parent's count
And the parent card's own rollup line counts 4 cards

### 11.3

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

Scenario: A card with no options prints no Options section
Given a card that has an excerpt and a source but no options
When the user prints the card with werk show and its id
Then the user sees the Say section and the Ev section
But the user sees no Options section

### 11.5

Scenario: Show with no id prints the root card
Given a map with a root card that a second card refines
When the user runs werk show with no id
Then the user sees the root card's title and its rollup line
And the user sees the incoming refines link from the second card with that card's rollup

### 12.1

Scenario: A unique quote becomes an excerpt ghost linked from the citing card
Given a conversation whose chat log holds a tool result line, then a message from the person, then a message from the agent
And the agent's message says "we keep one log per conversation and never rewrite it"
And the map holds a ghost card that cites that conversation
When the agent runs `werk quote` with that card, that conversation, and the text "one log per conversation"
Then the command succeeds
And the map shows one new excerpt ghost held by the citing card through a supported_by link
And the excerpt shows the quoted words "one log per conversation", the agent as speaker, the message time, and the session id
And the excerpt's message position is 3, because the hidden tool result line counts
And the excerpt's span starts and ends at the place of "one log per conversation" inside that message
And the decision log grew by one event that holds both the excerpt and its link

### 12.2

Scenario: A quote that is not unique fails, says which case it found, and writes nothing
Given a conversation where the person says "ship the reader first" and later the agent also says "ship the reader first"
And a second message from the person says "retry, then retry again"
And the map holds a ghost card that cites that conversation
When the agent quotes "ship the reader first" from that conversation for the card
Then the command fails and says the text matches in 2 messages
When the agent quotes "retry" from that conversation for the card
Then the command fails and says the text has 2 matches in one message
When the agent quotes "a sentence nobody said" from that conversation for the card
Then the command fails and says there is no match
And the map shows no excerpt and no new link
And the decision log holds no new event

### 12.3

Scenario: Text that appears only in tool output is never quotable
Given a conversation where a tool result says "exit code 137 from the runner"
And a tool call and a tooling note in the same log also contain "exit code 137"
And no spoken message contains "exit code 137"
And the map holds a ghost card that cites that conversation
When the agent quotes "exit code 137" from that conversation for the card
Then the command fails and says there is no match
And the map shows no new excerpt

### 12.4

Scenario: An excerpt's words cannot be written or changed by hand
Given a citing card that holds an excerpt made with `werk quote`
When the agent tries a plain add of a new excerpt node with its own words
Then the command is refused and the map does not change
When the agent tries to retitle the excerpt or edit its text
Then each command is refused and the excerpt keeps its quoted words
When the agent adds a note to the excerpt
Then the note is saved on the excerpt
When the person accepts the citing card
And the agent tries again to edit the excerpt's text
Then the command is refused and the excerpt keeps its quoted words

### 12.5

Scenario: The excerpt follows the fate of its citing card
Given two ghost cards, each holding one excerpt made with `werk quote` from the same conversation
When the person discards the first card
Then the first card and its excerpt are both gone from the map
When the person accepts the second card
Then the second card and its excerpt both show as accepted
And the excerpt still shows its quoted words, speaker, time, session, message position, and span

### 13.1

Scenario: A second server on the same store refuses while the first one runs
Given a project with a map of three cards
And a person starts werk serve in the project
When the person starts werk serve again in the same project at the same moment
Then exactly one server runs and serves the map page
And the other start waits, then stops with a message that names the running server's process id and port
And the page from the running server still shows all three cards

### 13.2

Scenario: A new server starts after a killed server left its lock behind
Given a project with a map of two cards
And a person started werk serve in the project
And the server process was killed without a clean exit
When the person starts werk serve in the project again
Then the server starts without a wait for the old server
And the person opens the page and sees both cards

### 13.3

Scenario: A page stays in step when a card is added on the command line
Given a person runs werk serve in a project with a map of one card
And the person has the map page open in two browser tabs
When the person adds a second card with the werk command line
Then each tab receives one changed signal that carries no card data
And each tab reads the map again and shows both cards without a manual reload

### 13.4

Scenario: A card added while the server was down shows on the first page load
Given a project with a map of one card and no server running
When the person adds a second card with the werk command line
And the person starts werk serve and opens the map page
Then the page shows both cards
And the person opens the second card and sees its body, its why, its status and the titles of its neighbours
But the map overview does not show any card body text until the person opens a card

### 13.5

Scenario: Only the person's own page can write to the map
Given a person runs werk serve in a project with a map of one card
And the person opens the map page from the server
When the person accepts a change from the page
Then the server accepts the write and the page shows the new state of the map
But a write sent without the token from the page is refused and the map does not change
And a write sent with a Host that is not a loopback name is refused and the map does not change
And a read of the map sent without the token still returns the card

### 14.1

Scenario: A person moves between cards by address and sees a not-found page for an unknown card
Given a werk project with a root card "Root" and a child card "Child"
And the werk server runs for that project
When the person opens the address /map in the browser
Then the page shows the title "Root" in the left pane
And the right pane is kept for the chat
When the person opens the address /map/ followed by the id of "Child"
Then the page shows the title "Child"
When the person presses the browser Back button
Then the page shows the title "Root"
When the person presses the browser Forward button
Then the page shows the title "Child"
When the person opens the address /map/ followed by an id that no card has
Then the page says that the card is not found
And the page does not show the title "Root" or "Child"

### 14.2

Scenario: A card added from the command line appears on the open page without a reload
Given the werk server runs for a project with a root card "Root"
And the person has the page for "Root" open in the browser
And the person has typed "half a thought" in the chat composer
When the person adds a card "Fresh idea" under "Root" with the werk command line in a terminal
Then the open page shows "Fresh idea" in the map without the person doing anything
And the page did not reload
And the chat composer still holds "half a thought"

### 14.3

Scenario: A write made while the server was down shows after the page reconnects
Given the werk server runs for a project with a root card "Root"
And the person has the page for "Root" open in the browser
When the person stops the werk server
And the person adds a card "Written offline" under "Root" with the werk command line
And the person starts the werk server again on the same port
Then the open page reconnects without the person reloading it
And the page shows "Written offline" in the map

### 14.4

Scenario: In dev, a server edit changes a response and the live page stays connected
Given the person runs werk in dev mode on a copy of the app
And the person has a card page open in the browser
When the person edits a route handler in the server code of that app copy and saves the file
Then the server log says that it reuses the live server
And the same server process still runs on the same port
And the next request to that route returns the edited response
When the person adds a card "After edit" with the werk command line
Then the open page shows "After edit" without a reload, because its live channel did not drop

### 14.5

Scenario: In dev, a client edit that cannot apply in place reloads the page and keeps the draft
Given the person runs werk in dev mode on a copy of the app
And the person has the page for a card open in the browser
And the person has typed "draft that must survive" in the chat composer
When the person makes an edit in the client code of that app copy that cannot apply in place, and saves the file
Then the page reloads by itself
And the page shows the same card title as before the reload
And the chat composer holds "draft that must survive"

### 15.1

Scenario: Every form of a card reference in a card body becomes the same link to that card
Given the map has a card "al-diff" and a card "align"
And a card "notes-test" has the body "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too."
When the person opens the card "notes-test" in the map
Then the body shows four links that each read "#al-diff" in a monospace face
And the body shows one link that reads "#align"
And the plain word "then" and the word "and" stay ordinary text
When the person clicks the second "#al-diff" link
Then the browser address ends with "/map/al-diff"
And the card "al-diff" is open in the map

### 15.2

Scenario: Text that only looks like a reference stays text
Given the map has a card "al-diff"
And the map has no card "no-such-card"
And a card "guards" has a body with these lines: "--al-diff", "##al-diff", "&al-diff", "a code span holding `node src/cli.ts show #al-diff`", "see #no-such-card", "visit https://example.com/page#al-diff"
And the body has a heading line "# al-diff"
When the person opens the card "guards" in the map
Then the body shows "--al-diff", "##al-diff" and "&al-diff" as plain text with no link
And the command "node src/cli.ts show #al-diff" shows as code with no link inside it
And "#no-such-card" shows as written with no link
And the URL shows with no separate link to the card "al-diff"
And the heading "al-diff" shows as a heading with no link
But a card reference in the same body written as "#al-diff" on its own still links to "/map/al-diff"

### 15.3

Scenario: Fenced code in a card is boxed, labelled and highlighted by its tag
Given a card "code-sample" has a body with a code fence tagged "zsh" that holds "echo $HOME | grep -v x"
And the body has a code fence tagged "TypeScript" that holds "const n: number = 1"
And the body has a code fence tagged "cobol" that holds "DISPLAY 'HELLO'."
And the body has a code fence with no tag that holds a line longer than the screen is wide
When the person opens the card "code-sample" in the map
Then each fence shows in its own box
And the "zsh" box has a corner label "zsh" and shows the command with shell colours
And the "TypeScript" box shows the keyword "const" in a different colour from the name "n"
And the "cobol" box has a corner label "cobol" and shows its text in one plain colour
And the box with the long line scrolls sideways and the page does not get wider
And a reference such as "#al-diff" inside any fence stays plain code text

### 15.4

Scenario: Card text with a script tag shows the tag as text and runs nothing
Given a card "unsafe" has the body "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~"
When the person opens the card "unsafe" in the map
Then the body shows the text "<script>window.__pwned = true</script>" as visible characters
And no script from the card body runs in the page
And "bold" shows in bold and "gone" shows struck through

### 15.5

Scenario: References link in chat messages but not in a grid tile summary
Given the map has a card "al-diff" and a removed card "old-idea"
And a card "tile-card" has the summary "Depends on #al-diff"
When the person sends the chat message "Compare #al-diff with #old-idea and show code" in the pane
Then the person's message shows "#al-diff" as a link to "/map/al-diff"
And the message shows "#old-idea" as plain text with no link
When the agent's reply streams in with a code fence tagged "json" that is not yet closed
Then the reply shows the code so far inside a box labelled "json" while it streams
And after the reply finishes the box shows the complete code with JSON colours
When the person looks at the grid tile for the card "tile-card"
Then the tile shows the text "Depends on #al-diff" with no link inside the tile
And a click on the tile opens the card "tile-card"

### 17.1

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

### 17.4

Scenario: A person switches between the Map and Board tabs
Given the person has a card open in the map
And the Map tab is highlighted
When the person clicks the Board tab
Then the address is `/board`, the board shows, and the Board tab is highlighted
When the person reloads the page
Then the board still shows
When the person clicks the Map tab
Then the map shows the same card that was open before

### 17.5

Scenario: The first screen shows the requirements and the build rules side by side
Given a map with a #root card and a #how card, each with children
When the person opens werk at its home address
Then the page shows two equal columns
And the left column shows the title, the why, the counts, and the children of #root
And the right column shows the title, the why, the counts, and the children of #how
But when the map has no #how card, the right column shows an empty build-rules card

### 18.1

Scenario: Accepting a proposed new card with the check mark makes it real without a reload
Given a map with a decided card "Storage"
And an agent has proposed a new card "Use SQLite" that refines "Storage"
And the person has the map open in the browser
When the person looks at "Use SQLite"
Then it shows a blue border and a blue background with the badge "proposed"
And it shows a ✓ in its top-right actions
And it shows no discard button
When the person clicks the ✓ on "Use SQLite"
Then the map redraws without a page reload
And "Use SQLite" shows as a real card with no "proposed" badge and no blue border
And the event log records an accept of "Use SQLite" with the person as the actor
And the result is the same as when the person accepts the card from the command line

### 18.2

Scenario: A pending edit to a decided card shows as a diff and an accept amends the card
Given a decided card "Cache layer" with the body "Entries expire after five minutes."
And an agent has proposed an edit that changes the body to "Entries expire after ten minutes."
When the person opens the map in the browser
Then "Cache layer" shows a blue border and no blue background and no "proposed" badge
And the word "ten" shows with a blue highlight
And the word "five" shows with a blue highlight and a strikethrough
And no other word in the title, the why or the body is marked
When the person clicks the ✓ on "Cache layer"
Then the map redraws without a reload
And the body of "Cache layer" reads "Entries expire after ten minutes." with no marks

### 18.3

Scenario: One added item in a long list marks only that item
Given a decided card whose body has a list of ten items
And an agent has proposed an edit that adds one new item in the middle of that list
And the same edit changes a paragraph in the body into a list
When the person opens the map in the browser
Then the new item shows with a blue highlight
And the ten old items show with no marks
And the old paragraph shows as removed, with a highlight and a strikethrough
And the new list shows as added, with a highlight

### 18.4

Scenario: Removing a card with two children offers subtree removal or reparent, each with its count
Given a decided card "Auth" that refines the card "Server"
And "Auth" has two child cards, "Tokens" and "Sessions"
And the person has the map open in the browser
When the person clicks the ✕ on "Auth"
Then the page asks one question with three answers
And one answer removes the subtree and names that 3 cards leave
And one answer removes "Auth", moves its children to "Server", and names that 1 card leaves
And one answer cancels
When the person picks the answer that moves the children to "Server"
Then the map redraws without a reload
And "Auth" is gone from the map
And "Tokens" and "Sessions" show under "Server"
And the event log records the removal as a new event
When the person restores "Auth" from the command line
Then "Auth" shows again on the map exactly as it was before the removal

### 18.5

Scenario: A proposed removal shows in red, cancel changes nothing, and a write without the token is refused
Given a map with a decided card "Legacy importer" that has no children
And an agent has proposed to remove "Legacy importer"
When the person opens the map in the browser
Then "Legacy importer" is drawn in red
When the person clicks the ✕ on a different card "Old notes" and picks cancel
Then "Old notes" stays on the map
And the event log has no new event
When another page sends a write request to the werk server without the page's token
Then the server refuses the request
And the event log has no new event
And the map in the person's browser does not change

### 19.1

Scenario: A build pass in another project starts with the werk instructions, its subagents and the build-rule titles
Given a project that is not werk's own checkout, with its own map
And the map has a build-rules card with three child cards
When the person starts a build pass on a ticket in that project
And the person opens the prompt that the build pass started with
Then the prompt begins with the build agent's own instructions, unchanged
And the werk agent instructions follow them
And the instructions name werk's command line by the folder that werk runs from
And no card id from werk's own map appears in the instructions
And the titles of the three build-rule cards follow the instructions
And the build pass has the module-classifying subagent and the fork-options subagent, each naming werk's folder

### 19.2

Scenario: A chat agent gets the instructions, but a sample agent does not
Given a project with a map that has build-rule cards
When the person sends a chat message and the chat agent answers
And the person samples options for an open card
Then the prompt of the chat agent holds the werk agent instructions and the build-rule titles
But the prompt of the sample agent holds no werk agent instructions
And the prompt of the sample agent holds no list of build-rule titles

### 19.3

Scenario: A project with no build rules gets no title list
Given a project whose map has a build-rules card with no child cards
When the person starts a build pass on a ticket
Then the prompt of the build pass holds the werk agent instructions
But the prompt holds no list of build-rule titles

### 19.4

Scenario: In werk's own checkout the instructions appear one time
Given werk's own checkout, whose AGENTS.md includes the werk agent instructions
When the person starts a build pass on a ticket in that checkout
And the person opens the prompt that the build pass started with
Then the werk agent instructions appear in the prompt one time only
And the titles of the build-rule cards appear after them

### 19.5

Scenario: The repository check catches a subagent copy that replaces its link
Given werk's own checkout, where the Claude Code subagent folder links to every subagent that werk ships
And the repository checks pass
When the person replaces the link to the module-classifying subagent with a plain copy of the same file
And the person runs the repository checks
Then the checks fail and name the module-classifying subagent
When the person puts the link back
And the person runs the repository checks again
Then the checks pass

### 20.1

Scenario: A message on the open card streams a reply and the map shows the card the agent writes
Given the person has werk open with a scripted chat agent
And the person has the card "Checkout retries" open
When the person types "Make it three tries" in the chat and presses Enter
Then the message shows in the chat at once
And the reply text appears under that message part by part while the agent works
And the header row above the composer shows what the agent is doing, with seconds and tokens
And the reply renders as Markdown, and a card id in the reply is a link that opens that card
When the scripted agent writes the card "Checkout retries" so that it says three tries
Then the map redraws before the reply ends, and the card says three tries
And when the reply ends, the header row stops showing activity and the full reply stays under the message

### 20.2

Scenario: A second message sent during a reply waits, and the first reply finishes above it
Given the person has werk open with a scripted chat agent that replies slowly
And the person sent "First question" and its reply is streaming
When the person types "Second question" and presses Enter
Then "Second question" shows in the chat at once with the mark "waits for the reply above"
And the rest of the reply to "First question" keeps appearing under "First question", above "Second question"
When the reply to "First question" ends
Then the waiting mark goes away from "Second question"
And the reply to "Second question" appears under "Second question"

### 20.3

Scenario: Each turn names the card the person has open
Given the person has werk open with a scripted chat agent that repeats the card context it receives
And the person opens the card "Checkout retries"
When the person sends "What does this say?"
Then the reply shows the full text of "Checkout retries"
When the person sends "And now?" without opening another card
Then the reply shows only the one-line reminder "still on #… — Checkout retries"
When the person goes to the whole tree view and sends "Where am I?"
Then the reply names the home card

### 20.4

Scenario: A run of tool calls collapses into one line
Given the person has werk open with a scripted chat agent that makes three tool calls in a row before it answers
When the person sends "Look at the code"
Then the chat shows one collapsed line for the three calls, with the latest call and the count 3
And the answer text shows under that line
When the person opens the collapsed line
Then the chat shows each of the three calls with its input and its output

### 20.5

Scenario: A chat request without the token starts no agent
Given werk is running with a scripted chat agent
And the map holds the card "Checkout retries", which says two tries
When a page on another site sends the chat message "Make it three tries" to the werk server without the token
Then the server refuses the request
And no agent starts and no reply appears in the chat
And the card "Checkout retries" still says two tries

### 26.1

Scenario: A person checks a folder of valid hand-written tickets and gets a clean pass
Given a map with a root card that has two decided cards refining it
And a spec whose User stories section lists stories 1 and 2
And a folder with two tickets in the fixed format: titles, cites, blocked_by, stories and touches lines, then What to build, Acceptance criteria and Checks sections
And the first ticket cites the root and one decided card, delivers story 1, and lists `make test` under Checks
And the second ticket cites the other decided card with a hash sign, delivers story 2, is blocked by ticket 1, and has an empty Checks section
When the person runs `werk ticket-check` on the folder with that root and that spec
Then the output shows no failure line
And the output ends with a count line that reports zero failures
And the command exits with code 0

### 26.2

Scenario: An agent finds a file path and an oversized ticket, each named with its ticket and place
Given a map, a spec and a folder of tickets that pass every check
When the agent edits one ticket so that line 9 of its What to build section names `src/loop.ts`
And the agent edits the same ticket so that it also names the bare file name `Makefile`
And the agent pads a second ticket until the file holds more than 4000 characters
And the agent runs `werk ticket-check` on the folder with the same root and spec
Then the output shows a line that starts with the first ticket's file name, names the no-file-paths check, and lists `src/loop.ts` with line 9
But no failure line names `Makefile`
And the output shows a line that starts with the second ticket's file name and names the size check
And the count line reports the failures
And the command exits with code 1

### 26.3

Scenario: The set checks report an uncited card, a missing story and a blocker cycle, but not a ghost
Given a map with a root card, two decided cards under it, and one ghost card under it
And a spec whose User stories section lists stories 1, 2 and 3
And a folder of three tickets that each pass their own checks
And no ticket cites the second decided card or the ghost card
And no ticket lists story 3
And ticket 2 is blocked by ticket 3, and ticket 3 is blocked by ticket 2
When the person runs `werk ticket-check` on the folder with that root and spec
Then the output shows one `ticket set` line for the cards-cited check that names the second decided card
And the output shows one `ticket set` line for the stories check that names story 3
And the output shows a blocked_by failure that names the tickets on the cycle
And no line names the ghost card
And the command exits with code 1

### 26.4

Scenario: A ticket with no title fails alone, and its cites do not count for the set
Given a map with a root card and one decided card under it
And a spec with one story
And a folder with one ticket that has no title line but cites the decided card and delivers the story
When the person runs `werk ticket-check` on the folder with that root and spec
Then the output shows a line for that ticket file that names the title check
And the output shows no shape, size or other own-check line for that ticket
And the output shows a `ticket set` line that names the decided card as uncited
And the output shows a `ticket set` line that names the story as not delivered
And the command exits with code 1

### 26.5

Scenario: A malformed call never reads as a pass
Given a map with a root card and a folder of valid tickets
When the person runs `werk ticket-check` on the folder with that root and a spec file that does not exist
Then the output says that the spec file is missing
And the command exits with code 2
When the person runs it again with a spec file that has no User stories heading
Then the command exits with code 2
When the person runs it again with a root card id that is not in the map
Then the command exits with code 2
When the person runs it again with no `--root`
Then the command exits with code 2

### 27.1

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

Scenario: A move without a reason is refused
Given a project whose board has a planned ticket "auth/01" in the ready column
When the person runs `werk ticket move auth/01 blocked` with no reason
Then the command fails with a message that asks for a reason
And `werk ticket list` still shows "auth/01" in the ready column
And the board log has no new event

### 27.3

Scenario: Restoring a ticket that is not archived changes nothing
Given a project whose board has a ticket "auth/02" in the ready column that was never archived
When the person runs `werk ticket restore 02`
Then the command exits with status 1
And the board log is byte-for-byte the same as before
When the person runs `werk ticket restore 99`, a number that is not on the board
Then the command exits with status 1
And the board log is byte-for-byte the same as before

### 27.4

Scenario: A done ticket cannot be archived
Given a project whose board has a ticket "auth/03" in the done column
When the person runs `werk ticket archive auth/03`
Then the command fails with a message that a done ticket cannot be archived
And `werk ticket list` still shows "auth/03" in the done column and not archived
And the board log has no new event

### 27.5

Scenario: The board listing shows every ticket in the column its events lead to
Given a project whose board log holds planned events for "auth/01", "auth/02" and "auth/03"
When the person moves "auth/02" to blocked with a reason
And the person archives "auth/03"
And the person runs `werk ticket list`
Then the listing shows "auth/01" in ready, "auth/02" in blocked with its reason, and "auth/03" as archived
And every event in the board log names the actor that wrote it

### 28.1

Scenario: A plan over a decided subtree writes a spec, puts tickets on the board, and proposes the writers' answers as ghosts
Given a project with a target repository set by the person
And a decided subtree "checkout" whose cards are all decided
And a spec writer that writes a spec and one new answer with the slug "retry-limit"
And a ticket writer that writes two valid tickets and one new answer with the slug "ticket-order"
When the person runs `werk plan checkout`
Then the command exits with success
And the spec for "checkout" is in werk's store
And the board shows the tickets "checkout/01" and "checkout/02", each in ready or blocked
And the map shows the ghost cards "checkout-retry-limit" and "checkout-ticket-order" under the card "checkout"
And each ghost shows the agent as the one who decides
And the board log shows the plan start, a spec step and a ticket step each with its agent log, and the plan end

### 28.2

Scenario: An open card in the subtree stops the plan before any writer runs
Given a project with a target repository set by the person
And a subtree "checkout" with one child card that is still open
When the person runs `werk plan checkout`
Then the command exits with an error that names the open card
And no spec writer and no ticket writer starts
And the board shows no new ticket for "checkout"

### 28.3

Scenario: The writers see the decided cards the subtree rests on, but not the cards beside them
Given a project with a target repository set by the person
And a decided subtree "checkout" whose card depends on the decided card "payments-api"
And the decided card "payments-api" depends on the decided card "auth-token"
And the decided card "auth-token" has a decided sibling "auth-sso" under the same parent
When the person runs `werk plan checkout`
Then the spec writer's prompt shows "checkout" and "payments-api" in the first part of the scope
And the spec writer's prompt shows "auth-token" in the second part of the scope
And neither writer's prompt shows "auth-sso" or the parent of "auth-token"
And each writer starts with its own role

### 28.4

Scenario: A writer answer whose card id is already taken fails the plan, and a bad ticket stays off the board
Given a project with a target repository set by the person
And a decided subtree "checkout" that already has a card "checkout-retry-limit"
And a spec writer that writes a spec and one new answer with the slug "retry-limit"
And a ticket writer that writes one valid ticket and one ticket with no acceptance criteria
When the person runs `werk plan checkout`
Then the command exits with an error that names the id "checkout-retry-limit"
And the map shows no second card "checkout-retry-limit"
And the board shows the valid ticket in ready or blocked
But the board does not show the ticket with no acceptance criteria

### 28.5

Scenario: A project with no target cannot plan until the person sets a valid target
Given a project with no target repository
And a decided subtree "checkout"
When the person runs `werk plan checkout`
Then the command exits with code 1 and tells the person to set a target with `werk target`
When the person runs `werk target` with a path to a plain file
Then the command refuses the path and the project still has no target
When the person runs `werk target` with a path to a directory that is a repository with a main line
And the person runs `werk target` with no path
Then the command prints that directory as the target

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

### 73.1

Scenario: A message sent from the open card streams its reply back into the pane
Given the map is open in the browser with the chat pane beside it
And the person has opened the card "#werk-chat" from the map
And the conversation tab "design" is the active tab
And the fake agent has a scripted reply of three parts that names the card "#werk-wording" and has a bold word
When the person types "What does this card decide?" in the composer
And the person presses Enter
Then the server receives one request with the text "What does this card decide?", the card "#werk-chat" and the tab "design"
And the composer is empty
And the first part of the reply appears in the pane before the last part arrives
And the full reply shows in the pane with the bold word in bold
And "#werk-wording" in the reply shows as a card link, the same as a card link in a card body
When the person clicks the "#werk-wording" link in the reply
Then the map opens the card "#werk-wording"

### 73.2

Scenario: A pasted image travels with the message in the same request
Given the map is open in the browser with the chat pane beside it
And the person has opened the card "#visual"
When the person pastes an image into the composer
And the person types "Does this layout match the card?"
And the person presses Enter
Then the server receives one request only
And that request carries the text, the pasted image, the card "#visual" and the active tab
And the fake agent's scripted reply streams into the pane

### 73.3

Scenario: Each turn starts with the card the person looks at now
Given the map is open in the browser with the chat pane beside it
And the person has opened the card "#pr-log"
When the person sends "Explain the fold" from the composer
Then the fake agent records that its turn input starts with "#pr-log"
When the person opens the card "#vi-prop-trace" from the map
And the person sends "And this one?" from the composer in the same tab
Then the fake agent records that this second turn input starts with "#vi-prop-trace"
And the second turn does not start with "#pr-log"
And both replies show in the pane in the order the person sent the messages

### 73.4

Scenario: Each conversation tab speaks to its own agent
Given the map is open in the browser with two conversation tabs, "alpha" and "beta"
And the person has opened the card "#werk-cli"
When the person makes "alpha" the active tab and sends "First question"
And the person makes "beta" the active tab and sends "Second question"
Then the fake agent of "alpha" records only the turn "First question"
And the fake agent of "beta" records only the turn "Second question"
And the reply to "Second question" shows in the "beta" tab and not in the "alpha" tab
And the fake agent of each tab records a prompt that says a card describes its subject and not the session
And that prompt says a card names no file, function or line

### 73.5

Scenario: A note sent to the note route appears in the card's thread
Given the server runs with the map that has the card "#werk-chat" titled "The composer sends a live agent turn"
And the person has not typed anything in the composer
When a client outside the browser sends the note "check the stdin path" for "#werk-chat" to the note route
Then the log holds exactly one new note event, and it names "#werk-chat"
And the clipboard holds the line `re #werk-chat "The composer sends a live agent turn": check the stdin path`
When the person opens the card "#werk-chat" in the map
Then the card's thread shows the note "check the stdin path" one time
And the browser sent no request to the note route