# werk — how to work with the decision map

This project keeps its decisions in a werk map: cards folded from an append-only log. These
instructions hold in any project werk works on. `{{werk}}` is the werk command line. Every
command below runs it on this project's map. `{{werk}} help` prints every verb with its flags.

## Keep the map current, every turn

When the conversation settles something, write it to the map **in the same turn**:

```bash
{{werk}} add <id> --title "..." --why "..." --body "..." --parent <id> --who <who>
{{werk}} link <from> <to> --type depends_on --why "what <from> takes from <to>"
{{werk}} status <id> decided
```

Do not save the writes for later. The map is the record of what the conversation settled. The
transcript is not.

## A card you add is a proposal. Only the person accepts it

An add does not put anything in the map. Every kind of node — card, option, source — enters
the log as a ghost: drawn dashed and grey, counted in no rollup, with every link of its own
held until it goes real. The person accepts it in the map.

1. **Write the whole card in the add.** A ghost is frozen. Its words cannot be edited, and a
   second add with the same id fails. To correct a ghost, discard it and add it again with the
   new words.
2. **A link, a status and a note still work on a ghost.** A link on a ghost is held and drawn.
   The move to decided checks the held links too. So build the card as usual — add, link,
   options, decided — and it goes real as one unit.
3. **Never accept a card yourself.** The accept needs `--actor you`, and that flag is a claim
   that the person asked for the accept. At the end of the turn, say which cards wait for the
   person.

An accept of a card also accepts its ghost parents, its ghost options and its ghost sources. It
never accepts a card that the card depends on: that card has its own words.

## Removing a card is the person's call

A removal takes a card and its subtree out of the map. Nothing leaves the log, and a restore
puts the card back. If a card should go, say which one and why, and let the person remove it.
The exception is a ghost that you proposed and the person has not accepted: discard it freely.

## Record depends_on when you create a card

If a card is true only because another card is true, link it to that card with depends_on in
the same turn. Nobody can rebuild these links later. Without them, a change to a card cannot
mark the cards that rely on it, and the map rots.

`refines` is where a card **sits** in the tree. `depends_on` is what a card **needs**. They are
two different graphs over the same cards. A depends_on link never points at the card's own
parent, ancestor or descendant.

Once a card depends on another, do not copy the other card's content into its body. Write
"see #<id>" and state only what is new in this card. A copy is a second source of truth: when
the other card changes, the mark lands on the link, not on the copied words.

## Record a rejected option the moment you weigh it

When a decision comes from a real contrast — you named an alternative, gave a reason and
rejected it — add the alternative as an option node, in the same turn:

```bash
{{werk}} add <id>:opt0 --kind option --title "..." --why_not "..."
{{werk}} link <id>:opt0 <id> --type alternative_to
```

Without the option, the card later reads as if nobody weighed an alternative at all.

## After you create a card, read it back

A change marks only the next hop: its direct dependents and its direct children. A link made
after the change carries no mark from it, so a new card is not stale because of an earlier
reopen. A new card can still depend on a card that is stale now. Then the new card waits; it is
not stale. Say so in the same turn: name the stale card, and say that the new card was written
with that correction in hand.

Run `{{werk}} show <id>` on each card you create, and on each card it depends on. Do not leave a
mark unexplained.

## Write a card about its subject, at the level of the decision

Someone reads a card later, cold, and needs to act on its subject. Check every title, why,
body and why-not against these rules before you write it. No program checks them.

1. **No session story.** Do not write who said what, what came before, or what stage the
   conversation is at. Delete "the person said", "as discussed", "for now, until we...". Who
   decides goes in the who field.
2. **No edit history.** Do not write "X is new", "Y used to say Z", "moved here from #x". State
   the current fact. The log records the change.
3. **A reversal is a fact about the subject.** A replaced card may say what replaced it and why
   the earlier reading was wrong, as a fact, not as a story.
4. **No code names.** Do not name source files, functions, classes, constants, line numbers or
   internal endpoints. Name behaviour and concepts. The code points at the card, not the other
   way round.
5. **No command forms outside the command-line cards.** The form of a command — its verb, flags
   and output — lives on one card per command. Every other card names the operation, such as
   "a reopen" or "the merge", not the command.
