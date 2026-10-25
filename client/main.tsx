import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "./app/composer";
import { stashDraft } from "./lib/draft";
import { createMapStore } from "./lib/map-store";
import "./index.css";

/**
 * The card HTML comes from the server and is swapped in, never hydrated. React roots mount
 * only where state lives: the composer (#werk-stack-hydration).
 */
const scope = document.querySelector("[data-slot=header-row-1]");
const body = document.querySelector("[data-slot=body]");
const composerRoot = document.getElementById("composer-root");
if (composerRoot) {
  createRoot(composerRoot).render(
    <StrictMode>
      <Composer />
    </StrictMode>,
  );
}

createMapStore({
  fetch: (url) => fetch(url),
  connect: (url) => new EventSource(url),
  show: (view) => {
    if (scope) scope.textContent = view.id === null ? "werk" : `#${view.id}`;
    if (body) {
      body.innerHTML = view.html ?? "<p>The map has no cards yet.</p>";
    }
  },
  reload: () => location.reload(),
  stashDraft: () =>
    stashDraft(
      sessionStorage,
      document.querySelector<HTMLTextAreaElement>("[data-composer]")?.value ??
        "",
    ),
}).start();
