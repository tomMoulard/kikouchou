/**
 * @fileoverview Component tests for the Command primitive's touch target.
 *
 * These pin the one deliberate deviation from stock shadcn in `command.tsx`,
 * so a later `shadcn add command` cannot silently revert it.
 *
 * Unlike the identical floor in `select.tsx` and `dropdown-menu.tsx`, this one
 * is latent: both current call sites in `LocationAutocomplete` pass
 * `className="flex items-start gap-3 py-2"` over two lines of content, so no
 * command row on screen today was ever 32px. It is fixed anyway so the next
 * call site — a single-line row that passes no padding — does not have to
 * rediscover the rule. That makes the "a call site's own padding still wins"
 * test below the load-bearing one here: the floor must not change what the
 * existing rows look like.
 *
 * The rendered pixel height lives in `e2e/touch-targets.spec.ts`; jsdom
 * computes no Tailwind, so a class assertion is all this layer can honestly
 * make.
 *
 * @module components/ui/__tests__/command.test
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Command, CommandItem, CommandList } from '@/components/ui/command';

// ============================================================================
// Setup
// ============================================================================

/**
 * The DOM API cmdk reaches for that jsdom does not implement.
 *
 * cmdk scrolls the selected row into view on mount. Without this the render
 * throws and every assertion below would fail for a reason unrelated to the
 * class it is checking.
 */
beforeAll(() => {
  Element.prototype.scrollIntoView ??= (): void => undefined;
});

// ============================================================================
// Constants
// ============================================================================

/**
 * Exactly what `LocationAutocomplete` passes at both of its call sites.
 *
 * Copied verbatim so that if those call sites change, the test that proves the
 * floor does not disturb them is checking the wrong string and can be updated
 * deliberately rather than drifting quietly.
 */
const LOCATION_AUTOCOMPLETE_CLASSNAME = 'flex items-start gap-3 py-2';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Renders a command list with a single row, and hands back that row.
 *
 * @param className - What a call site would pass to `CommandItem`, if anything
 * @returns The rendered option element
 */
function renderItem(className?: string): HTMLElement {
  render(
    <Command>
      <CommandList>
        <CommandItem value="paris" className={className}>
          Paris
        </CommandItem>
      </CommandList>
    </Command>,
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

describe('CommandItem touch target', () => {
  it('carries a 44px floor on phones, which stock shadcn does not', () => {
    const item = renderItem();

    // Stock is `px-2 py-1.5 text-sm`: 6 + 20 + 6 = a 32px row.
    expect(item).toHaveClass('max-md:min-h-11');
  });

  it('leaves desktop exactly stock, with no unprefixed height of its own', () => {
    const item = renderItem();

    expect(item.className).not.toMatch(/(?:^|\s)min-h-/);
    expect(item.className).not.toMatch(/(?:^|\s)h-/);
  });

  it('is written as `max-md:` and not as `min-h-11 md:min-h-0`', () => {
    const item = renderItem();

    // The obvious form is the trap: `md:min-h-0` survives a call site
    // cancelling the unprefixed base, and re-applies past the breakpoint on
    // its own. See the comment on the constant in `command.tsx`.
    expect(item.className).not.toMatch(/md:min-h-0/);
  });

  it('does not disturb the padding the existing call sites pass', () => {
    const item = renderItem(LOCATION_AUTOCOMPLETE_CLASSNAME);

    // The reason this fix is safe to make while it is still latent. `py-2`
    // beats the stock `py-1.5` through tailwind-merge as it always did, the
    // floor is additive, and a two-line row is already past 44px so the
    // `min-h` never binds.
    expect(item).toHaveClass('py-2');
    expect(item.className).not.toMatch(/py-1\.5/);
    expect(item).toHaveClass('items-start');
    expect(item).toHaveClass('max-md:min-h-11');
  });

  it('survives an unprefixed height from the call site, so it is a floor', () => {
    const item = renderItem('min-h-0');

    // tailwind-merge keeps a variant-prefixed utility alongside an unprefixed
    // one of the same group, so `min-h-0` cannot cancel this.
    expect(item).toHaveClass('max-md:min-h-11');
    expect(item).toHaveClass('min-h-0');
  });

  it('lets a call site opt out only in the same breakpoint range', () => {
    const item = renderItem('max-md:min-h-8');

    // "These are ALL the min-height utilities", not "the opt-out is present":
    // the weaker form passes on an unprefixed `min-h-11` floor too, which
    // `max-md:min-h-8` cannot cancel — the opt-out would be silently dead and
    // the test still green.
    expect(minHeightUtilitiesOf(item)).toEqual(['max-md:min-h-8']);
  });
});
