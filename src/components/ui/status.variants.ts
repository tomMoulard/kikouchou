/**
 * @fileoverview Status colour variants.
 *
 * `DESIGN_BOARD_BRIEF.md` §5 defines a real status palette — green = arrival /
 * success / online, orange = departure, amber = warning / offline reassurance /
 * pickups / guest onboarding, red = destructive / errors. That meaning was real
 * but unencapsulated: "this is a warning" was spelled as four different amber
 * backgrounds, four amber text shades, four amber border weights and an amber
 * ring across the app, and nothing stopped the next variation. This is the one
 * place that mapping lives.
 *
 * The classes resolve to the semantic tokens in `src/index.css`, so the palette
 * follows the theme (including dark mode) instead of hardcoding a shade.
 *
 * Colour is never the only carrier of meaning — pair `arrival`/`departure` with
 * the ↓/↑ icons, and a warning or error with its text, exactly as before.
 *
 * @module components/ui/status.variants
 */

import { cva } from "class-variance-authority"

/**
 * The status meanings the design brief defines, plus a `neutral` escape hatch
 * for "no status" rows that still want the same shape.
 *
 * `arrival` and `success` are the same green by design; they are separate names
 * so a call site can say what it means (`tone={transport.type}` reads better
 * than mapping arrival onto "success" at every use).
 */
export const STATUS_TONES = [
  "arrival",
  "departure",
  "success",
  "warning",
  "danger",
  "neutral",
] as const

/** A status meaning from {@link STATUS_TONES}. */
export type StatusTone = (typeof STATUS_TONES)[number]

/** How loudly a tone is drawn. */
export const STATUS_EMPHASES = [
  "solid",
  "soft",
  "surface",
  "outline",
  "text",
] as const

/** A drawing strength from {@link STATUS_EMPHASES}. */
export type StatusEmphasis = (typeof STATUS_EMPHASES)[number]

/**
 * Status colours for panels, badges, buttons, icons and text.
 *
 * - `solid` — filled, with its own hover: a status button, a legend dot, a
 *   progress bar fill.
 * - `soft` — tinted panel that also tints its text: callouts, badges, alerts.
 * - `surface` — the same tint and border but no text colour, for a container
 *   whose children set their own (a card holding a name, a time and a button).
 * - `outline` — status border on a transparent background: outline badges.
 * - `text` — text and icon tint only, readable on `background`/`card`.
 *
 * Put the result FIRST in `cn()` when the call site also sets `border-2` or its
 * own background: `soft`/`surface` emit a plain `border`, and `tailwind-merge`
 * lets the last class in the list win.
 *
 * @example
 * <div className={cn(statusVariants({ tone: 'warning' }), 'rounded-xl p-4')}>
 */
export const statusVariants = cva("", {
  variants: {
    tone: {
      arrival: "",
      departure: "",
      success: "",
      warning: "",
      danger: "",
      neutral: "",
    },
    emphasis: {
      solid: "",
      soft: "border",
      surface: "border",
      outline: "border bg-transparent",
      text: "",
    },
  },
  compoundVariants: [
    // green — arrival / success / online
    {
      tone: ["arrival", "success"],
      emphasis: "solid",
      class: "bg-success text-success-foreground hover:bg-success/90",
    },
    {
      tone: ["arrival", "success"],
      emphasis: "soft",
      class: "border-success-border bg-success-surface text-success-on-surface",
    },
    {
      tone: ["arrival", "success"],
      emphasis: "surface",
      class: "border-success-border bg-success-surface",
    },
    {
      tone: ["arrival", "success"],
      emphasis: "outline",
      class: "border-success text-success-on-surface",
    },
    {
      tone: ["arrival", "success"],
      emphasis: "text",
      class: "text-success-on-surface",
    },

    // orange — departure
    {
      tone: "departure",
      emphasis: "solid",
      class: "bg-departure text-departure-foreground hover:bg-departure/90",
    },
    {
      tone: "departure",
      emphasis: "soft",
      class:
        "border-departure-border bg-departure-surface text-departure-on-surface",
    },
    {
      tone: "departure",
      emphasis: "surface",
      class: "border-departure-border bg-departure-surface",
    },
    {
      tone: "departure",
      emphasis: "outline",
      class: "border-departure text-departure-on-surface",
    },
    {
      tone: "departure",
      emphasis: "text",
      class: "text-departure-on-surface",
    },

    // amber — warning / offline reassurance / pickups / guest onboarding
    {
      tone: "warning",
      emphasis: "solid",
      class: "bg-warning text-warning-foreground hover:bg-warning/90",
    },
    {
      tone: "warning",
      emphasis: "soft",
      class: "border-warning-border bg-warning-surface text-warning-on-surface",
    },
    {
      tone: "warning",
      emphasis: "surface",
      class: "border-warning-border bg-warning-surface",
    },
    {
      tone: "warning",
      emphasis: "outline",
      class: "border-warning text-warning-on-surface",
    },
    {
      tone: "warning",
      emphasis: "text",
      class: "text-warning-on-surface",
    },

    // red — destructive / errors
    {
      tone: "danger",
      emphasis: "solid",
      class: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    },
    {
      tone: "danger",
      emphasis: "soft",
      class:
        "border-destructive-border bg-destructive-surface text-destructive-on-surface",
    },
    {
      tone: "danger",
      emphasis: "surface",
      class: "border-destructive-border bg-destructive-surface",
    },
    {
      tone: "danger",
      emphasis: "outline",
      class: "border-destructive text-destructive-on-surface",
    },
    {
      tone: "danger",
      emphasis: "text",
      class: "text-destructive-on-surface",
    },

    // no status — the same shapes, in the theme's own neutrals
    {
      tone: "neutral",
      emphasis: "solid",
      class: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    },
    {
      tone: "neutral",
      emphasis: "soft",
      class: "border-border bg-muted text-muted-foreground",
    },
    {
      tone: "neutral",
      emphasis: "surface",
      class: "border-border bg-muted",
    },
    {
      tone: "neutral",
      emphasis: "outline",
      class: "border-border text-muted-foreground",
    },
    {
      tone: "neutral",
      emphasis: "text",
      class: "text-muted-foreground",
    },
  ],
  defaultVariants: {
    tone: "neutral",
    emphasis: "soft",
  },
})

/**
 * The guest-onboarding wizard's page backdrop.
 *
 * The wizard is amber-themed per the brief; this is the one place that says so,
 * rather than six pages each repeating the same hand-written amber-to-orange
 * gradient.
 */
export const onboardingSurface =
  "bg-gradient-to-b from-warning-surface to-departure-surface"
