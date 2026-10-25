import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatPane } from "./app/chat-pane";
import { Composer } from "./app/composer";
import { Counts, Crumbs, SearchBox, Tabs } from "./app/header";
import { addProjectFromDialog } from "./lib/add-project";
import {
  removeFactsOf,
  removeQuestion,
  sendCardAction,
} from "./lib/card-actions";
import { createChatStore } from "./lib/chat-store";
import { countsOf } from "./lib/counts";
import { pathTo } from "./lib/crumbs";
import { stashDraft } from "./lib/draft";
import { createMapStore, type HeaderIndex } from "./lib/map-store";
import {
  cardOf,
  cardOfHash,
  cardOfHref,
  cardPageOf,
  firstOpenable,
  pageOf,
  projectOf,
  type View,
  viewOf,
  viewPageOf,
} from "./lib/project-route";
import { recall, remember } from "./lib/view-memory";
import "./index.css";

/**
 * The card HTML comes from the server and is swapped in, never hydrated. React roots mount
 * only where state lives: the composer (#werk-stack-hydration).
 */
const scope = document.querySelector("[data-slot=header-row-1]");
const headerLeft = document.querySelector<HTMLElement>(
  "[data-slot=header-left]",
);
const headerRight = document.querySelector<HTMLElement>(
  "[data-slot=header-right]",
);
const leftPane = document.getElementById("left-pane");
const body = document.querySelector("[data-slot=body]");
const chatRoot = document.getElementById("chat-root");
const chatReact = chatRoot ? createRoot(chatRoot) : null;
const token = () =>
  document.querySelector<HTMLMetaElement>("meta[name=werk-token]")?.content ??
  "";

const say = (text: string) => {
  if (body) body.textContent = text;
};

