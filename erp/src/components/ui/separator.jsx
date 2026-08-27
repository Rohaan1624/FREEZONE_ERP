"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

// Broadsheet prefers whitespace to rules — use this only for genuine
// furniture (table row rules, a head rail), never to divide sections.
function Separator({
  className,
  orientation = "horizontal",
  ...props
}) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props} />
  );
}

// The front-page thick-thin pair, in full-strength ink.
function SeparatorRail({
  className,
  ...props
}) {
  return (
    <div
      data-slot="separator-rail"
      aria-hidden="true"
      className={cn("w-full", className)}
      {...props}>
      <div className="h-[3px] w-full bg-foreground" />
      <div className="mt-[3px] h-px w-full bg-foreground" />
    </div>
  );
}

export { Separator, SeparatorRail }
