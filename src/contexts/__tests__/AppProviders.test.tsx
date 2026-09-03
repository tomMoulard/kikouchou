/**
 * AppProviders Tests
 *
 * `AppProviders` composes eight providers. The only thing worth asserting about
 * it is that each one is actually mounted, and that they are nested in the order
 * the app depends on — a test that merely renders a child passes for
 * `({ children }) => <>{children}</>`, which is to say for a version of this
 * file with every provider deleted.
 *
 * The probe below reads every context. Contexts in this repo throw when read
 * outside their provider, so a missing provider fails the render rather than
 * quietly yielding a default — and nesting order is enforced the same way,
 * because each trip-scoped provider reads `useTripContext()` itself.
 *
 * @module contexts/__tests__/AppProviders.test
 */

import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { render, screen, waitFor, isoDate } from '@/test/utils';
import { AppProviders } from '../AppProviders';
import { useTripContext } from '@/contexts/TripContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useActivityContext } from '@/contexts/ActivityContext';
import { useAuth } from '@/features/auth/AuthContext';
import { useYjsContext } from '@/lib/yjs/YjsProvider';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { setCurrentTrip } from '@/lib/db/repositories/settings-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import type { TripId } from '@/types';

// ============================================================================
// Probes
// ============================================================================

/**
 * Reads every context `AppProviders` is supposed to mount and reports what it
 * found. Any provider that is missing makes this component throw during render.
 */
function ContextProbe(): ReactElement {
  const auth = useAuth();
  const { trips, currentTrip } = useTripContext();
  const { rooms } = useRoomContext();
  const { persons } = usePersonContext();
  const { assignments } = useAssignmentContext();
  const { transports } = useTransportContext();
  const { activities } = useActivityContext();

  return (
    <dl>
      <dd data-testid="auth">{String(auth.isResolved)}</dd>
      <dd data-testid="trips">{String(trips.length)}</dd>
      <dd data-testid="current-trip">{currentTrip?.name ?? 'none'}</dd>
      <dd data-testid="rooms">{String(rooms.length)}</dd>
      <dd data-testid="persons">{String(persons.length)}</dd>
      <dd data-testid="assignments">{String(assignments.length)}</dd>
      <dd data-testid="transports">{String(transports.length)}</dd>
      <dd data-testid="activities">{String(activities.length)}</dd>
    </dl>
  );
}

/**
 * Reports the Y.Doc `YjsTripSync` opens for the selected trip.
 * `useYjsContext` returns null rather than throwing, so this reports 'none'
 * when the sync layer is missing instead of failing the render.
 */
function YjsProbe(): ReactElement {
  const yjs = useYjsContext();
  return <span data-testid="yjs-trip">{yjs?.tripId ?? 'none'}</span>;
}

// ============================================================================
// Fixtures
// ============================================================================

async function seedSelectedTrip(name = 'Composed Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  await setCurrentTrip(trip.id);
  return trip.id;
}

function renderWithinAppProviders(children: ReactNode) {
  return render(<AppProviders>{children}</AppProviders>, {
    withProviders: false,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('AppProviders', () => {
  it('mounts every context provider, each readable from a child', async () => {
    renderWithinAppProviders(<ContextProbe />);

    // Reaching the DOM at all means no context hook threw, which is to say
    // every provider on the list is mounted above the child.
    await waitFor(() => {
      expect(screen.getByTestId('auth')).toHaveTextContent('true');
    });

    for (const testId of [
      'trips',
      'rooms',
      'persons',
      'assignments',
      'transports',
      'activities',
    ]) {
      expect(screen.getByTestId(testId)).toHaveTextContent('0');
    }
    expect(screen.getByTestId('current-trip')).toHaveTextContent('none');
  });

  it('nests the trip-scoped providers inside TripProvider, so they see the selected trip', async () => {
    const tripId = await seedSelectedTrip('Brittany');
    await createRoom(tripId, { name: 'Master bedroom', capacity: 2 });
    await createRoom(tripId, { name: 'Attic', capacity: 3 });

    renderWithinAppProviders(<ContextProbe />);

    // The trip reaches TripProvider...
    await waitFor(() => {
      expect(screen.getByTestId('current-trip')).toHaveTextContent('Brittany');
    });

    // ...and RoomProvider, nested inside it, scopes its live query to that trip.
    // A RoomProvider mounted above TripProvider could not do this; it would
    // throw on its own useTripContext() call instead.
    await waitFor(() => {
      expect(screen.getByTestId('rooms')).toHaveTextContent('2');
    });
  });

  it('mounts YjsTripSync innermost, opening the current trip document around children', async () => {
    const tripId = await seedSelectedTrip('Synced Trip');

    renderWithinAppProviders(<YjsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('yjs-trip')).toHaveTextContent(tripId);
    });
  });

  it('renders children exactly once, in order, with no wrapper markup of its own', () => {
    const { container } = renderWithinAppProviders(
      <>
        <span data-testid="a">A</span>
        <span data-testid="b">B</span>
      </>,
    );

    expect(screen.getAllByTestId('a')).toHaveLength(1);
    expect(container.textContent).toBe('AB');
  });
});
