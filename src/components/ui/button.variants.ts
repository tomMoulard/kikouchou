import { cva } from "class-variance-authority"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          // eslint-disable-next-line kikouchou/no-raw-palette-class -- shadcn ships `text-white` here: the label sits on the destructive fill in both themes, so it must not follow `--foreground`.
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        // NON-STOCK: `xs` / `icon-xs` / `icon-sm` / `icon-lg` do not exist in
        // shadcn's button. Keep them if `shadcn add button` is ever re-run.
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        /*
          NON-STOCK, and the reason this file exists as a deviation.

          Stock shadcn is a flat `size-9` — 36px, under the 44px minimum touch
          target every mobile platform asks for, on what is the *only* edit and
          delete affordance on most cards in this app. That had been patched ad
          hoc with `size-11 md:size-8` at about ten call sites and missed
          everywhere else, so the rule now lives here instead.

          Read `max-md:size-11` as a HARD FLOOR, not a default. Because it
          carries a variant prefix, tailwind-merge keeps it alongside any
          unprefixed size a call site passes, and Tailwind emits variants after
          plain utilities — so below `md` it wins over `size-8`, `size-10` and
          even `size-auto`. That is deliberate: a floor a call site can cancel
          by accident is not a floor. To go smaller than 44px on a phone a call
          site has to say so in the same breakpoint range (`max-md:size-8`),
          which is loud enough to be noticed in review.

          `size-11 md:size-9` was the other candidate and is worse: an
          unprefixed override such as `components/ui/calendar.tsx`'s `size-auto`
          cancels the `size-11` but not the `md:size-9`, which then re-applies
          at desktop and breaks a layout the author thought they controlled.

          Two known consequences, both intended. The date picker's day buttons
          (`ui/calendar.tsx`, `size-auto w-full`) become 44px squares below
          `md`, which grows a six-week month to about 332px wide — right for a
          touch target, tight below a 340px viewport. And `PersonListPage`'s
          delete button reaches 44px on a phone despite its own `size-8`.
        */
        icon: "size-9 max-md:size-11",
        // The deliberate opt-out: an inline chip inside dense text, never a
        // primary affordance. Below the touch minimum by design.
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        /*
          Same floor, so below `md` these collapse into `icon` — a three-step
          desktop scale becomes one step on a phone, which is the point: 32px is
          32px whatever the desktop design wanted. Neither has a call site yet.

          The text sizes above are deliberately untouched. `default` (36),
          `sm` (32), `lg` (40) and `xs` (24) are all under 44px tall too, but a
          text button's hit area is its full width, and giving every form button
          in the app a taller mobile height is a visual change to nearly every
          page — a separate decision from fixing the icon buttons and menu rows
          that had no hit area to spare in either direction.
        */
        "icon-sm": "size-8 max-md:size-11",
        "icon-lg": "size-10 max-md:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)
