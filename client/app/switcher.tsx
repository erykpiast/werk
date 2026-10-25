import { useState } from "react";
import { pickOf, type SwitcherRow, stopQuestion } from "../lib/switcher";

/**
 * The project switcher at the left of header row 1: the open project's name with a menu arrow, a menu of every
 * project, then a divider and "Add project…" (#werk-projects-switcher).
 */
export function Switcher({
  current,
  rows,
  running,
  onOpen,
  onRemove,
  onAdd,
}: {
  current: string | null;
  rows: readonly SwitcherRow[];
  /** The running turns of each project, to name in the question before a remove. */
  running: (name: string) => string[];
  onOpen: (name: string) => void;
  onRemove: (name: string, confirm: boolean) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div data-slot="switcher">
      <button
        type="button"
        data-slot="switcher-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {current ?? "No project"} ▾
      </button>
      {open ? (
        <div data-slot="switcher-menu">
          {rows.map((row) => (
            <div
              key={row.name}
              data-slot="switcher-row"
              data-missing={row.missing || undefined}
              data-busy={row.busy || undefined}
              data-dead={row.dead || undefined}
            >
              <button
                type="button"
                aria-disabled={row.missing || undefined}
                onClick={() => {
                  const pick = pickOf(row, current);
                  if (pick === "refuse") return;
                  close();
                  if (pick === "open") onOpen(row.name);
                }}
              >
                <span data-slot="busy-dot" aria-hidden="true">
                  {row.dead || row.busy ? "●" : ""}
                </span>
                <span data-slot="switcher-name">{row.name}</span>
                <span data-slot="switcher-folder">{row.folder}</span>
                {row.missing ? <em>(missing)</em> : null}
                {row.dead ? <em data-slot="dead-mark">(dead)</em> : null}
              </button>
              {row.removable ? (
                <button
                  type="button"
                  data-slot="switcher-remove"
                  aria-label={`Remove ${row.name}`}
                  onClick={() => {
                    const turns = running(row.name);
                    if (turns.length > 0) {
                      if (!window.confirm(stopQuestion(row.name, turns)))
                        return;
                      onRemove(row.name, true);
                    } else {
                      onRemove(row.name, false);
                    }
                    close();
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          <hr data-slot="switcher-divider" />
          <div>
            <button
              type="button"
              onClick={() => {
                close();
                onAdd();
              }}
            >
              + Add project…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
