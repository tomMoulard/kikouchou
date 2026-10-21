/**
 * @fileoverview The read-only card's name and title, through the shipped
 * French catalogue.
 *
 * The sibling file's translator prints the English fallback, which equals the
 * English catalogue, so only another language can show that the card reads its
 * title from the catalogue rather than from the fallback.
 *
 * @module components/shared/__tests__/ViewerUnlockCard.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';
import { useTripContext } from '@/contexts/TripContext';
import { useAuth } from '@/features/auth/AuthContext';

import { ViewerUnlockCard } from '../ViewerUnlockCard';

// Hoisted above the imports: the real i18next, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/auth/components/SignInDialog', () => ({ SignInDialog: () => null }));

describe('ViewerUnlockCard in French', () => {
  it('names the card and titles it from the catalogue', async () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: { id: 'trip-1', name: 'Bretagne', viewerToken: 'tokentokentoken1' },
    } as never);
    vi.mocked(useAuth).mockReturnValue({ isAvailable: true, isResolved: true, user: null } as never);

    await renderWithRealI18n(<ViewerUnlockCard />, { language: 'fr', withProviders: false });

    const region = screen.getByRole('region', { name: 'Lecture seule' });
    expect(region.querySelector('[data-slot="card-title"]')).toHaveTextContent('Lecture seule');
  });
});
