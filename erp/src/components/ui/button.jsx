import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

// Broadsheet: the serif is the chrome. Ink fills, 2px corners, no colored
// states, no lift on press, and a 2px ink focus outline instead of a ring.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent bg-clip-padding font-heading text-sm font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Solid ink — the app's only "filled" action.
        default:
          "bg-primary text-primary-foreground hover:bg-neutral-800 active:bg-neutral-900",
        // Quiet ink tints, the app's secondary/ghost pattern.
        secondary:
          "bg-secondary text-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_7%,var(--secondary))] active:bg-[color-mix(in_srgb,var(--foreground)_14%,var(--secondary))]",
        outline:
          "border-border text-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] active:bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)]",
        ghost:
          "px-1.5 text-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] active:bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)]",
        destructive:
          "bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] text-destructive hover:bg-[color-mix(in_srgb,var(--destructive)_18%,transparent)] focus-visible:outline-destructive",
        link: "text-foreground underline-offset-[3px] hover:underline",
      },
      size: {
        // Heights match the design system's .btn (36px) and .input pair.
        default: "h-9 px-4",
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 px-5 text-[0.95rem]",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
        // The app's bubble-nav / status pills.
        pill: "h-9 rounded-full px-4",
        "pill-icon": "size-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props} />
  );
}

export { Button, buttonVariants }
