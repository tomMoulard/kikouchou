/**
 * @fileoverview The glyph each activity category is drawn with.
 *
 * The module is loaded inside the first test: its category table is built at
 * load time, and Stryker can only test a mutant in load-time code against the
 * test that was running when the module loaded.
 *
 * @module components/shared/__tests__/ActivityCategoryIcon.test
 */

import { describe, expect, it } from 'vitest';

import { render } from '@/test/utils';

import type { ActivityCategory } from '@/types';

describe('ActivityCategoryIcon', () => {
  it('draws every category with its own glyph, and anything else as a party', async () => {
    const { ActivityCategoryIcon } = await import('../ActivityCategoryIcon');
    const glyphs: ReadonlyArray<readonly [ActivityCategory | undefined, string]> = [
      ['horticulture', 'lucide-sprout'],
      ['visit', 'lucide-landmark'],
      ['hike', 'lucide-footprints'],
      ['beach', 'lucide-waves'],
      ['sport', 'lucide-bike'],
      ['meal', 'lucide-utensils-crossed'],
      ['culture', 'lucide-music'],
      ['market', 'lucide-shopping-basket'],
      ['workshop', 'lucide-hammer'],
      ['other', 'lucide-party-popper'],
      [undefined, 'lucide-party-popper'],
      ['unknown-from-sync' as ActivityCategory, 'lucide-party-popper'],
    ];

    for (const [category, glyph] of glyphs) {
      const { container, unmount } = render(<ActivityCategoryIcon category={category} />, {
        withProviders: false,
      });
      expect(container.querySelector('svg'), String(category)).toHaveClass(glyph, 'size-4', 'shrink-0');
      unmount();
    }
  });

  it('is decorative unless it is given a name', async () => {
    const { ActivityCategoryIcon } = await import('../ActivityCategoryIcon');

    const decorative = render(<ActivityCategoryIcon category="hike" className="extra" />, {
      withProviders: false,
    });
    const icon = decorative.container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).not.toHaveAttribute('aria-label');
    expect(icon).toHaveClass('extra');
    decorative.unmount();

    const named = render(
      <ActivityCategoryIcon category="hike" aria-label="Hike" style={{ color: 'rgb(1, 2, 3)' }} />,
      { withProviders: false },
    );
    const label = named.container.querySelector('svg');
    expect(label).toHaveAttribute('aria-label', 'Hike');
    expect(label).toHaveAttribute('aria-hidden', 'false');
    expect(label?.style.color).toBe('rgb(1, 2, 3)');
  });
});
