import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

// Broadsheet input: newsprint fill, hairline ink border, 2px corners, ink
// caret and a 2px ink focus outline. 14px to sit level with the .btn.
function Input({
  className,
  type,
  ...props
}) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-sm caret-foreground transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[color-mix(in_srgb,var(--foreground)_45%,transparent)] focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive",
        // Numeric entry (importes, cantidades, folios) aligns in columns.
        "[&[inputmode=decimal]]:text-right [&[inputmode=numeric]]:text-right [&[type=date]]:tabular-nums [&[type=number]]:text-right",
        className
      )}
      {...props} />
  );
}

// The app's filled field: kicker label stacked over a borderless value, the
// whole thing a soft-rounded tile on the panel.
function InputTile({
  className,
  label,
  children,
  ...props
}) {
  return (
    <label
      data-slot="input-tile"
      className={cn(
        "block rounded-[16px] bg-background px-4 py-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
        className
      )}
      {...props}>
      <span
        className="block text-[10px] tracking-[0.1em] uppercase text-[color-mix(in_srgb,var(--foreground)_50%,transparent)]">
        {label}
      </span>
      {children}
    </label>
  );
}

// The value inside an InputTile — no box of its own.
function InputBare({
  className,
  type,
  ...props
}) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input-bare"
      className={cn(
        "mt-0.5 h-auto w-full border-0 bg-transparent p-0 text-base leading-snug outline-none placeholder:text-[color-mix(in_srgb,var(--foreground)_40%,transparent)] disabled:opacity-45",
        className
      )}
      {...props} />
  );
}

export { Input, InputTile, InputBare }
