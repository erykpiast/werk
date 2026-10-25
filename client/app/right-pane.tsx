import type { ReactNode } from "react";

/** The right pane: one slot, the full height of the screen (#vi-layout). */
export function RightPane({ children }: { children?: ReactNode }) {
  return (
    <aside
      aria-label="Chat pane"
      data-slot="right-pane"
      className="flex flex-1 flex-col justify-end p-3"
    >
      {children}
    </aside>
  );
}
