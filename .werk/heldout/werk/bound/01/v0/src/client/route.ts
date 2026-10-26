/**
 * The address of a page (#vi-onview). The address bar names the open card, so a view can be
 * shared and stays after a reload. `/` is the root page.
 */

export function cardPath(id: string | undefined): string {
  return id === undefined ? '/' : `/card/${encodeURIComponent(id)}`
}

/** The card a path names, or undefined for the root page and any other path. */
export function cardIdFromPath(pathname: string): string | undefined {
  const match = /^\/card\/([^/]+)\/?$/.exec(pathname)
  if (!match) return undefined
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return undefined
  }
}
