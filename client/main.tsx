import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "./app/composer";
import { addProjectFromDialog } from "./lib/add-project";
import { stashDraft } from "./lib/draft";
import { createMapStore } from "./lib/map-store";
import {
  cardOf,
  cardOfHref,
  cardPageOf,
  firstOpenable,
  pageOf,
  projectOf,
} from "./lib/project-route";
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

const say = (text: string) => {
  if (body) body.textContent = text;
};

/** Adds a project through the folder dialog (#werk-projects-add). */
function addProjectButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Add project…";
  button.addEventListener("click", () => {
    const token =
      document.querySelector<HTMLMetaElement>("meta[name=werk-token]")
        ?.content ?? "";
    addProjectFromDialog({
      fetch: (url, init) => fetch(url, init),
      token,
      confirm: (question) => window.confirm(question),
      go: (path) => location.assign(path),
    }).then(
      (error) => {
        if (error !== null) say(error);
      },
      (error) => say(String(error)),
    );
  });
  scope?.after(button);
}

async function start() {
  addProjectButton();
  const project = projectOf(location.pathname);
  if (project === null) {
    // An address with no project goes to the first project that can open.
    const list = (await (await fetch("/api/projects")).json()) as {
      projects: { name: string; missing: boolean }[];
    };
    const first = firstOpenable(list.projects);
    if (first === null) {
      say("No project on the list. Add a folder that has a git repository.");
    } else {
      location.replace(pageOf(first));
    }
    return;
  }
  const store = createMapStore(
    {
      fetch: async (url) => {
        const res = await fetch(url);
        if (res.status === 409) {
          const refusal = (await res.clone().json()) as { message?: string };
          say(refusal.message ?? "This project cannot open.");
        }
        return res;
      },
      connect: (url) => new EventSource(url),
      show: (view) => {
        if (scope) {
          scope.textContent =
            view.id === null ? project : `${project} · #${view.id}`;
        }
        if (body) {
          body.innerHTML = view.html ?? "<p>The map has no cards yet.</p>";
        }
      },
      reload: () => location.reload(),
      stashDraft: () =>
        stashDraft(
          sessionStorage,
          document.querySelector<HTMLTextAreaElement>("[data-composer]")
            ?.value ?? "",
        ),
    },
    project,
  );
  store.open(cardOf(location.pathname));
  store.start();
  // A card link is /map/<id>. A click opens that card's page and adds one history entry (#vi-routes).
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const copy = target?.closest<HTMLElement>("[data-copy]");
    if (copy) {
      void navigator.clipboard?.writeText(`#${copy.dataset.copy ?? ""}`);
      return;
    }
    const link = target?.closest<HTMLAnchorElement>("a[href^='/map/']");
    const card = link ? cardOfHref(link.getAttribute("href") ?? "") : null;
    if (card === null || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    event.preventDefault();
    history.pushState(null, "", cardPageOf(project, card));
    store.open(card);
  });
  window.addEventListener("popstate", () =>
    store.open(cardOf(location.pathname)),
  );
}

void start();
