/**
 * @fileoverview The event detail dialog read through the real French bundle.
 *
 * The sibling test mocks `t` to return each inline English default, which
 * cannot tell one key from another: a key that points nowhere still renders
 * the English default. Every label here is the French one, which only the
 * right key produces.
 *
 * @module features/calendar/components/__tests__/EventDetailDialog.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';

import { renderWithRealI18n } from '@/test/utils';
import { resolveRides } from '@/features/transports/utils/ride-model';
import type {
  Activity,
  ActivityId,
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Ride,
  RideId,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

import { EventDetailDialog, type CalendarEventData } from '../EventDetailDialog';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

const mockReportFailure = vi.fn();
vi.mock('@/lib/errors/report-failure', () => ({
  reportFailure: (...args: unknown[]) => mockReportFailure(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

const alice: Person = {
  id: 'p1' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Alice',
  color: '#3b82f6' as HexColor,
};

const bruno: Person = { ...alice, id: 'p2' as PersonId, name: 'Bruno' };

function makeLeg(overrides: Partial<Transport> = {}): Transport {
  return {
    id: 'leg-1' as TransportId,
    tripId: 'trip-1' as TripId,
    personId: alice.id,
    type: 'arrival',
    datetime: '2026-01-10T14:30:00.000Z',
    location: 'Gare',
    needsPickup: false,
    transportMode: 'plane',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1' as ActivityId,
    tripId: 'trip-1' as TripId,
    title: 'Fête des plantes',
    category: 'horticulture',
    startDatetime: '2026-01-11T09:00:00',
    allDay: true,
    participantIds: [alice.id],
    ...overrides,
  };
}

async function renderInFrench(
  event: CalendarEventData | null,
  onDelete: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  return renderWithRealI18n(
    <EventDetailDialog
      open
      onOpenChange={vi.fn()}
      event={event}
      onEdit={vi.fn()}
      onDelete={onDelete}
    />,
    { language: 'fr', withProviders: false },
  );
}

/** Opens the delete prompt and returns it. */
async function openDeletePrompt(
  user: Awaited<ReturnType<typeof renderInFrench>>['user'],
): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Supprimer' }));
  return screen.findByRole('alertdialog');
}

// ============================================================================
// Tests
// ============================================================================

