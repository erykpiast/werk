/** The composer draft survives a page reload in the tab's own session storage (#werk-dev, #werk-client-reload). */
const KEY = "werk.composer.draft";

type Writer = Pick<Storage, "setItem" | "removeItem">;
type Reader = Pick<Storage, "getItem" | "removeItem">;

/** Keeps the draft for the next load of this tab. An empty draft keeps nothing. */
export function stashDraft(storage: Writer, text: string): void {
  if (text === "") storage.removeItem(KEY);
  else storage.setItem(KEY, text);
}

/** The draft the last load stashed, or an empty string. A draft is restored once. */
export function restoreDraft(storage: Reader): string {
  const text = storage.getItem(KEY) ?? "";
  storage.removeItem(KEY);
  return text;
}
