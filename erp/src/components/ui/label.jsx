import * as React from "react"

import { cn } from "@/lib/utils"

// Broadsheet label: the app writes field names as small caps kickers, not
// sentence-case bold sans.
function Label({
  className,
  ...props
}) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-[10px] leading-none font-normal tracking-[0.1em] uppercase text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-45 peer-disabled:cursor-not-allowed peer-disabled:opacity-45",
        className
      )}
      {...props} />
  );
}

// For the cases that need a full-size serif label (checkbox/radio rows,
// section questions) rather than a kicker.
function LabelPlain({
  className,
  ...props
}) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 font-heading text-sm leading-none font-semibold text-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-45 peer-disabled:cursor-not-allowed peer-disabled:opacity-45",
        className
      )}
      {...props} />
  );
}

export { Label, LabelPlain }
