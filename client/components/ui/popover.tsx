import type * as React from "react";
import { cn } from "../../lib/utils";

/** A box that floats above its trigger. The parent decides when it is open. */
function Popover({
  className,
  ...props
}: React.ComponentProps<"div"> & { role?: string }) {
  return (
    <div
      data-slot="popover"
      className={cn(
        "absolute bottom-full right-0 z-10 mb-1 flex min-w-40 flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm shadow-md",
        className,
      )}
      {...props}
    />
  );
}

export { Popover };
