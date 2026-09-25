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
        "flex items-center gap-2 text-[12px] leading-none font-medium text-neutral-600 select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-45 peer-disabled:cursor-not-allowed peer-disabled:opacity-45",
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
