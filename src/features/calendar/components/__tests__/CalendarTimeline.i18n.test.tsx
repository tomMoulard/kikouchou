/**
 * @fileoverview The calendar timeline read through the real French bundle.
 *
 * The sibling test mocks `t` to return each inline English default, which
 * cannot tell one key from another. Every label here is the French one, which
 * only the right key produces.
 *
 * @module features/calendar/components/__tests__/CalendarTimeline.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fr } from 'date-fns/locale';

import { renderWithRealI18n } from '@/test/utils';
import type {
  Activity,
  ActivityId,
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Transport,
  TransportId,
  Trip,
  TripId,
} from '@/types';

import { CalendarTimeline } from '../CalendarTimeline';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Helpers
// ============================================================================

const trip: Trip = {
  id: 'trip-1' as TripId,
  shareId: 'share-1' as Trip['shareId'],
  name: 'Séjour',
  startDate: '2026-01-05' as ISODateString,
  endDate: '2026-01-10' as ISODateString,
  createdAt: 0,
  updatedAt: 0,
};

const nameless: Person = {
  id: 'p1' as PersonId,
  tripId: trip.id,
  name: '',
  color: '#3b82f6' as HexColor,
  headcount: 2,
};

// Offset-less, so its day does not move with the runner. The day before the
// trip, so the axis has a column outside it.
const earlyArrival: Transport = {
  id: 'leg-1' as TransportId,
  tripId: trip.id,
  personId: nameless.id,
  type: 'arrival',
  datetime: '2026-01-04T10:00:00',
  location: 'Gare',
  needsPickup: false,
};

const activity: Activity = {
  id: 'activity-1' as ActivityId,
  tripId: trip.id,
  title: 'Fête des plantes',
  category: 'horticulture',
  startDatetime: '2026-01-07T10:00:00',
  allDay: false,
  participantIds: [],
};

function baseProps() {
  return {
    trip,
    persons: [] as Person[],
    rooms: [],
    assignments: [],
    arrivals: [] as Transport[],
    departures: [] as Transport[],
    activities: [] as Activity[],
    dateLocale: fr,
    today: new Date(2026, 0, 7),
    onAssignmentClick: vi.fn(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('CalendarTimeline in French', () => {
  it('names the frame, its columns, its rows and the agenda', async () => {
    await renderWithRealI18n(
      <CalendarTimeline
        {...baseProps()}
        persons={[nameless]}
        arrivals={[earlyArrival]}
        activities={[activity]}
        onActivityClick={vi.fn()}
      />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByRole('region', { name: 'Calendrier en chronologie' })).toBeInTheDocument();
    expect(screen.getByText('Invités')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Lignes de chronologie' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Planning' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /mercredi 7 janvier 2026\s*Aujourd'hui/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Jardins & plantes')).toBeInTheDocument();
    expect(screen.getAllByTitle(/Hors des dates du voyage/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('timeline-now-marker')).toHaveAttribute('title', 'Heure actuelle');
    expect(screen.getAllByTitle('2 personnes sur place').length).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: 'Chronologie de Inconnu' })).toBeInTheDocument();
  });

  it('names the scrollbar of a trip too long for the screen', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);

    await renderWithRealI18n(
      <CalendarTimeline
        {...baseProps()}
        trip={{ ...trip, endDate: '2026-02-14' as ISODateString }}
        persons={[nameless]}
      />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByRole('slider', { name: 'Faire défiler la frise' })).toBeInTheDocument();
  });

  it('says there is nothing yet, and offers the two first steps', async () => {
    await renderWithRealI18n(
      <CalendarTimeline {...baseProps()} onAddGuests={vi.fn()} onAddRooms={vi.fn()} />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByText('Rien de prévu pour l’instant')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Rien de prévu pour cette période. Les chambres et transports apparaîtront ici',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter des invités' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter des chambres' })).toBeInTheDocument();
  });
});