6. **Rules, not one module's results.** A module's behaviour list, coverage threshold or test
   plan goes into that module's tests. A card about one module is fair only when the module
   raises a design question that the general rule cannot answer.
7. **No list of child cards.** The refines links already hold the children. State the card's
   own higher-level fact, and name a child in parentheses after the sentence it expands.

```
# WRONG
title: "The person wants the export moved into exportOrders() for now"
body:  "This used to be part of #orders. We split it out after the review."

# CORRECT
title: "Export is its own command"
body:  "The export writes every order as one file. See #order-format for what an order holds."
```

## Make a card easy to read cold

A card reads in three layers. The title says what the card is about. The why gives most of the
understanding, so a reader can stop there. The body holds the details for the reader who must
act.

1. **Title: one plain sentence about this card's own rule.** A subject and a verb. No "now". No
   count that a later change can make wrong, unless the title names every member. Do not name
   another decision.
2. **Why: most of the understanding in two or three sentences.** Give the reason as plain
   causal steps. No card ids, no commands. Do not repeat the body.
3. **Body: the decision, not the process.** State the problem, then the answer: "To avoid X,
   the map does Y". A decided card records the answer, not the question.
4. **Every term is plain English or defined.** A term that this card adds gets a plain
   definition where it first appears. Do not coin phrases.
5. **The card reads on its own.** It does not need a past state of the product, a removed card
   or the conversation. Evidence goes on a source node, with enough context to read months
   later.
6. **A card about a mechanism shows one worked example and a picture.** List the named things
   with plain titles, then numbered steps with one action and its result each, including the
   case where nothing happens. Then draw an ASCII picture with the same names, and label every
   number and symbol.
7. **A card about a reusable product holds for every project that uses it.** It names no
   internals of the one project where the product was first built.

When the person asks what a phrase on a card means, answer in plain words in the chat, then fix
the card in the same turn. For a ghost, discard it and add it again. For a decided card, stage
the change as a proposal.

## Tag who decides

- `--who you`: the person has a basis to decide. Ask them, and attach a small concrete preview
  to the question.
- `--who me`: the choice is reversible. Decide it, say so, and do not ask.
- `--who prototype`: nobody can know by talking. Build it first, then decide.

## Build options only when prose cannot show the difference

When the difference between the options of a fork can only be judged by looking at a built
result, hand the fork to the `prototyper` subagent. It builds one artifact per option, or
answers that the fork needs no build. Write the option cards yourself from what it reports.

## Classify a module before you decide its tests

Pure code gets a coverage number. I/O code gets a list of named behaviours. Never set one
percentage over a whole project.

To classify a module, ask one question: does a wrong line fail loudly — throw, hang, crash — or
does it quietly give a result that looks correct? A quiet wrong answer means the module is
pure. A loud failure means it is I/O: it holds something live, such as a child process, a
socket, an open file or a network call.

- A pure module gets the project's line-coverage threshold. A test of it is cheap, and a bug in
  it never shows itself.
- An I/O module gets a list of named behaviours and no percentage. Write each behaviour as a
  responsibility, not as a location: "a crash never loses the message in flight" stays true
  after a rewrite.

Before you write the tests of a module that has no test policy yet, hand its paths to the
`test-scope` subagent. Write what it reports into the module's own tests, not onto the map. If
the project has no coverage threshold yet, propose one card that says the threshold needs
deciding once for the whole project; do not pick a number yourself. Propose a card only for a
real design question that `test-scope` could not settle, with at least two contrasting options.

## Do not edit the product diagram

If the project has a product diagram, werk keeps it in step with the decided cards by itself.
Do not read or edit its file, and do not start the agents that redraw it.

## Notes on a card

The person writes notes on a card's thread in the map. Run `{{werk}} inbox` to read them. Answer
on the card with `{{werk}} say <id> "..."`, so the answer lands on the card, not only in the
chat.

## In a chat reply, name the map operation

The person acts in the map, not in a terminal. In a chat reply, name the map operation and its
card, not the command line that runs it: write "Next: accept #checkout-retry", not the command.
You still run the full command yourself. Write a full command line only when the person must
run it in a terminal.
