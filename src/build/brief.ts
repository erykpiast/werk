/**
 * The prompt of one builder pass: the implement skill first, then everything the pass needs and
 * nothing from earlier passes (#st-build-implement, #st-build-implement-search, #lp-stateless). Pure.
 */

/** The last failure is cut to about this many characters, keeping its end (#lp-stateless). */
export const FAILURE_LIMIT = 4000;

/** The end of a text, at most `max` characters, with a marker when the start was cut. */
export function tailOf(text: string, max: number = FAILURE_LIMIT): string {
  return text.length <= max ? text : `[cut]\n${text.slice(text.length - max)}`;
}

const STORY = /^\s*(\d+)\.\s/;

/** The lines of the spec that hold the numbered stories. A number the spec lacks gives no line. */
export function storyLines(
  spec: string | null,
  numbers: readonly string[],
): string[] {
  if (spec === null) return [];
  const wanted = new Set(numbers.map((n) => String(Number(n))));
  return spec
    .split("\n")
    .filter((line) => {
      const story = STORY.exec(line);
      return story !== null && wanted.has(String(Number(story[1])));
    })
    .map((line) => line.trim());
}

export type CardBrief = {
  id: string;
  title: string;
  why: string;
  body: string;
  /** The options that lost, each with the reason. */
  rejected: { title: string; whyNot: string }[];
};

export type BriefInput = {
  /** The text of the ticket file. */
  ticket: string;
  stories: readonly string[];
  cards: readonly CardBrief[];
  checks: readonly string[];
  /** The id and the title of every decided card, one per line. */
  index: string;
  obligation: string;
  /** The number of this pass, from 1. */
  pass: number;
  /** The commit that the worktree branched from. */
  base: string;
  /** The last failure, or null when nothing failed. */
  failure: string | null;
};

const RULES = [
  "Do not weaken, skip, or delete a test to make a check pass.",
  "You run headless. Ask no questions. If the ticket leaves something open, pick a reasonable reading and say so in one line at the end.",
  "Propose a card for each decision that no cited card and no card of your search gives, at the moment you make it.",
];

function cardSection(card: CardBrief): string {
  const parts = [`### #${card.id} — ${card.title}`, `why: ${card.why}`];
  if (card.body !== "") parts.push(card.body);
  for (const option of card.rejected) {
    parts.push(`Rejected option: ${option.title} — ${option.whyNot}`);
  }
  return parts.join("\n");
}

function history(input: BriefInput): string {
  if (input.pass === 1) return "Nothing is done yet. This is the first pass.";
  return `This is pass ${input.pass}. Earlier passes left their work in the repository and nothing else. Read \`git log\` and \`git diff ${input.base}\` to see it.`;
}

/** The whole prompt of a pass. It starts with the skill. */
export function buildBrief(input: BriefInput): string {
  const sections = [
    "/implement the ticket below.",
    RULES.map((rule) => `- ${rule}`).join("\n"),
    `## Pass\n\n${history(input)}`,
    `## Ticket\n\n${input.ticket.trim()}`,
    `## Stories this ticket delivers\n\n${
      input.stories.length === 0 ? "None." : input.stories.join("\n")
    }`,
    `## Cited cards\n\n${
      input.cards.length === 0
        ? "None."
        : input.cards.map(cardSection).join("\n\n")
    }`,
    `## Checks\n\n${input.checks.map((check) => `- \`${check}\``).join("\n")}`,
    `## Card obligation\n\nThis build has the card obligation \`${input.obligation}\`. Close it with a proposed card for each decision no card gives, or record the cards you followed.`,
    `## Search the map before you decide\n\nBefore you decide a question that no cited card answers, search the map for the terms of the question and read every card that matches. A decided card that answers it binds you as a cited card does. Here is every decided card:\n\n${input.index}`,
    `## Last failure\n\n${
      input.failure === null
        ? "Nothing has failed yet."
        : tailOf(input.failure.trim())
    }`,
  ];
  return `${sections.join("\n\n")}\n`;
}
