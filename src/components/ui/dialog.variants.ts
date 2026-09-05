/**
 * @fileoverview Shared class strings for the modal primitives.
 *
 * Split out of `dialog.tsx` the same way `button.variants.ts` is split out of
 * `button.tsx`: `dialog.tsx`, `alert-dialog.tsx` and `sheet.tsx` all dress the
 * same Radix dialog, and a second copy of these strings is a second place for
 * the next fix to miss.
 *
 * @module components/ui/dialog.variants
 */

/** Backdrop behind every modal. */
export const dialogOverlayClassName =
  // eslint-disable-next-line kikouchou/no-raw-palette-class -- shadcn's scrim. A backdrop darkens whatever is behind it in both themes; a theme token would make the dark-mode overlay invisible.
  'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0';

/**
 * The modal box itself.
 *
 * Horizontal: inset + mx-auto avoids translate-x clipping with overflow-x-hidden
 * and wide children.
 *
 * Vertical: the box is centred on the viewport, so one taller than the viewport
 * clips off BOTH edges at once with no way to reach either. The cap lives here
 * rather than at each call site because 14 of the 20 call sites forgot it, and a
 * call site can still override it (`cn()` merges last-wins). `dvh` rather than
 * `vh` so a mobile browser's URL bar cannot push the footer out of reach.
 *
 * The box itself never scrolls — `dialogBodyClassName` below does. That is also
 * why the cap works for the call sites that pass their own `overflow-hidden`
 * (the map dialog, the QR importer): their class lands here and clips this box,
 * while the body one level in still scrolls.
 */
export const dialogContentClassName =
  'fixed inset-x-4 top-1/2 z-50 mx-auto flex h-auto max-h-[calc(100dvh-2rem)] min-h-0 w-full min-w-0 max-w-lg -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg';

/**
 * The scrolling part: everything the caller put inside the dialog.
 *
 * The overflow lives here rather than on the box itself for one reason — the
 * close button. It is absolutely positioned against the box, and an absolutely
 * positioned child of a scroll container scrolls away with the content, so a
 * box that scrolled its own body carried its close button off the top exactly
 * when the dialog was tall enough to need one. With the scrolling one level in,
 * the button stays pinned to the corner at every scroll position.
 *
 * `[gap:inherit]` rather than a fixed `gap-4`: the gap belongs to the caller,
 * who sets it on `DialogContent` (`gap-0` in ShareDialog), and `inherit` is
 * what carries their value through the wrapper this adds.
 *
 * `flex-1 min-h-0` so it takes the height the cap leaves it and no more, which
 * is what gives `flex-1` children of the dialog somewhere to scroll.
 */
export const dialogBodyClassName =
  'flex w-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain [gap:inherit]';

/**
 * The corner close button of `DialogContent` and `SheetContent`.
 *
 * Three deliberate deviations from stock shadcn — keep them if `shadcn add` ever
 * regenerates either file:
 *  1. `size-11` (44px), `md:size-9`: stock renders a bare 16px icon with no box
 *     around it, which is under the 44px mobile touch target and under WCAG
 *     2.5.8's 24px minimum. The offsets keep the icon's optical centre roughly
 *     where stock put it.
 *  2. `focus-visible:` instead of stock's `focus:`, which leaves a ring hanging
 *     around after a plain mouse click.
 *  3. A hover background, so the enlarged hit area reads as a button rather than
 *     as 44px of nothing.
 */
export const dialogCloseButtonClassName =
  "absolute top-1 right-1 inline-flex size-11 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:bg-accent hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground md:top-2 md:right-2 md:size-9 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

/** Header block of a dialog, alert dialog or sheet. */
export const dialogHeaderClassName =
  'flex min-w-0 flex-col gap-2 text-center sm:text-left';

/** Footer block of a dialog or alert dialog. */
export const dialogFooterClassName =
  'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';
