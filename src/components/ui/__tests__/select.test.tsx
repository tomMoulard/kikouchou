/**
 * @fileoverview Component tests for the Select primitive's touch target.
 *
 * These pin the one deliberate deviation from stock shadcn in `select.tsx`, so
 * a later `shadcn add select` that regenerates the file cannot silently revert
 * it: an option row tall enough to hit with a thumb.
 *
 * The floor is expressed as `max-md:min-h-11` rather than the more obvious
 * `min-h-11 md:min-h-0`, and that choice is the thing most likely to be
 * "simplified" away by someone who does not know why. So the tests below do
 * not merely assert that a floor exists — they assert the *shape* of it: that
 * it survives an unprefixed class from the call site, that it leaves desktop
 * untouched, and that opting out takes a same-breakpoint override. Each of
 * those fails if the utility is rewritten in the obvious form.
 *
 * The rendered pixel height is asserted in `e2e/touch-targets.spec.ts`, which
 * is the only place a real stylesheet exists. jsdom computes no Tailwind, so a
 * class assertion is all this layer can honestly make.
 *
 * @module components/ui/__tests__/select.test
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ============================================================================
// Setup
// ============================================================================

/**
 * The DOM APIs Radix's Select reaches for that jsdom does not implement.
 *
 * Without these the open content throws rather than rendering, and every
 * assertion below would fail for a reason that has nothing to do with the
 * class it is checking.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= (): boolean => false;
  Element.prototype.setPointerCapture ??= (): void => undefined;
  Element.prototype.releasePointerCapture ??= (): void => undefined;
  Element.prototype.scrollIntoView ??= (): void => undefined;
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Renders an open select with a single option, and hands back that option.
 *
 * @param className - What a call site would pass to `SelectItem`, if anything
 * @returns The rendered option element
 */
function renderOption(className?: string): HTMLElement {
  render(
    <Select open value="paris">
      <SelectTrigger aria-label="Destination">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="paris" className={className}>
          Paris
        </SelectItem>
      </SelectContent>
    </Select>,
  );

  return screen.getByRole('option', { name: 'Paris' });
}

/**
 * Every `min-height` utility surviving on an element, variant prefix included.
 *
 * Lets a test say "these are all of them" rather than "this one is present",
 * which is the difference between catching a leftover floor and not.
 *
 * @param element - The element to read `class` from
 * @returns The matching class names, in DOM order
 */
function minHeightUtilitiesOf(element: HTMLElement): readonly string[] {
  return element.className
    .split(/\s+/)
    .filter((candidate) => /(?:^|:)min-h-/.test(candidate));
}

// ============================================================================
// Tests
// ============================================================================

describe('SelectItem touch target', () => {
  it('carries a 44px floor on phones, which stock shadcn does not', () => {
    const option = renderOption();

    // Stock is `py-1.5 text-sm` and nothing else: 6 + 20 + 6 = a 32px row, on
    // the control used to pick a guest, a transport mode and a language across
    // eight surfaces — the guest-onboarding wizard included.
    expect(option).toHaveClass('max-md:min-h-11');
  });

  it('leaves desktop exactly stock, with no unprefixed height of its own', () => {
    const option = renderOption();

    // The floor must not leak past `md`. An unprefixed `min-h-11` here would
    // make every select in the app 44px-per-row on a 1440px screen, which is a
    // visual change to eight surfaces that nobody asked for.
    expect(option.className).not.toMatch(/(?:^|\s)min-h-/);
    expect(option.className).not.toMatch(/(?:^|\s)h-/);
  });

  it('is written as `max-md:` and not as `min-h-11 md:min-h-0`', () => {
    const option = renderOption();

    // The obvious form is the trap, and this assertion is what stops someone
    // reintroducing it. `md:min-h-0` survives a call site cancelling the
    // unprefixed base — tailwind-merge groups them separately — so the desktop
    // half re-applies on its own. `ui/calendar.tsx` passing `size-auto` to a
    // button is the case that proved it; the same hazard applies here.
    expect(option.className).not.toMatch(/md:min-h-0/);
  });

  it('survives an unprefixed height from the call site, so it is a floor', () => {
    const option = renderOption('min-h-0');

    // tailwind-merge keeps a variant-prefixed utility alongside an unprefixed
    // one of the same group, so `min-h-0` cannot cancel this. That is the
    // whole point: a floor a call site can drop by accident is not a floor.
    expect(option).toHaveClass('max-md:min-h-11');
    expect(option).toHaveClass('min-h-0');
  });

  it('still wins over a fixed height, because min-height outranks height', () => {
    const option = renderOption('h-8');

    // Both classes survive the merge. In the cascade `min-height` beats
    // `height`, so below `md` the row is 44px regardless of the `h-8`.
    expect(option).toHaveClass('max-md:min-h-11');
    expect(option).toHaveClass('h-8');
  });

  it('lets a call site opt out only in the same breakpoint range', () => {
    const option = renderOption('max-md:min-h-8');

    // The deliberate escape hatch. Same variant, same group, so tailwind-merge
    // resolves it and the call site's value wins — but it had to name `max-md`
    // to do it, which is loud enough to be caught in review.
    //
    // Asserted as "these are ALL the min-height utilities on the element", not
    // as "the opt-out is present": the weaker form passes on an unprefixed
    // `min-h-11` floor too, which `max-md:min-h-8` cannot cancel — the opt-out
    // would be silently dead and the test still green.
    expect(minHeightUtilitiesOf(option)).toEqual(['max-md:min-h-8']);
  });

  it('keeps the row centred rather than growing its padding', () => {
    const option = renderOption();

    // `min-h` plus `items-center` is why desktop is untouched. Had the fix
    // been more padding, the desktop row would have grown too.
    expect(option).toHaveClass('py-1.5');
    expect(option).toHaveClass('items-center');
  });
});
