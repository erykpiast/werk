/** The address of a project in the page, and the choice of a project when the address names none (#werk-projects-names). */

export type ProjectInfo = { name: string; missing: boolean };

const PREFIX = "/p/";

/** The project that a page address names, or null when it names none. */
export function projectOf(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const segment = pathname.slice(PREFIX.length).replace(/\/.*$/, "");
  if (segment === "") return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The page address of a project. */
export function pageOf(name: string): string {
  return `${PREFIX}${encodeURIComponent(name)}`;
}

/** The path of a project's API route. Every route of the map names its project. */
export function apiOf(name: string, rest: string): string {
  return `/api/projects/${encodeURIComponent(name)}${rest}`;
}

/** The first project that can open, or null when the list has none. */
export function firstOpenable(projects: readonly ProjectInfo[]): string | null {
  return projects.find((p) => !p.missing)?.name ?? null;
}

/** The card that a page address names after the project, or null for the open card of the map. */
export function cardOf(pathname: string): string | null {
  const found = /^\/p\/[^/]+\/map\/([^/]+)$/.exec(pathname);
  if (!found) return null;
  try {
    return decodeURIComponent(found[1] as string);
  } catch {
    return null;
  }
}

/** The page address of a card in a project. A card link in the page is /map/<id> and the page rewrites it to this. */
export function cardPageOf(project: string, card: string): string {
  return `${pageOf(project)}/map/${encodeURIComponent(card)}`;
}

/** The card id of an in-page card link, or null for any other link. */
export function cardOfHref(href: string): string | null {
  const found = /^\/map\/([^/?#]+)$/.exec(href);
  if (!found) return null;
  try {
    return decodeURIComponent(found[1] as string);
  } catch {
    return null;
  }
}

export type View = "map" | "board";

/** The view that a page address names. An address with no view suffix is the map (#vi-routes). */
export function viewOf(pathname: string): View {
  return /^\/p\/[^/]+\/board\/?$/.test(pathname) ? "board" : "map";
}

/** The page address of a view. The map takes a card, and the board opens at the root (#vi-tabs). */
export function viewPageOf(
  project: string,
  view: View,
  card: string | null = null,
): string {
  if (view === "board") return `${pageOf(project)}/board`;
  return card === null ? `${pageOf(project)}/map` : cardPageOf(project, card);
}

/** The card that an old address `/#id` names, or null for any other hash (#vi-routes). */
export function cardOfHash(hash: string): string | null {
  const found = /^#([^/?#]+)$/.exec(hash);
  if (!found) return null;
  try {
    return decodeURIComponent(found[1] as string);
  } catch {
    return null;
  }
}
