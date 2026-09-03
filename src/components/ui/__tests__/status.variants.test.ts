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

/** Any Tailwind palette shade — what this module exists to keep out. */
const RAW_PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?\b/;

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

  it('paints a solid fill with the matching on-fill foreground', () => {
    expect(statusVariants({ tone: 'warning', emphasis: 'solid' })).toBe(
      'bg-warning text-warning-foreground',
    );
    expect(statusVariants({ tone: 'danger', emphasis: 'solid' })).toBe(
      'bg-destructive text-destructive-foreground',
    );
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
