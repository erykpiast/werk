/**
 * The address of a page (#vi-onview). The location hash names the open card, so a view can
 * be shared and stays after a reload. No hash is the root page.
 */

export function cardHash(id: string | undefined): string {
  return id === undefined ? '#' : `#${encodeURIComponent(id)}`
}

/** The card a location hash names, or undefined for the root page and a hash that does not decode. */
export function cardIdFromHash(hash: string): string | undefined {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (raw === '') return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}
