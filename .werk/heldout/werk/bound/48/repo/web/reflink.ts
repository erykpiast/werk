// The card reference linker (#werk-reflink). Pure: escaped text and the set of known ids in,
// text with each reference handed to a renderer out. The known set holds every id the map can
// open, ghosts included, removed and discarded cards left out (#werk-reflink-inview).

import { entityCharAtEnd } from "./escape";

export type KnownIds = ReadonlySet<string>;

// A token that may be a card id: a letter or digit, then letters, digits, _ and -, then any
// number of :parts, as in pr-iface:opt0. An optional # comes before it.
const ID_PATTERN = "[A-Za-z0-9][\\w-]*(?::[\\w-]+)*";
const REF = new RegExp(`(#?)(${ID_PATTERN})`, "g");
const ID = new RegExp(`^#?(${ID_PATTERN})$`);

// A reference starts only where a token starts: never after a word character or a slash
// (#werk-reflink), nor after a #, a hyphen, a colon or an ampersand (#werk-reflink-guard).
const JOINS = /[\w/#:&-]/;

/**
 * The character before `offset` in the source text that `escaped` was escaped from, so an
 * escaped < or " before an id counts as itself, not as the ; that ends its entity.
 */
function charBefore(escaped: string, offset: number): string {
  const before = escaped.slice(0, offset);
  return entityCharAtEnd(before) ?? before.slice(-1);
}

/** The card a whole code span names, when it holds nothing but a known id, with or without #. */
export function codeSpanRef(content: string, known: KnownIds): string | undefined {
  const id = ID.exec(content.trim())?.[1];
  return id !== undefined && known.has(id) ? id : undefined;
}

/**
 * Replace each reference in escaped prose with `render(id)`. A #id links any known id; a bare
 * id links only when it holds a hyphen or a colon. Every other token stays as it was written.
 */
export function linkRefs(escaped: string, known: KnownIds, render: (id: string) => string): string {
  return escaped.replace(REF, (token: string, hash: string, id: string, offset: number) => {
    if (JOINS.test(charBefore(escaped, offset))) return token;
    if (!known.has(id)) return token;
    if (hash === "" && !/[-:]/.test(id)) return token;
    return render(id);
  });
}

/** The address of a card's page on the map, with the id URL-encoded (#vi-routes). */
export function cardHref(id: string): string {
  return `/map/${encodeURIComponent(id)}`;
}

/** A reference as a link: always #id, in a monospace face, whatever form it was written in (#werk-reflink-label). */
export function refLink(id: string): string {
  return `<a class="ref" href="${cardHref(id)}"><code>#${id}</code></a>`;
}

/** A reference that reads as #id but does not link, for a tile that is itself a link (#vi-onview-subcards). */
export function refLabel(id: string): string {
  return `<span class="ref"><code>#${id}</code></span>`;
}
