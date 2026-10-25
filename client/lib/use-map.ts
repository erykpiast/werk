import { useSyncExternalStore } from "react";
import { stashDraft } from "./draft";
import { createMapStore, type MapState } from "./map-store";

const composerText = () =>
  document.querySelector<HTMLTextAreaElement>("[data-composer]")?.value ?? "";

/** The one store of this page. The live channel opens when the first root mounts. */
export const mapStore = createMapStore({
  fetch: (url) => fetch(url),
  connect: (url) => new EventSource(url),
  reload: () => location.reload(),
  stashDraft: () => stashDraft(sessionStorage, composerText()),
});

export function useMap(): MapState {
  return useSyncExternalStore(mapStore.subscribe, mapStore.getState);
}
