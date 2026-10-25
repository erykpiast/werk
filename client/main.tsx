import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatPane } from "./app/chat-pane";
import { Composer } from "./app/composer";
import { Counts, Crumbs, SearchBox, Tabs } from "./app/header";
import { Switcher } from "./app/switcher";
import { addProjectFromDialog } from "./lib/add-project";
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
import { rowsOf } from "./lib/switcher";
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

type Listed = {
  name: string;
  folder: string;
  missing: boolean;
  dev: boolean;
  running: string[];
};

const readList = async (): Promise<Listed[]> =>
  (
    (await (await fetch("/api/projects")).json()) as {
      projects: Listed[];
    }
  ).projects;

/** Adds a project through the folder dialog (#werk-projects-add). */
function addProject() {
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
}

/** Mounts the project switcher at the left of header row 1, and keeps its list current (#werk-projects-switcher). */
function mountSwitcher(current: string | null): HTMLElement {
  const host = document.createElement("div");
  host.dataset.slot = "switcher-host";
  const root = createRoot(host);
  let list: Listed[] = [];
  const draw = () =>
    root.render(
      <Switcher
        current={current}
        rows={rowsOf(list, null)}
        running={(name) => list.find((p) => p.name === name)?.running ?? []}
        onOpen={(name) => location.assign(pageOf(name))}
        onRemove={(name, confirm) => {
          void fetch(
            `/api/projects/${encodeURIComponent(name)}${confirm ? "?confirm=1" : ""}`,
            { method: "DELETE", headers: { "x-werk-token": token() } },
          ).then(async (res) => {
            if (res.ok && name === current) location.assign("/");
            else await refresh();
          });
        }}
        onAdd={addProject}
      />,
    );
  const refresh = async () => {
    try {
      list = await readList();
      draw();
    } catch {
      // The server is restarting. The next refresh draws the list.
    }
  };
  draw();
  void refresh();
  // The busy dots follow the agent turns that run in each project.
  setInterval(() => void refresh(), 3000);
  return host;
}

async function start() {
  const project = projectOf(location.pathname);
  const switcher = mountSwitcher(project);
  if (project === null) {
    scope?.replaceChildren(switcher);
    // An address with no project goes to the first project that can open.
    const first = firstOpenable(await readList());
    chatReact?.render(
      <StrictMode>
        <Composer />
      </StrictMode>,
    );
    if (first === null) {
      // An empty list opens one page with the same action as the switcher's last row.
      if (body) {
        body.innerHTML =
          "<p>No project on the list. Add a folder that has a git repository.</p>";
        const add = document.createElement("button");
        add.type = "button";
        add.dataset.slot = "start-add";
        add.textContent = "Add project…";
        add.addEventListener("click", addProject);
        body.append(add);
      }
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
  scope?.replaceChildren(switcher, crumbHost);
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
    openCard(card);
  });
  window.addEventListener("popstate", route);
}

void start();
