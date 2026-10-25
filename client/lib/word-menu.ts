/** The word menus of the composer: a slash opens the commands, a hash opens the card search (#werk-chat-cmdmenu, #werk-hash-trigger). */
import { LIMIT, type SearchRow, search } from "./card-search";

export type Word = {
  trigger: "/" | "#";
  /** The text after the trigger, up to the caret. */
  query: string;
  /** Where the word starts, and where the caret is. */
  start: number;
  end: number;
};

/**
 * The word that ends at the caret, when it starts with / or #. A backtick right before the trigger
 * makes the word start with the backtick, so inline code opens no menu. A second slash, hash or
 * backtick in the word closes the menu too.
 */
export function wordAt(text: string, caret: number): Word | null {
  const start = text.slice(0, caret).search(/\S*$/);
  const word = text.slice(start, caret);
  const trigger = word[0];
  if (trigger !== "/" && trigger !== "#") return null;
  const query = word.slice(1);
  if (/[/#`]/.test(query)) return null;
  return { trigger, query, start, end: caret };
}

/** The command names that start with the typed text, case ignored. */
export function commandMatches(
  names: readonly string[],
  query: string,
): string[] {
  const typed = query.toLowerCase();
  return names.filter((name) => name.toLowerCase().startsWith(typed));
}

/** The cards for the typed text: the id search first, then cards whose title holds it. */
export function cardMatches(
  rows: readonly SearchRow[],
  query: string,
): SearchRow[] {
  if (query === "") return [];
  const byId = search(rows, `#${query}`);
  const seen = new Set(byId.map((row) => row.id));
  const typed = query.toLowerCase();
  const byTitle = rows.filter(
    (row) => !seen.has(row.id) && row.title.toLowerCase().includes(typed),
  );
  return [...byId, ...byTitle].slice(0, LIMIT);
}

/** The text with the word replaced by the choice and a space, and the caret after the space. */
export function insertChoice(
  text: string,
  word: Word,
  choice: string,
): { text: string; caret: number } {
  const put = `${word.trigger}${choice} `;
  return {
    text: text.slice(0, word.start) + put + text.slice(word.end),
    caret: word.start + put.length,
  };
}
