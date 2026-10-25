import { useEffect, useRef } from "react";
import type { Column } from "../../src/board/fold";
import type { LogLine } from "../../src/board/session-log";
import type { BoardView, Decisions, TicketView } from "../../src/board/view";
import { renderMarkdown } from "../../src/md/markdown";
import { Button } from "../components/ui/button";
import { type BoardPrefs, sidebarMode } from "../lib/board-prefs";

/**
 * The board: five columns of ticket cards, and a drawer beneath them for the open ticket
 * (#vi-board, #werk-board-columns, #werk-board-colwidth).
 */

const COLUMNS: { column: Column; label: string }[] = [
  { column: "blocked", label: "Blocked" },
  { column: "ready", label: "Ready" },
  { column: "building", label: "Building" },
  { column: "merging", label: "Merging" },
  { column: "done", label: "Done" },
];

const noCards = () => false;

/** The pulsing dot that says a builder session runs now (#vi-board-session-file). */
function LiveDot({ corner = false }: { corner?: boolean }) {
  return (
    <span
      role="img"
      aria-label="Session running"
      data-slot="live-dot"
      data-corner={corner || undefined}
    />
  );
}

/** A ticket card: the title cut to two lines, the counts, and the dot in the top-left corner (#vi-board-title-clamp, #vi-board-pulse-corner). */
function TicketCard({
  ticket,
  open,
  onSelect,
}: {
  ticket: TicketView;
  open: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-slot="ticket-card"
      data-ticket={ticket.id}
      aria-pressed={open}
      onClick={() => onSelect(ticket.id)}
    >
      {ticket.running ? <LiveDot corner /> : null}
      <span
        data-slot="ticket-title"
        data-running={ticket.running || undefined}
        title={ticket.title}
      >
        {ticket.title}
      </span>
      <span data-slot="ticket-counts">
        {ticket.retries > 1 ? (
          <span data-slot="retries" title={`${ticket.retries} retries`}>
            ↻{ticket.retries}
          </span>
        ) : null}
        {ticket.openBlockers > 0 ? (
          <span
            data-slot="blockers"
            title={`${ticket.openBlockers} open blockers`}
          >
            ⊘{ticket.openBlockers}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function CardLink({ id }: { id: string }) {
  return (
    <a className="card-ref" href={`/map/${encodeURIComponent(id)}`}>
      #{id}
    </a>
  );
}

function DecisionsSection({ decisions }: { decisions: Decisions }) {
  if (decisions.cards.length === 0) {
    return (
      <p>
        No new card.
        {decisions.followed.length > 0 ? " Followed " : null}
        {decisions.followed.map((id, i) => (
          <span key={id}>
            {i > 0 ? ", " : null}
            <CardLink id={id} />
          </span>
        ))}
        {decisions.followed.length > 0 ? "." : null}
      </p>
    );
  }
  return (
    <ul>
      {decisions.cards.map((card) => (
        <li key={card.id} data-state={card.state}>
          {card.state === "gone" ? (
            <span className="card-ref">#{card.id}</span>
          ) : (
            <CardLink id={card.id} />
          )}{" "}
          <span data-slot="decision-state">{card.state}</span>
        </li>
      ))}
    </ul>
  );
}

function Facts({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <section data-slot="fact" aria-label={title}>
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function Sidebar({ ticket }: { ticket: TicketView }) {
  return (
    <>
      {ticket.cites.length > 0 ? (
        <section data-slot="fact" aria-label="Cites">
          <h4>Cites</h4>
          <ul>
            {ticket.cites.map((id) => (
              <li key={id}>
                <CardLink id={id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Facts
        title="Blockers"
        items={ticket.blockers.map((b) => `${b.id}${b.done ? " (done)" : ""}`)}
      />
      <section data-slot="fact" aria-label="Retries">
        <h4>Retries</h4>
        <p>{ticket.retries}</p>
      </section>
      <Facts title="Checks" items={ticket.checks} />
      <Facts title="Stories" items={ticket.stories} />
      <Facts title="Touches" items={ticket.touches} />
      {ticket.decisions ? (
        <section data-slot="fact" aria-label="Decisions">
          <h4>Decisions</h4>
          <DecisionsSection decisions={ticket.decisions} />
        </section>
      ) : null}
    </>
  );
}

/** The live log of a building ticket: one summarised line per event, with its full time (#vi-board-details). */
function LiveLog({
  lines,
  expanded,
  onToggle,
}: {
  lines: readonly LogLine[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view follows the newest line
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <section
      data-slot="live-log"
      data-expanded={expanded || undefined}
      aria-label="Live log"
    >
      <div data-slot="live-log-bar">
        <span>Live log</span>
        <Button
          data-slot="log-toggle"
          aria-pressed={expanded}
          title={
            expanded
              ? "Show the sidebar"
              : "Hide the sidebar and double the log"
          }
          onClick={onToggle}
        >
          {expanded ? "Shrink log" : "Expand log"}
        </Button>
      </div>
      <div data-slot="live-log-lines" ref={scroller}>
        {lines.map((line, i) => (
          // The log is append-only, so a line's place is its identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <div key={i} data-slot="log-line">
            <time>{line.time}</time>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Drawer({
  ticket,
  lines,
  prefs,
  onPrefs,
  onClose,
}: {
  ticket: TicketView;
  lines: readonly LogLine[] | null;
  prefs: BoardPrefs;
  onPrefs: (prefs: BoardPrefs) => void;
  onClose: () => void;
}) {
  const mode = sidebarMode(prefs);
  const building = ticket.column === "building";
  return (
    <section
      data-slot="drawer"
      aria-label="Ticket drawer"
      data-ticket={ticket.id}
    >
      <header>
        <div data-slot="drawer-bar">
          <code>{ticket.id}</code>
          {ticket.running ? <LiveDot /> : null}
          <Button data-slot="drawer-close" onClick={onClose}>
            Close
          </Button>
        </div>
        <h2 data-slot="drawer-title">{ticket.title}</h2>
      </header>
      <div data-slot="drawer-body">
        <div data-slot="drawer-main">
          {building ? (
            <LiveLog
              lines={lines ?? []}
              expanded={prefs.logExpanded}
              onToggle={() =>
                onPrefs({ ...prefs, logExpanded: !prefs.logExpanded })
              }
            />
          ) : null}
          <div
            data-slot="ticket-text"
            // The renderer escapes every piece of text before it adds a tag.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by the renderer
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(ticket.text, noCards),
            }}
          />
        </div>
        {mode === "hidden" ? null : (
          <aside
            data-slot="drawer-side"
            data-mode={mode}
            aria-label="Ticket details"
          >
            <Button
              data-slot="side-toggle"
              aria-pressed={mode === "rail"}
              title={mode === "rail" ? "Open the sidebar" : "Fold the sidebar"}
              onClick={() =>
                onPrefs({ ...prefs, sidebarFolded: !prefs.sidebarFolded })
              }
            >
              {mode === "rail" ? "‹" : "›"}
            </Button>
            {mode === "full" ? <Sidebar ticket={ticket} /> : null}
          </aside>
        )}
      </div>
    </section>
  );
}

export function Board({
  board,
  lines,
  selected,
  prefs,
  onSelect,
  onPrefs,
}: {
  board: BoardView | null;
  /** The log lines of the open ticket, or null when none is read. */
  lines: readonly LogLine[] | null;
  selected: string | null;
  prefs: BoardPrefs;
  onSelect: (id: string | null) => void;
  onPrefs: (prefs: BoardPrefs) => void;
}) {
  if (board === null) return <p>Reading the board…</p>;
  const all = COLUMNS.flatMap(({ column }) => board.columns[column]);
  const open = all.find((t) => t.id === selected) ?? null;
  return (
    <div data-slot="board-page">
      <div data-slot="board" data-drawer={open ? "open" : undefined}>
        {COLUMNS.map(({ column, label }) => (
          <section
            key={column}
            data-slot="column"
            data-column={column}
            aria-label={label}
          >
            <h3>
              {label}{" "}
              <span data-slot="column-count">
                {board.columns[column].length}
              </span>
            </h3>
            <div data-slot="column-list">
              {board.columns[column].map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  open={ticket.id === open?.id}
                  onSelect={(id) => onSelect(id === open?.id ? null : id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {open ? (
        <Drawer
          ticket={open}
          lines={lines}
          prefs={prefs}
          onPrefs={onPrefs}
          onClose={() => onSelect(null)}
        />
      ) : null}
    </div>
  );
}
