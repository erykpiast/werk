// A command accepts a card id with or without one leading hash sign (#werk-cli-hash-id).

/** Removes exactly one leading `#` from a card id, and nothing else. */
export function cardId(arg: string): string {
  return arg.startsWith("#") ? arg.slice(1) : arg;
}
