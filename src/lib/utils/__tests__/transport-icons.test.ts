/**
 * @fileoverview Tests for the shared transport-mode icon mapping.
 *
 * @module lib/utils/__tests__/transport-icons.test
 */

import { describe, expect, it } from 'vitest';

import { TRANSPORT_MODE_ICONS, getTransportModeIcon } from '@/lib/utils/transport-icons';
import type { TransportMode } from '@/types';

const MODES: readonly TransportMode[] = ['plane', 'train', 'car', 'bus', 'other'];

describe('getTransportModeIcon', () => {
  it.each(MODES)('returns the mapped icon for %s', (mode) => {
    expect(getTransportModeIcon(mode)).toBe(TRANSPORT_MODE_ICONS[mode]);
  });

  it('gives every mode a distinct icon', () => {
    const icons = new Set(MODES.map((mode) => getTransportModeIcon(mode)));
    expect(icons.size).toBe(MODES.length);
  });

  it('falls back to the "other" icon for an absent or unknown mode', () => {
    expect(getTransportModeIcon(undefined)).toBe(TRANSPORT_MODE_ICONS.other);
    // A row written by a build that knew a mode this one does not.
    expect(getTransportModeIcon('ferry' as TransportMode)).toBe(TRANSPORT_MODE_ICONS.other);
  });
});
