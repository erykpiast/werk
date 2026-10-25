import { useState } from "react";
import { dotOf, type SearchRow, search } from "../lib/card-search";
import type { Count } from "../lib/counts";
import { type Crumb, lineOf } from "../lib/crumbs";
import type { View } from "../lib/project-route";

/**
 * The header of the left pane. Row 1 holds the breadcrumbs (#vi-crumbs-place). Row 2 holds the counts strip on the
 * left (#vi-counts-header), and the view tabs and the search box on the right (#vi-tabs, #vi-jump).
 */

/** The breadcrumbs: one line high, with the whole path in an overlay on hover (#vi-crumbs, #vi-crumbs-line). */
export function Crumbs({
  path,
  paneWidth,
  onOpen,
}: {
  path: readonly Crumb[];
  paneWidth: number;
  onOpen: (id: string) => void;
}) {
  const line = lineOf(path, paneWidth);
  const segments = (list: readonly Crumb[]) =>
    list.map((crumb, i) => {
      const last = crumb === path[path.length - 1];
      return (
        <span key={crumb.id} data-slot="crumb-item">
          {i > 0 ? <span aria-hidden="true"> › </span> : null}
          {last ? (
            <strong data-slot="crumb-current" title={crumb.title}>
              {crumb.title}
            </strong>
          ) : (
            <button type="button" onClick={() => onOpen(crumb.id)}>
              {crumb.title}
            </button>
          )}
        </span>
      );
    });
  return (
    <nav aria-label="Breadcrumbs" data-slot="crumbs">
      <div data-slot="crumb-line">
        {line.cut ? <span aria-hidden="true">… › </span> : null}
        {segments(line.shown)}
      </div>
      {line.overlay ? (
        <div data-slot="crumb-overlay">{segments(path)}</div>
      ) : null}
    </nav>
  );
}

/** The counts of the open card and everything below it, as bare numbers with hover titles. */
export function Counts({ counts }: { counts: readonly Count[] }) {
  return (
    <div data-slot="counts">
      {counts.map((count) => (
        <span
          key={count.kind}
          data-slot="count"
          data-kind={count.kind}
          title={count.title}
        >
          {count.n}
        </span>
      ))}
    </div>
  );
}

const TABS: { view: View; label: string }[] = [
  { view: "home", label: "Home" },
  { view: "map", label: "Map" },
  { view: "board", label: "Board" },
];

/** One tab for each view. The tab of the view in use is marked, and a click on it changes nothing. */
export function Tabs({
  view,
  onSelect,
}: {
  view: View;
  onSelect: (view: View) => void;
}) {
  return (
    <nav aria-label="Views" data-slot="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.view}
          type="button"
          aria-current={tab.view === view ? "page" : undefined}
          onClick={() => {
            if (tab.view !== view) onSelect(tab.view);
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

/** The search box and its list of results. The keyboard drives the list (#vi-jump). */
export function SearchBox({
  rows,
  onOpen,
}: {
  rows: readonly SearchRow[];
  onOpen: (id: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [selected, setSelected] = useState(0);
  const results = search(rows, typed);
  const open = (id: string) => {
    setTyped("");
    setSelected(0);
    onOpen(id);
  };
  return (
    <div data-slot="search">
      <input
        type="search"
        aria-label="Search the map"
        placeholder="Search"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          setSelected(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setTyped("");
            setSelected(0);
          } else if (event.key === "ArrowDown" && results.length > 0) {
            event.preventDefault();
            setSelected((selected + 1) % results.length);
          } else if (event.key === "ArrowUp" && results.length > 0) {
            event.preventDefault();
            setSelected((selected - 1 + results.length) % results.length);
          } else if (event.key === "Enter") {
            const chosen = results[selected];
            if (chosen) open(chosen.id);
          }
        }}
      />
      {results.length > 0 ? (
        <ul aria-label="Search results">
          {results.map((row, i) => {
            const dot = dotOf(row);
            return (
              <li key={row.id} aria-current={i === selected || undefined}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    open(row.id);
                  }}
                >
                  <span
                    data-slot="dot"
                    data-color={dot.color}
                    data-split={dot.split || undefined}
                  />
                  <span data-slot="result-title">{row.title}</span>
                  <code>{row.id}</code>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
