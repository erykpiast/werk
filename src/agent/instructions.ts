/**
 * The werk agent instructions: the map rules an agent follows in any project.
 * The text cites no card of werk's own map, and examples use made-up ids.
 * See #werk-agent-instructions and #werk-agent-selfcontained.
 */

/** The text, with every command named by the path werk runs from. */
export function instructionsText(werk: string): string {
  return `# werk: the decision map

This project keeps its decisions in a werk map. Every command below runs the werk command line on this project's map. Run \`${werk} help\` to list every verb with its flags.

## Keep the map current, every turn

When the conversation settles something, record it in the same turn. Do not batch it up for later.

- Add a card: \`${werk} add <id> --title "..." --why "..." --body "..." --parent <id> --who <you|me|prototype>\`
- Link two cards: \`${werk} link <from> <to> --type depends_on --why "what <from> takes from <to>"\`
- Set a status: \`${werk} status <id> decided\`
- Reopen a card: \`${werk} reopen <id>\`
- Read a card: \`${werk} show <id>\`. Find cards by their words: \`${werk} search "<term>"\`.
- Write a note on a card: \`${werk} say <id> "..."\`. Read the notes: \`${werk} inbox\`.

## A card you add is a proposal

An added card is a ghost: dashed and grey, in no count, with every edge of its own held until it goes real. Only the person accepts a card. Never accept one yourself.

- Write the whole card in the add call. A ghost is frozen: edit, retitle and a second add with the same id all refuse. To correct it, discard it with \`${werk} discard <id>\`, then add it again with the new wording.
- Link and status still work on a ghost. An edge on a ghost is held. Build the card in full (add, link, options, decided) and it commits as one unit.
- At the end of the turn, say what waits for the person.

## Removing a card is the person's call

Propose a removal by saying which card should go and why. Do not remove it yourself. A ghost that you proposed and the person has not accepted can be discarded freely.

## Record dependencies when you create the card

A card is stale when a card it depends on changes. Record every need as a depends_on link at the moment you create the card, because the edges cannot be rebuilt later. The refines link says where a card sits in the tree. The depends_on link says what a card needs. They are different graphs over the same cards.

A link made after a change carries no mark from it. A new card can depend on a target that is stale now. Then the card waits. Say so in the same turn: name the stale target, and say the card was written with the correction already in hand.

Do not copy the content of a depends_on target into the body of the card. Write "see #checkout-retry" and state only what is new.

## Record a rejected option when you weigh it

When a decision comes from real contrast, add each rejected alternative as its own option card with a reason for the rejection, and link it as an alternative of the decided card, in the same turn:

- \`${werk} add checkout-retry:opt0 --kind option --title "..." --why_not "..."\`
- \`${werk} link checkout-retry:opt0 checkout-retry --type alternative_to\`

Without this, a card decided after real contrast looks the same as a card decided with no contrast.

## Tag who decides

- \`--who you\`: the person has a basis. Ask them.
- \`--who me\`: the choice is reversible. Decide it, say so, do not ask.
- \`--who prototype\`: neither of you can know by talking. Build it first, then decide.

Attach a concrete preview to any question you ask.

## Write a card about its subject, at the level of the decision

Check every title, why, body and rejection reason before you add or edit it. A reader reads the card later, cold, and needs to act on its subject.

1. No session narration. Do not write who said what, what came before, or what stage the conversation is at. Delete "as discussed" and "for now, until we...".
2. No edit history. Do not write "X is new", "Y used to say Z", "moved here from another card" or "split out of another card". State the current fact.
3. A reversal is a fact about the subject. A superseded card may say what replaced it and why the earlier reading was wrong.
4. No code names. Do not name source files, functions, classes, constants, line numbers or internal endpoints. Name behaviour and concepts.
5. No commands or flags, except on the cards that define a command. Name the operation instead.
6. Record rules, not one module's results. A module's test plan or coverage number belongs in that module's tests.
7. Do not list child cards. The refines links hold them. Avoid bullet and numbered lists in a body.

A card reads in three layers:

- Title: one plain sentence with a subject and a verb, about this card's own rule. No "now", no tool names, no count that a later change can make wrong, and no other decision's name.
- Why: two or three short sentences of plain causal steps. A reader who stops here understands about 80% of the card. No card references and no commands.
- Body: the decision, not the process. State the problem, then the answer. Define every new term in plain words where it first appears. Do not coin phrases.

A card about a mechanism shows one worked example and one ASCII picture. The example is a list of named things with plain titles, then numbered steps with one action and its result each, including the case where nothing happens. The picture uses the same names and labels every symbol. Show the rule as it holds now, from the user's side.

Example of a good card:

- Title: A checkout retries a failed payment once
- Why: A card payment fails by chance often enough that one retry saves orders. A second retry rarely helps and risks a double charge.

## Replying in a chat pane

When the person reads your reply in a chat pane, they act in the map, not in a terminal. Name a map operation by its plain name, not by its command line. Write "Next: decide #checkout-retry", not the full command. Still run the full command yourself. Write a full command line only when the person must run it in a terminal.

A line like \`[the map is now at #id — title]\` names the card the person is looking at. Unless they name another id, "this card" means that one.

## Do not touch the product diagram

If the project has a product diagram file, it is kept in step with the decided cards by a background job. Do not edit it and do not start agents for it.

## Subagents

Two subagents come with these instructions.

- Use \`prototyper\` when a fork between options can only be judged by looking at a built result. It builds one artifact per option. It never adds a card.
- Use \`test-scope\` before you decide what to test, for a module with no test policy yet. It classifies the module as pure or I/O and, for I/O, lists the behaviours to test. It never adds a card.

## Test scope

Classify a module before you decide what to test. Ask one question: does a wrong line fail loudly (throw, hang, crash) or quietly give a result that looks correct? A quiet wrong answer means the module is pure. A loud failure means it is I/O: it holds something live, such as a child process, a socket, an open file or a network call.

- A pure module gets a high line-coverage threshold, because its tests are cheap and its bugs never show themselves. Use the project's own threshold. If it has none, record one card saying the threshold needs deciding once for the whole project. Do not pick a number yourself.
- An I/O module gets a list of named behaviours and no percentage, because covering a line needs a fake of the live thing, and a percentage rewards the fake. Write each behaviour as a responsibility, not a location: "a crash never loses the message in flight" stays true after a rewrite.

## Images

Read an image with the Read tool. It gives you the image directly. Use a subagent only when you will read more than about ten images in one session, or you need only a short text fact from an image.
`;
}
