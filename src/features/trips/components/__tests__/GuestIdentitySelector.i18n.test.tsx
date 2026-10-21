/**
 * @fileoverview The "which guest am I?" card's confirmation, read in English.
 *
 * The suite-wide i18n mock returns the key and drops the options, so it cannot
 * tell whether the confirmation names the guest. The real catalogue can.
 *
 * @module features/trips/components/__tests__/GuestIdentitySelector.i18n.test
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';
import type { Person, Trip } from '@/types';

import { GuestIdentitySelector } from '../GuestIdentitySelector';

vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Test doubles
// ============================================================================

const trip = {
  id: 'trip-1',
  shareId: 'share-1',
  name: 'Test Trip',
  startDate: '2026-07-01',
  endDate: '2026-07-10',
  createdAt: 1,
  updatedAt: 1,
} as unknown as Trip;

const paul = { id: 'person-paul', tripId: 'trip-1', name: 'Paul', color: '#3b82f6' } as unknown as Person;

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: trip }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({ persons: [paul], isLoading: false }),
}));

vi.mock('@/hooks/useTripIdentity', () => ({
  useTripIdentity: () => ({ setMyPersonId: () => Promise.resolve() }),
}));

vi.mock('@/lib/sharing/guest-identity', () => ({
  getTripGuestPersonId: () => undefined,
  writeGuestIdentity: () => true,
  clearGuestIdentity: () => true,
}));

const mockNotifySuccess = vi.fn();
vi.mock('@/lib/notifications', () => ({
  notify: { success: (...args: unknown[]) => mockNotifySuccess(...args), error: vi.fn() },
}));

/** Radix Select needs these and jsdom has none of them. */
const shimmed = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'];

beforeAll(() => {
  const element = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  for (const name of shimmed) {
    element[name] = () => false;
  }
});

afterAll(() => {
  const element = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  for (const name of shimmed) {
    Reflect.deleteProperty(element, name);
  }
});

// ============================================================================
// Tests
// ============================================================================

describe('GuestIdentitySelector in English', () => {
  it('names the guest the browser now is', async () => {
    const { user } = await renderWithRealI18n(<GuestIdentitySelector />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('combobox', { name: 'Who you are' }));
    await user.click(await screen.findByRole('option', { name: 'Paul' }));

    await vi.waitFor(() => {
      expect(mockNotifySuccess).toHaveBeenCalledWith('You are Paul on this trip');
    });
  });
});
