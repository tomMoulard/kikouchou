/**
 * @fileoverview The activity pill read through the real French bundle.
 *
 * Under the suite-wide mock the pill's accessible name is its bare key, so the
 * title, category and participant count it interpolates are never checked.
 * The French bundle spells all three out.
 *
 * @module features/calendar/components/__tests__/ActivityIndicator.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithRealI18n } from '@/test/utils';
import type { Activity, ActivityId, HexColor, PersonId, TripId } from '@/types';

import { ActivityIndicator } from '../ActivityIndicator';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1' as ActivityId,
    tripId: 'trip-1' as TripId,
    title: 'Pique-nique',
    category: 'meal',
    startDatetime: '2026-07-15T12:00:00',
    allDay: false,
    participantIds: ['p1' as PersonId, 'p2' as PersonId],
    ...overrides,
  };
}

async function renderPill(activity: Activity): Promise<void> {
  await renderWithRealI18n(
    <ActivityIndicator
      activity={{ activity, color: '#e11d48' as HexColor, isSpanStart: true, isSpanEnd: true }}
      onClick={vi.fn()}
    />,
    { language: 'fr', withProviders: false },
  );
}

describe('ActivityIndicator in French', () => {
  it('names the activity, its category and how many have signed up', async () => {
    await renderPill(makeActivity());

    expect(
      screen.getByRole('button', { name: "Voir l'activité Pique-nique (Repas), 2 participants" }),
    ).toBeInTheDocument();
  });

  it('counts nobody when the activity carries no participant list', async () => {
    await renderPill({ ...makeActivity(), participantIds: undefined } as unknown as Activity);

    expect(
      screen.getByRole('button', { name: "Voir l'activité Pique-nique (Repas), 0 participants" }),
    ).toBeInTheDocument();
  });
});