/** Adds a project through the folder dialog (#werk-projects-add). */
function addProjectButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Add project…";
  button.addEventListener("click", () => {
    addProjectFromDialog({
      fetch: (url, init) => fetch(url, init),
      token: token(),
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
    chatReact?.render(
      <StrictMode>
        <Composer />
      </StrictMode>,
    );
    if (first === null) {
      say("No project on the list. Add a folder that has a git repository.");
    } else {
      // An old address /#id opens that card (#vi-routes).
      const old = cardOfHash(location.hash);
      location.replace(old === null ? pageOf(first) : cardPageOf(first, old));
    }
    return;
  }
  // The card the left pane shows is the card a message names (#werk-card-blind).
  // A view with no card in its address keeps the last card named (#vi-routes).
  let openId: string | null = null;
  let view: View = viewOf(location.pathname);
  let index: HeaderIndex | null = null;
  const crumbHost = document.createElement("div");
  crumbHost.dataset.slot = "crumb-host";
  const name = document.createElement("span");
  name.dataset.slot = "project-name";
  name.textContent = project;
  scope?.replaceChildren(name, crumbHost);
  const crumbRoot = createRoot(crumbHost);
  const leftRoot = headerLeft ? createRoot(headerLeft) : null;
  const rightRoot = headerRight ? createRoot(headerRight) : null;

  /** Opens an address and adds one history entry (#vi-routes). */
  const go = (path: string) => {
    if (location.pathname === path) return;
    history.pushState(null, "", path);
    route();
  };
  const openCard = (card: string) => go(cardPageOf(project, card));
  const renderHeader = () => {
    const rows = index?.entries ?? [];
    const path = pathTo(rows, openId);
    const isRoot = path.length <= 1;
    crumbRoot.render(
      <Crumbs
        path={path}
        paneWidth={leftPane?.clientWidth ?? 0}
        onOpen={openCard}
      />,
    );
    leftRoot?.render(
      <Counts
        counts={countsOf(
          openId === null ? undefined : index?.rollups[openId],
          isRoot ? null : openId,
        )}
      />,
    );
    rightRoot?.render(
      <>
        <Tabs
          view={view}
          onSelect={(next) =>
            go(
              viewPageOf(
                project,
                next,
                next === "map" ? recall(localStorage, project).card : null,
              ),
            )
          }
        />
        <SearchBox rows={rows} onOpen={openCard} />
      </>,
    );
  };
  if (leftPane) {
    new ResizeObserver(() => renderHeader()).observe(leftPane);
  }
  const chat = createChatStore(
    {
      fetch: (url, init) => fetch(url, init),
      token: token(),
      card: () => openId,
      now: () => Date.now(),
      newTurn: () =>
        `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    },
    project,
  );
  chatReact?.render(
    <StrictMode>
      <ChatPane store={chat} />
    </StrictMode>,
  );
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
      chat: (type, data) => chat.receive(type, data),
      connected: () => void chat.load(),
      index: (next) => {
        index = next;
        renderHeader();
      },
      show: (shown) => {
        if (view !== "map") return;
        openId = shown.id;
        renderHeader();
        if (body) {
          body.innerHTML = shown.html ?? "<p>The map has no cards yet.</p>";
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
  /** Shows the view that the address names. */
  const route = () => {
    view = viewOf(location.pathname);
    if (view === "map") {
      const card = cardOf(location.pathname);
      remember(localStorage, project, { view, card });
      store.open(card);
    } else {
      remember(localStorage, project, { view, card: null });
      if (body) {
        body.innerHTML =
          '<article class="board-page"><h1>Board</h1><p>The ticket board.</p></article>';
      }
    }
    renderHeader();
  };
  // A bare project address opens the view the project remembers (#vi-tabs).
  if (/^\/p\/[^/]+\/?$/.test(location.pathname)) {
    const last = recall(localStorage, project);
    history.replaceState(null, "", viewPageOf(project, last.view, last.card));
  }
  route();
  store.start();
  /** Asks the server to append the event. The page redraws when the live channel signals the change. */
  const act = async (
    kind: "accept" | "remove",
    request: { card: string; reparent?: boolean },
  ) => {
    const refused = await sendCardAction(
      { fetch: (url, init) => fetch(url, init), token: token() },
      project,
      kind,
      request,
    ).catch((error) => String(error));
    if (refused !== null) say(refused);
  };
  /** The one confirmation of the ✕, drawn under the card's buttons (#vi-remove-btn). */
  const askRemove = (button: HTMLElement) => {
    const host = button.closest(".hero");
    if (!host) return;
    host.querySelector(".remove-confirm")?.remove();
    const question = removeQuestion(removeFactsOf(button.dataset));
    const panel = document.createElement("div");
    panel.className = "remove-confirm";
    panel.setAttribute("role", "alertdialog");
    const text = document.createElement("p");
    text.textContent = question.text;
    panel.append(text);
    const choose = (label: string, handler: () => void) => {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.textContent = label;
      choice.addEventListener("click", handler);
      panel.append(choice);
    };
    for (const { label, reparent } of question.choices) {
      choose(label, () => {
        panel.remove();
        void act("remove", {
          card: button.dataset.card ?? "",
          ...(reparent ? { reparent } : {}),
        });
      });
    }
    choose("Cancel", () => panel.remove());
    host.querySelector(".card-actions")?.after(panel);
  };
  // A card link is /map/<id>. A click opens that card's page and adds one history entry (#vi-routes).
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const copy = target?.closest<HTMLElement>("[data-copy]");
    if (copy) {
      void navigator.clipboard?.writeText(`#${copy.dataset.copy ?? ""}`);
      return;
    }
    const action = target?.closest<HTMLElement>("[data-action]");
    if (action?.dataset.action === "accept") {
      void act("accept", { card: action.dataset.card ?? "" });
      return;
    }
    if (action?.dataset.action === "remove") {
      askRemove(action);
      return;
    }
    const link = target?.closest<HTMLAnchorElement>("a[href^='/map/']");
    const card = link ? cardOfHref(link.getAttribute("href") ?? "") : null;
    if (card === null || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    event.preventDefault();
    openCard(card);
  });
  window.addEventListener("popstate", route);
}

void start();
