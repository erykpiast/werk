/** The prompts of the two plan writers (#st-spec, #st-spec-decisions, #st-ticket-shape). Pure text. */

export type PlanPaths = {
  /** The spec the spec writer writes. */
  spec: string;
  /** The answers of the spec writer. */
  specAnswers: string;
  /** The answers of the ticket writer. */
  ticketAnswers: string;
  /** The folder that holds one file per ticket. */
  ticketsDir: string;
  /** The list of open tickets that the new spec no longer needs. */
  ticketDrops: string;
};

/** The tickets of earlier plans over the subtree, by number. Open means ready or blocked (#st-plan-extend). */
export type OnBoardNumbers = {
  open: readonly number[];
  /** Every other ticket on the board: building, merging, done or archived. Its file never changes. */
  fixed: readonly number[];
};

export type ScopeText = {
  /** Each card of the first tier, printed in full. */
  first: readonly string[];
  /** Each card of the second tier, printed in full. */
  second: readonly string[];
};

function scopeSection(scope: ScopeText): string {
  const second =
    scope.second.length === 0
      ? ""
      : `\n\n## Second tier: context\n\nNo ticket has to cite these cards.\n\n${scope.second.join("\n\n---\n\n")}`;
  return `## First tier: the subtree and the cards it links\n\nEvery decided card of the subtree must be cited by at least one ticket.\n\n${scope.first.join("\n\n---\n\n")}${second}`;
}

const ANSWERS_RULES = (file: string) =>
  `Answer every question yourself from the cards above. A question that no card settles is a new decision. Write each such decision as a record in the JSON list in ${file}: {"slug": "short-lower-case-words", "title": "...", "why": "...", "body": "..."}. The title is one plain sentence about the rule. The why names the question it settles. Write [] when the cards settle everything. Write the file in every case. Never write to the map yourself.`;

const pad = (n: number): string => String(n).padStart(2, "0");

const numbers = (list: readonly number[]): string =>
  list.length === 0 ? "none" : list.map(pad).join(", ");

export function specPrompt(
  root: string,
  scope: ScopeText,
  paths: PlanPaths,
  extending = false,
): string {
  const update = extending
    ? `\n\nA spec for this subtree exists already at ${paths.spec}. Read it and update it in place. Keep the number of every story that still holds, and number each new story after the highest number. Drop a story only when the cards no longer ask for it.`
    : "";
  return `Write one spec for the decided subtree of the card #${root}.

${scopeSection(scope)}

## Your task

Write the spec to ${paths.spec}.${update} It has these sections: Problem, User stories, Test seams. The User stories section is a numbered list, one story per line, in the form "1. As a person, I want ..., so that ...". Each story ends with the cards it comes from in parentheses. Name the test seams: where a test can reach the product, and what a test fake stands in for.

${ANSWERS_RULES(paths.specAnswers)}

Use only the tools you have. Write only ${paths.spec} and ${paths.specAnswers}.`;
}

export function ticketPrompt(
  root: string,
  scope: ScopeText,
  paths: PlanPaths,
  firstNumber = 1,
  board?: OnBoardNumbers,
): string {
  const earlier =
    board === undefined || board.open.length + board.fixed.length === 0
      ? ""
      : `

## Tickets of earlier plans

Open tickets, ready or blocked: ${numbers(board.open)}. To change one, rewrite its file in place under the same file name. A file you do not write stays as it is. When an open ticket delivers nothing in the spec, list it in ${paths.ticketDrops} as a JSON list of {"ticket": 3, "why": "..."} and the plan archives it with that reason.
Other tickets: ${numbers(board.fixed)}. Never change their files.
Your new tickets cover only the scope that these tickets do not cover.`;
  return `Split the spec of the card #${root} into tickets.

${scopeSection(scope)}${earlier}

## Your task

Read the spec in ${paths.spec}. Write one file for each ticket in ${paths.ticketsDir}. A file name starts with the ticket number, from ${firstNumber} to 99, for example ${String(firstNumber).padStart(2, "0")}-login.md. Number the first ticket ${firstNumber}. A ticket is a narrow, complete slice through every layer that the change touches. It can be shown working on its own and fits one fresh context.

Every ticket has this format, in this order. The first five lines are header lines. Cites holds card ids. Blocked_by and stories hold ticket numbers and story numbers, separated by commas. Touches holds the names of the modules the ticket changes, as concept names. A ticket names no file path anywhere. A check line is "make <target>".

title: <one plain sentence>
cites: <card ids>
blocked_by: <ticket numbers, or empty>
stories: <story numbers, or empty>
touches: <module names>

## What to build

<the end-to-end behaviour, from the user's side>

## Acceptance criteria

- [ ] <one criterion>

## Checks

- \`make test\`

Every story of the spec is delivered by at least one ticket. Every decided card of the first tier is cited by at least one ticket. A ticket file is at most 4000 characters. Blocked_by is the delivery order, and you decide it.

${ANSWERS_RULES(paths.ticketAnswers)}

Use only the tools you have. Write only the ticket files in ${paths.ticketsDir}, ${paths.ticketAnswers} and ${paths.ticketDrops}.`;
}
