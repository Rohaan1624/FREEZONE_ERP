import * as React from "react"

import { cn } from "@/lib/utils"

// Broadsheet panels: soft-rounded newsprint surfaces, no ring, no border —
// separation comes from the paper ground and whitespace. Matches the app's
// 22px panels at --space-6 padding.
function Card({
  className,
  size = "default",
  ...props
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-[22px] bg-card py-(--card-spacing) text-sm text-card-foreground [--card-spacing:--spacing(6)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:rounded-[16px] data-[size=sm]:[--card-spacing:--spacing(4)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-[22px] *:[img:last-child]:rounded-b-[22px]",
        className
      )}
      {...props} />
  );
}

function CardHeader({
  className,
  ...props
}) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props} />
  );
}

// The app's kicker: 10px uppercase, wide tracking, quiet ink.
function CardKicker({
  className,
  ...props
}) {
  return (
    <div
      data-slot="card-kicker"
      className={cn(
        "text-[10px] font-normal tracking-[0.1em] uppercase text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]",
        className
      )}
      {...props} />
  );
}

function CardTitle({
  className,
  ...props
}) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-[17px] leading-tight font-semibold tracking-[-0.015em] group-data-[size=sm]/card:text-[15px]",
        className
      )}
      {...props} />
  );
}

function CardDescription({
  className,
  ...props
}) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props} />
  );
}

function CardAction({
  className,
  ...props
}) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props} />
  );
}

function CardContent({
  className,
  ...props
}) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props} />
  );
}

// A figure inside a panel reads as the page ground, not a bordered strip.
function CardFooter({
  className,
  ...props
}) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "mx-(--card-spacing) mb-(--card-spacing) flex items-center gap-2 rounded-[14px] bg-background p-(--card-spacing)",
        className
      )}
      {...props} />
  );
}

// Money/quantity readouts: serif, tabular, right-aligned in columns.
function CardFigure({
  className,
  ...props
}) {
  return (
    <div
      data-slot="card-figure"
      className={cn(
        "font-heading text-[25px] leading-none font-semibold tracking-[-0.02em] tabular-nums",
        className
      )}
      {...props} />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardKicker,
  CardAction,
  CardDescription,
  CardContent,
  CardFigure,
}
