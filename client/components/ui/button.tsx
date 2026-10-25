import type * as React from "react";
import { cn } from "../../lib/utils";

function Button({
  className,
  variant = "outline",
  ...props
}: React.ComponentProps<"button"> & { variant?: "default" | "outline" }) {
  return (
    <button
      type="button"
      data-slot="button"
      className={cn(
        "rounded-md border border-border px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50",
        variant === "default"
          ? "bg-primary text-primary-foreground"
          : "bg-background",
        className,
      )}
      {...props}
    />
  );
}

export { Button };
