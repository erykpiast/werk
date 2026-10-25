import type { Chip, DeadLine } from "../lib/chat-tabs";

/** The chips of the tab strip. A dead tab's chip blinks red (#werk-mc-asks-dot). */
export function TabStrip({
  chips,
  onSelect,
  onOpen,
}: {
  chips: Chip[];
  onSelect: (tab: string) => void;
  onOpen: () => void;
}) {
  return (
    <div data-slot="tab-strip">
      {chips.map((chip) => (
        <button
          key={chip.tab}
          type="button"
          data-slot="tab-chip"
          data-current={chip.current || undefined}
          data-blink={chip.blink ?? undefined}
          onClick={() => onSelect(chip.tab)}
        >
          {chip.tab}
        </button>
      ))}
      <button
        type="button"
        data-slot="tab-new"
        aria-label="New conversation"
        onClick={onOpen}
      >
        +
      </button>
    </div>
  );
}

/** One line for each other tab that is dead, naming the tab and its error (#werk-mc-live-line). */
export function DeadLines({ lines }: { lines: DeadLine[] }) {
  return (
    <>
      {lines.map(({ tab, line }) => (
        <div key={tab} data-slot="dead-line">
          {tab} stopped: {line}
        </div>
      ))}
    </>
  );
}

/** The whole error of the shown tab, above its composer. */
export function OwnError({ error }: { error: string | null }) {
  return error === null ? null : <pre data-slot="dead-error">{error}</pre>;
}