describe('EventDetailDialog in French', () => {
  it('says it is loading while there is no event', async () => {
    await renderInFrench(null);

    expect(screen.getByText('Chargement...')).toBeInTheDocument();
  });

  it('reads a stay with its travel, and asks before removing it', async () => {
    const { user } = await renderInFrench({
      type: 'assignment',
      assignment: {
        id: 'a1' as RoomAssignmentId,
        tripId: 'trip-1' as TripId,
        roomId: 'r1' as RoomId,
        personId: alice.id,
        startDate: '2026-01-10' as ISODateString,
        endDate: '2026-01-13' as ISODateString,
      },
      person: undefined,
      room: undefined,
      relatedTransports: [
        makeLeg(),
        makeLeg({ id: 'leg-2' as TransportId, type: 'departure', transportMode: undefined }),
      ],
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Attribution des chambres' })).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription("Détails de l'événement");
    expect(within(dialog).getAllByText('Inconnu')).toHaveLength(2);
    expect(within(dialog).getByText('3 nuits')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Déplacements' })).toBeInTheDocument();
    expect(within(dialog).getByText(/↓/)).toHaveTextContent('↓ Arrivée');
    expect(within(dialog).getByText(/↑/)).toHaveTextContent('↑ Départ');
    expect(within(dialog).getByText('Avion')).toBeInTheDocument();
    expect(within(dialog).getByText('Autre')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();

    const prompt = await openDeletePrompt(user);
    expect(within(prompt).getByText('Retirer cette attribution ?')).toBeInTheDocument();
    expect(
      within(prompt).getByText(
        'Le participant sera désattribué de cette chambre pour les dates sélectionnées.',
      ),
    ).toBeInTheDocument();
  });

  it('dates a stay in the reader language, and follows a switch of language', async () => {
    const { i18n } = await renderInFrench({
      type: 'assignment',
      assignment: {
        id: 'a1' as RoomAssignmentId,
        tripId: 'trip-1' as TripId,
        roomId: 'r1' as RoomId,
        personId: alice.id,
        startDate: '2026-01-10' as ISODateString,
        endDate: '2026-01-13' as ISODateString,
      },
      person: alice,
      room: undefined,
    });

    expect(screen.getByText('10 janvier 2026 → 13 janvier 2026')).toBeInTheDocument();

    // The instance is shared by every French render in the file, so it goes
    // back to French whatever the assertion does.
    try {
      await act(async () => {
        await i18n.changeLanguage('en');
      });

      expect(screen.getByText('January 10th, 2026 → January 13th, 2026')).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage('fr');
      });
    }
  });

  it('reads a departure with its driver and pickup, and asks before deleting it', async () => {
    const { user } = await renderInFrench({
      type: 'transport',
      transport: makeLeg({ type: 'departure', transportMode: undefined, needsPickup: true }),
      person: undefined,
      driver: bruno,
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Départ/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Inconnu')).toBeInTheDocument();
    expect(within(dialog).getByText('Autre')).toBeInTheDocument();
    expect(within(dialog).getByText('Chauffeur:')).toBeInTheDocument();
    expect(within(dialog).getByText('Nécessite un transport')).toBeInTheDocument();

    const prompt = await openDeletePrompt(user);
    expect(within(prompt).getByText('Supprimer ce transport ?')).toBeInTheDocument();
    expect(within(prompt).getByText('Ce transport sera définitivement supprimé.')).toBeInTheDocument();
  });

  it('heads the car that serves an arrival', async () => {
    const ride: Ride = {
      id: 'ride-1' as RideId,
      tripId: 'trip-1' as TripId,
      direction: 'pickup',
      meetDatetime: '2026-01-10T14:45:00.000Z',
      location: 'Gare',
      driverId: bruno.id,
    };
    const leg = makeLeg({ rideId: ride.id });
    const [journey] = resolveRides({
      transports: [leg],
      rides: [ride],
      vehicles: [],
      persons: [alice, bruno],
    });

    await renderInFrench({
      type: 'transport',
      transport: leg,
      person: alice,
      ride: journey,
      persons: [alice, bruno],
    });

    expect(screen.getByRole('heading', { name: /Arrivée/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trajet' })).toBeInTheDocument();
  });

  it('reads an activity, full, with its organiser, and asks before deleting it', async () => {
    const { user } = await renderInFrench({
      type: 'activity',
      activity: makeActivity({ maxParticipants: 1 }),
      participants: [alice],
      organizer: bruno,
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Jardins & plantes')).toBeInTheDocument();
    expect(within(dialog).getByText('Journée entière')).toBeInTheDocument();
    expect(within(dialog).getByText('Complet')).toBeInTheDocument();
    expect(within(dialog).getByText('Organisateur:')).toBeInTheDocument();

    const prompt = await openDeletePrompt(user);
    expect(within(prompt).getByText("Supprimer l'activité ?")).toBeInTheDocument();
    expect(
      within(prompt).getByText(
        "Cette activité sera retirée de l'agenda du voyage. Cette action est irréversible.",
      ),
    ).toBeInTheDocument();
  });

  it('counts the participants of an activity with no cap, and says when there are none', async () => {
    await renderInFrench({
      type: 'activity',
      activity: makeActivity({ participantIds: [] }),
      participants: [],
    });

    expect(screen.getByText('0 participant')).toBeInTheDocument();
    expect(screen.getByText("Personne ne s'est encore inscrit")).toBeInTheDocument();
  });

  it('reports a failed delete in French', async () => {
    const failure = new Error('offline');
    const { user } = await renderInFrench(
      {
        type: 'transport',
        transport: makeLeg(),
        person: alice,
      },
      vi.fn().mockRejectedValue(failure),
    );

    const prompt = await openDeletePrompt(user);
    await user.click(within(prompt).getByRole('button', { name: 'Supprimer' }));

    await waitFor(() => {
      expect(mockReportFailure).toHaveBeenCalledWith(
        'EventDetailDialog.handleConfirmDelete',
        failure,
        'Échec de la suppression',
      );
    });
  });
});
