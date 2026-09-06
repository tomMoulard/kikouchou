/**
 * @fileoverview Tests for the shared `?scope=` filter.
 *
 * Three behaviours here are the difference between a filter and a bug report:
 *
 * - the scope is clamped to `all` whenever nobody is identified, **including**
 *   the beat before the identity has resolved, so a navigation never flashes an
 *   empty list and a shared `?scope=mine` link never blanks a stranger's page;
 * - the default is `mine` for somebody the app can name, which is the whole
 *   point of the feature;
 * - the cars are resolved from every transport on the trip, not from the rows
 *   the caller happens to be showing — the map hands it a coordinate-filtered
 *   list, and resolving from that would drop the caller's own leg out of the
 *   car and take the rest of the car off the map with it.
 *
 * @module features/transports/hooks/__tests__/useTransportScope.test
 */

import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { act, renderHook } from '@/test/utils';
import { useTransportScope } from '../useTransportScope';
import { useTripIdentity } from '@/hooks';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import type {
  Person,
  PersonId,
  Ride,
  RideId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/hooks', () => ({ useTripIdentity: vi.fn() }));
vi.mock('@/contexts/PersonContext', () => ({ usePersonContext: vi.fn() }));
vi.mock('@/contexts/RideContext', () => ({ useRideContext: vi.fn() }));
vi.mock('@/contexts/TransportContext', () => ({ useTransportContext: vi.fn() }));

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId,
  TOM_ID = 'person-tom' as PersonId,
  ALICE_ID = 'person-alice' as PersonId,
  RIDE_ID = 'ride-1' as RideId;

function makePerson(id: PersonId, name: string): Person {
  return { id, tripId: TRIP_ID, name, color: '#3b82f6' as Person['color'] };
}

function makeTransport(
  id: string,
  personId: PersonId,
  overrides: Partial<Transport> = {},
): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId,
    type: 'arrival',
    datetime: '2026-07-15T15:00:00.000Z',
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    ...overrides,
  };
}

const RIDE: Ride = {
  id: RIDE_ID,
  tripId: TRIP_ID,
  direction: 'pickup',
  meetDatetime: '2026-07-15T15:00:00.000Z',
  location: 'Lyon Part-Dieu',
  driverId: TOM_ID,
};

const MY_LEG = makeTransport('t-tom', TOM_ID),
  THEIR_LEG = makeTransport('t-alice', ALICE_ID),
  /** Alice's second leg, in the car Tom drives. */
  IN_MY_CAR = makeTransport('t-alice-car', ALICE_ID, { rideId: RIDE_ID });

const ALL_TRANSPORTS = [MY_LEG, THEIR_LEG, IN_MY_CAR];

/** Renders the hook under a router, at the given URL. */
function renderScope(
  candidates: readonly Transport[] = ALL_TRANSPORTS,
  initialUrl = '/trips/trip-1/transports',
) {
  function Wrapper({ children }: { readonly children: ReactNode }): ReactElement {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>;
  }

  return renderHook(() => useTransportScope(candidates), { wrapper: Wrapper });
}

/** Sets what the identity hook answers for a test. */
function mockIdentity(
  myPersonId: PersonId | undefined,
  isResolved = true,
): void {
  vi.mocked(useTripIdentity).mockReturnValue({
    myPersonId,
    source: myPersonId === undefined ? undefined : 'explicit',
    isResolved,
    setMyPersonId: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePersonContext).mockReturnValue({
    persons: [makePerson(TOM_ID, 'Tom'), makePerson(ALICE_ID, 'Alice')],
  } as unknown as ReturnType<typeof usePersonContext>);
  vi.mocked(useRideContext).mockReturnValue({
    rides: [RIDE],
    vehicles: [],
  } as unknown as ReturnType<typeof useRideContext>);
  vi.mocked(useTransportContext).mockReturnValue({
    arrivals: ALL_TRANSPORTS,
    departures: [],
  } as unknown as ReturnType<typeof useTransportContext>);
  mockIdentity(TOM_ID);
});

// ============================================================================
// Tests
// ============================================================================

describe('useTransportScope', () => {
  it('defaults to "mine" once the app knows who is holding the device', () => {
    const { result } = renderScope();

    expect(result.current.scope).toBe('mine');
    expect(result.current.canFilter).toBe(true);
    expect(result.current.visibleTransports.map((row) => row.id)).toEqual([
      't-tom',
      't-alice-car',
    ]);
    expect(result.current.hiddenCount).toBe(1);
  });

  it('honours an explicit ?scope=all', () => {
    const { result } = renderScope(ALL_TRANSPORTS, '/t?scope=all');

    expect(result.current.scope).toBe('all');
    expect(result.current.visibleTransports).toHaveLength(3);
    expect(result.current.hiddenCount).toBe(0);
  });

  it('refuses ?scope=mine when nobody is identified', () => {
    // A shared link carrying `?scope=mine` must not blank the page of somebody
    // the app cannot name.
    mockIdentity(undefined);

    const { result } = renderScope(ALL_TRANSPORTS, '/t?scope=mine');

    expect(result.current.scope).toBe('all');
    expect(result.current.canFilter).toBe(false);
    expect(result.current.visibleTransports).toHaveLength(3);
    expect(result.current.hiddenCount).toBe(0);
  });

  it('shows everything while the identity is still resolving', () => {
    // `isResolved: false` is "still looking", not "nobody" — filtering here is
    // what would flash an empty list on every navigation.
    mockIdentity(TOM_ID, false);

    const { result } = renderScope();

    expect(result.current.scope).toBe('all');
    expect(result.current.canFilter).toBe(false);
    expect(result.current.visibleTransports).toHaveLength(3);
  });

  it('writes the choice to the URL, where a reload can read it back', () => {
    const { result } = renderScope();

    act(() => {
      result.current.setScope('all');
    });

    // The scope is derived from the search parameter, so seeing it change is
    // seeing the parameter written.
    expect(result.current.scope).toBe('all');
    expect(result.current.visibleTransports).toHaveLength(3);
  });

  it('resolves cars from the whole trip, not from the rows it was handed', () => {
    // The map's case: Tom's own leg carries no coordinates, so it is not among
    // the candidates. His car must still be his — otherwise Alice's leg, which
    // is pinned, disappears along with it.
    const pinnedOnly = [IN_MY_CAR, THEIR_LEG];
    vi.mocked(useRideContext).mockReturnValue({
      rides: [{ ...RIDE, driverId: undefined }],
      vehicles: [],
    } as unknown as ReturnType<typeof useRideContext>);
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [{ ...MY_LEG, rideId: RIDE_ID }, THEIR_LEG, IN_MY_CAR],
      departures: [],
    } as unknown as ReturnType<typeof useTransportContext>);

    const { result } = renderScope(pinnedOnly);

    expect(result.current.visibleTransports.map((row) => row.id)).toEqual([
      't-alice-car',
    ]);
    expect(result.current.hiddenCount).toBe(1);
  });
});
