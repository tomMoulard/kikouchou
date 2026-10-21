/**
 * @fileoverview The guest overview read through the real French bundle.
 *
 * The sibling test mocks `t` to return each inline English default, so it
 * cannot tell one key from another: a key that points nowhere still renders the
 * English default. Every line here is the French one, which only the right key
 * can produce.
 *
 * @module features/calendar/components/__tests__/GuestOverviewSection.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fr } from 'date-fns/locale';

import { renderWithRealI18n } from '@/test/utils';
import type {
  ActivityId,
  HexColor,
  ISODateString,
  Person,
  PersonId,
  RoomAssignmentId,
  RoomId,
  TransportId,
  TripId,
} from '@/types';

import { GuestOverviewSection } from '../GuestOverviewSection';
import type { GuestOverview } from '../../utils/guest-overview';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Helpers
// ============================================================================

const person: Person = {
  id: 'person-1' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Alice',
  color: '#3b82f6' as HexColor,
};

function makeOverview(overrides: Partial<GuestOverview> = {}): GuestOverview {
  return {
    person,
    checkIn: null,
    checkOut: null,
    stays: [],
    transports: [],
    activities: [],
    balance: undefined,
    currency: 'EUR',
    ...overrides,
  };
}

async function renderInFrench(overview: GuestOverview): Promise<void> {
  await renderWithRealI18n(<GuestOverviewSection overview={overview} dateLocale={fr} />, {
    language: 'fr',
    withProviders: false,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('GuestOverviewSection in French', () => {
  it('reads a guest with a room, travel and an activity', async () => {
    await renderInFrench(
      makeOverview({
        stays: [
          {
            assignment: {
              id: 'a1' as RoomAssignmentId,
              tripId: 'trip-1' as TripId,
              roomId: 'room-gone' as RoomId,
              personId: person.id,
              startDate: '2026-01-10' as ISODateString,
              endDate: '2026-01-12' as ISODateString,
            },
            room: undefined,
          },
        ],
        transports: [
          {
            id: 'leg-1' as TransportId,
            tripId: 'trip-1' as TripId,
            personId: person.id,
            type: 'arrival',
            datetime: '2026-01-10T14:30:00',
            location: '',
            needsPickup: false,
          },
        ],
        activities: [
          {
            id: 'activity-1' as ActivityId,
            tripId: 'trip-1' as TripId,
            title: 'Fête des plantes',
            category: 'horticulture',
            startDatetime: '2026-01-11T09:00:00',
            allDay: false,
            participantIds: [person.id],
          },
        ],
        balance: { personId: person.id, paid: 0, owed: 12, balance: -12 },
      }),
    );

    expect(screen.getByRole('heading', { name: 'À propos de Alice' })).toBeInTheDocument();
    expect(screen.getByText('Arrivée')).toBeInTheDocument();
    expect(screen.getByText('Départ')).toBeInTheDocument();
    // No check-in, no check-out, no room name, no place: four unknowns.
    expect(screen.getAllByText('Inconnu')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Chambres' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Autres trajets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activités' })).toBeInTheDocument();
    expect(screen.getByText(/Doit au groupe/)).toBeInTheDocument();
  });

  it('reads the money lines and the empty notes', async () => {
    await renderInFrench(
      makeOverview({ balance: { personId: person.id, paid: 20, owed: 5, balance: 15 } }),
    );

    expect(screen.getByText(/Le groupe lui doit/)).toBeInTheDocument();
    expect(screen.getByText('Rien d’autre de prévu pour cet invité')).toBeInTheDocument();
    expect(screen.getByText('Aucun trajet enregistré')).toBeInTheDocument();
  });

  it('tells a settled guest from one on no money line', async () => {
    await renderInFrench(
      makeOverview({ balance: { personId: person.id, paid: 5, owed: 5, balance: 0 } }),
    );
    expect(screen.getByText('À jour avec le groupe')).toBeInTheDocument();
  });

  it('dates the check-in and check-out in French', async () => {
    await renderInFrench(
      makeOverview({
        checkIn: '2026-01-10' as ISODateString,
        checkOut: '2026-01-13' as ISODateString,
      }),
    );

    expect(screen.getByText('10 janvier 2026')).toBeInTheDocument();
    expect(screen.getByText('13 janvier 2026')).toBeInTheDocument();
  });

  it('says when a guest is on no money line', async () => {
    await renderInFrench(makeOverview());
    expect(screen.getByText('Aucune dépense pour le moment')).toBeInTheDocument();
  });
});
