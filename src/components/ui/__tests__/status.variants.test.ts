/**
 * @fileoverview Tests for the status colour variants.
 *
 * The point of `statusVariants` is that a status meaning has exactly one
 * spelling, so these tests assert the mapping itself: every tone/emphasis pair
 * resolves to semantic tokens, and none of them smuggles a raw palette shade
 * back in.
 *
 * @module components/ui/__tests__/status.variants.test
 */

import { describe, expect, it } from 'vitest';

import {
  STATUS_EMPHASES,
  STATUS_TONES,
  onboardingSurface,
  statusVariants,
} from '@/components/ui/status.variants';
import type { TransportType } from '@/types';

// The same regex the `kikouchou/no-raw-palette-class` ESLint rule matches on.
// Imported rather than restated: if this test and the lint rule disagreed about
// what a palette shade is, whichever ran second would be the one that mattered.
import { RAW_PALETTE } from '../../../../eslint-rules/raw-palette.js';

describe('statusVariants', () => {
  it('resolves every tone and emphasis to semantic tokens only', () => {
    for (const tone of STATUS_TONES) {
      for (const emphasis of STATUS_EMPHASES) {
        const classes = statusVariants({ tone, emphasis });
        expect(classes, `${tone}/${emphasis} is empty`).not.toBe('');
        expect(classes, `${tone}/${emphasis} leaked a raw shade`).not.toMatch(
          RAW_PALETTE,
        );
      }
    }
  });

  it('paints a solid fill with the matching on-fill foreground and its own hover', () => {
    expect(statusVariants({ tone: 'warning', emphasis: 'solid' })).toBe(
      'bg-warning text-warning-foreground hover:bg-warning/90',
    );
    expect(statusVariants({ tone: 'danger', emphasis: 'solid' })).toBe(
      'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    );
  });

  it('carries a hover on every solid tone, so no call site hand-writes one', () => {
    for (const tone of STATUS_TONES) {
      expect(
        statusVariants({ tone, emphasis: 'solid' }),
        `${tone}/solid has no hover`,
      ).toMatch(/hover:bg-/);
    }
  });

  it('gives soft a text colour and surface none, so containers do not tint children', () => {
    const soft = statusVariants({ tone: 'warning', emphasis: 'soft' });
    const surface = statusVariants({ tone: 'warning', emphasis: 'surface' });

    expect(soft).toContain('text-warning-on-surface');
    expect(soft).toContain('bg-warning-surface');
    expect(surface).toContain('bg-warning-surface');
    expect(surface).not.toContain('text-');
  });

  it('treats arrival as the success green and departure as its own orange', () => {
    expect(statusVariants({ tone: 'arrival', emphasis: 'text' })).toBe(
      statusVariants({ tone: 'success', emphasis: 'text' }),
    );
    expect(statusVariants({ tone: 'departure', emphasis: 'text' })).toBe(
      'text-departure-on-surface',
    );
  });

  it('accepts a TransportType directly as the tone', () => {
    const type: TransportType = 'departure';
    expect(statusVariants({ tone: type, emphasis: 'text' })).toBe(
      'text-departure-on-surface',
    );
  });

  it('defaults to a neutral soft panel', () => {
    expect(statusVariants()).toBe(
      statusVariants({ tone: 'neutral', emphasis: 'soft' }),
    );
  });

  it('builds the onboarding backdrop from status surfaces', () => {
    expect(onboardingSurface).not.toMatch(RAW_PALETTE);
    expect(onboardingSurface).toContain('from-warning-surface');
    expect(onboardingSurface).toContain('to-departure-surface');
  });
});
