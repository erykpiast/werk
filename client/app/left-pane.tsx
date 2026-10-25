import { Button } from "../components/ui/button";
import type { MapState } from "../lib/map-store";
import { MapView } from "./map-view";

/**
 * The left pane: a sticky header of two rows over a body that shows one view (#vi-layout).
 * Row 1 holds the scope. Row 2 holds the controls: views on the left, the channel on the right.
 */
export function LeftPane({ map }: { map: MapState }) {
  return (
    <section
      aria-label="Map pane"
      className="flex min-w-0 flex-1 flex-col overflow-y-auto"
    >
      <header className="sticky top-0 border-b border-border bg-background">
        <div data-slot="header-row-1" className="px-4 py-2 text-sm">
          {map.open ? `#${map.open.id}` : "werk"}
        </div>
        <div
          data-slot="header-row-2"
          className="flex items-center justify-between px-4 py-1"
        >
          <div data-slot="header-left" className="flex gap-1">
            <Button variant="ghost" size="sm" aria-pressed="true">
              Map
            </Button>
          </div>
          <div
            data-slot="header-right"
            className="text-xs text-muted-foreground"
          >
            {map.connection}
          </div>
        </div>
      </header>
      <div data-slot="body">
        <MapView map={map} />
      </div>
    </section>
  );
}
