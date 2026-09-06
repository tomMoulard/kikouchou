/**
 * @fileoverview Ride Context — the car journeys and the cars of the current trip.
 *
 * Rides and vehicles share one provider because nothing reads one without the
 * other: a ride card names its car, a capacity check needs the car's seats, and
 * the vehicle picker lists cars against the rides using them. Two providers
 * would mean two live queries and two re-render cascades for one screen.
 *
 * Passengers are deliberately absent from this context. Membership lives on the
 * leg (`Transport.rideId`), so the passenger list is assembled by
 * `resolveRides` from this context and `TransportContext` together — see
 * `features/transports/utils/ride-model`.
 *
 * @module contexts/RideContext
 */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useTripContext } from '@/contexts/TripContext';
import {
  areArraysEqual,
  areCoordinatesEqual,
  wrapAndSetError,
} from '@/contexts/utils';
import { db } from '@/lib/db/database';
import {
  createRide as repositoryCreateRide,
  createVehicle as repositoryCreateVehicle,
  deleteRideWithOwnershipCheck,
  deleteVehicleWithOwnershipCheck,
  setTransportRide as repositorySetTransportRide,
  updateRideWithOwnershipCheck,
  updateVehicleWithOwnershipCheck,
} from '@/lib/db';
import type {
  Ride,
  RideFormData,
  RideId,
  TransportId,
  TripId,
  Vehicle,
  VehicleFormData,
  VehicleId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Public interface for the Ride Context value. */
export interface RideContextValue {
  /** Rides for the current trip, ordered by meeting time. */
  readonly rides: readonly Ride[];

  /** Vehicles for the current trip, ordered by name. */
  readonly vehicles: readonly Vehicle[];

  /** True while either live query has yet to resolve for a selected trip. */
  readonly isLoading: boolean;

  /** The last CRUD error, or null. */
  readonly error: Error | null;

  createRide: (data: RideFormData) => Promise<Ride>;
  updateRide: (id: RideId, data: Partial<RideFormData>) => Promise<void>;
  deleteRide: (id: RideId) => Promise<void>;

  createVehicle: (data: VehicleFormData) => Promise<Vehicle>;
  updateVehicle: (id: VehicleId, data: Partial<VehicleFormData>) => Promise<void>;
  deleteVehicle: (id: VehicleId) => Promise<void>;

  /**
   * Puts a leg in a car, or takes it out when `rideId` is undefined.
   *
   * The only supported way to change who is in a car. It writes one scalar on
   * the passenger's own record, which is what lets two guests join the same
   * ride while both offline without either join being lost.
   */
  setTransportRide: (
    transportId: TransportId,
    rideId: RideId | undefined,
  ) => Promise<void>;

  /** O(1) lookup of a ride by id. */
  getRideById: (id: RideId) => Ride | undefined;

  /** O(1) lookup of a vehicle by id. */
  getVehicleById: (id: VehicleId) => Vehicle | undefined;
}

interface RideProviderProps {
  /** Child components to render within the provider */
  readonly children: ReactNode;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compares every mutable field of a ride.
 *
 * A field missing here never reaches the UI: the provider only publishes a new
 * array when this returns false, so an edit to an unlisted field is invisible
 * until some other field happens to change too. `TransportContext` carries the
 * scar from the three map fields; this list is complete and must stay so.
 */
const compareRides = (a: Ride, b: Ride): boolean =>
  a.id === b.id &&
  a.tripId === b.tripId &&
  a.direction === b.direction &&
  a.meetDatetime === b.meetDatetime &&
  a.location === b.location &&
  a.leadTimeMinutes === b.leadTimeMinutes &&
  a.driverId === b.driverId &&
  a.vehicleId === b.vehicleId &&
  a.notes === b.notes &&
  areCoordinatesEqual(a.coordinates, b.coordinates);

/** Compares every mutable field of a vehicle. See {@link compareRides}. */
const compareVehicles = (a: Vehicle, b: Vehicle): boolean =>
  a.id === b.id &&
  a.tripId === b.tripId &&
  a.name === b.name &&
  a.ownerId === b.ownerId &&
  a.isRental === b.isRental &&
  a.seatCount === b.seatCount &&
  a.luggageNotes === b.luggageNotes &&
  a.notes === b.notes &&
  areChildSeatsEqual(a.childSeats, b.childSeats);

/**
 * Order-sensitive comparison of two child-seat lists.
 *
 * Order-sensitive on purpose: the list is rendered in order, so reordering it
 * is a visible change even though the tally is identical.
 */
function areChildSeatsEqual(
  a: Vehicle['childSeats'],
  b: Vehicle['childSeats'],
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined || a.length !== b.length) {
    return false;
  }
  return a.every((kind, index) => kind === b[index]);
}

const areRidesEqual = (a: Ride[], b: Ride[]): boolean =>
  areArraysEqual(a, b, compareRides);

const areVehiclesEqual = (a: Vehicle[], b: Vehicle[]): boolean =>
  areArraysEqual(a, b, compareVehicles);

// ============================================================================
// Context Creation
// ============================================================================

const RideContext = createContext<RideContextValue | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

/**
 * Provides the current trip's rides and vehicles.
 *
 * Must be nested inside `TripProvider`.
 *
 * @param props - Provider props including children
 * @returns The provider element
 */
export function RideProvider({ children }: RideProviderProps): ReactElement {
  const { currentTrip } = useTripContext(),
    currentTripId = currentTrip?.id,
    [error, setError] = useState<Error | null>(null),
    ridesQuery = useLiveQuery(async () => {
      if (!currentTripId) {
        return [];
      }

      try {
        return await db.rides
          .where('[tripId+meetDatetime]')
          .between([currentTripId, ''], [currentTripId, '\uffff'])
          .toArray();
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load rides'));
        return [];
      }
    }, [currentTripId]),
    vehiclesQuery = useLiveQuery(async () => {
      if (!currentTripId) {
        return [];
      }

      try {
        // Sorted here rather than left in primary-key order: `getVehiclesByTripId`
        // and the document's own `compareRecords` both order by name so every
        // device renders the same list, and a context handing the car picker a
        // nanoid-ordered list would be the one surface that disagreed.
        const rows = await db.vehicles
          .where('tripId')
          .equals(currentTripId)
          .toArray();

        return rows.sort((left, right) => {
          const byName = left.name.localeCompare(right.name);
          return byName === 0 ? left.id.localeCompare(right.id) : byName;
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load vehicles'));
        return [];
      }
    }, [currentTripId]),
    isLoading =
      currentTripId !== undefined &&
      (ridesQuery === undefined || vehiclesQuery === undefined),
    rawRides = useMemo(() => ridesQuery ?? [], [ridesQuery]),
    rawVehicles = useMemo(() => vehiclesQuery ?? [], [vehiclesQuery]),
    [rides, setRides] = useState<Ride[]>([]),
    [vehicles, setVehicles] = useState<Vehicle[]>([]);

  // Publish a new array only when something a view renders actually changed, so
  // a live-query tick does not re-render every ride card on the page.
  useEffect(() => {
    setRides((previous) => (areRidesEqual(previous, rawRides) ? previous : rawRides));
  }, [rawRides]);

  useEffect(() => {
    setVehicles((previous) =>
      areVehiclesEqual(previous, rawVehicles) ? previous : rawVehicles,
    );
  }, [rawVehicles]);

  const ridesById = useMemo(
      () => new Map<string, Ride>(rides.map((ride) => [ride.id, ride])),
      [rides],
    ),
    vehiclesById = useMemo(
      () => new Map<string, Vehicle>(vehicles.map((vehicle) => [vehicle.id, vehicle])),
      [vehicles],
    ),
    requireTrip = useCallback((): TripId => {
      if (!currentTripId) {
        throw new Error('No trip selected');
      }
      return currentTripId;
    }, [currentTripId]),
    createRide = useCallback(
      async (data: RideFormData): Promise<Ride> => {
        try {
          const ride = await repositoryCreateRide(requireTrip(), data);
          setError(null);
          return ride;
        } catch (err) {
          wrapAndSetError(err, 'Failed to create ride', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    updateRide = useCallback(
      async (id: RideId, data: Partial<RideFormData>): Promise<void> => {
        try {
          await updateRideWithOwnershipCheck(id, requireTrip(), data);
          setError(null);
        } catch (err) {
          wrapAndSetError(err, 'Failed to update ride', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    deleteRide = useCallback(
      async (id: RideId): Promise<void> => {
        try {
          await deleteRideWithOwnershipCheck(id, requireTrip());
          setError(null);
        } catch (err) {
          wrapAndSetError(err, 'Failed to delete ride', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    createVehicle = useCallback(
      async (data: VehicleFormData): Promise<Vehicle> => {
        try {
          const vehicle = await repositoryCreateVehicle(requireTrip(), data);
          setError(null);
          return vehicle;
        } catch (err) {
          wrapAndSetError(err, 'Failed to create vehicle', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    updateVehicle = useCallback(
      async (id: VehicleId, data: Partial<VehicleFormData>): Promise<void> => {
        try {
          await updateVehicleWithOwnershipCheck(id, requireTrip(), data);
          setError(null);
        } catch (err) {
          wrapAndSetError(err, 'Failed to update vehicle', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    deleteVehicle = useCallback(
      async (id: VehicleId): Promise<void> => {
        try {
          await deleteVehicleWithOwnershipCheck(id, requireTrip());
          setError(null);
        } catch (err) {
          wrapAndSetError(err, 'Failed to delete vehicle', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    setTransportRide = useCallback(
      async (transportId: TransportId, rideId: RideId | undefined): Promise<void> => {
        try {
          await repositorySetTransportRide(transportId, requireTrip(), rideId);
          setError(null);
        } catch (err) {
          wrapAndSetError(err, 'Failed to change ride', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    getRideById = useCallback(
      (id: RideId): Ride | undefined => ridesById.get(id),
      [ridesById],
    ),
    getVehicleById = useCallback(
      (id: VehicleId): Vehicle | undefined => vehiclesById.get(id),
      [vehiclesById],
    ),
    contextValue = useMemo<RideContextValue>(
      () => ({
        rides,
        vehicles,
        isLoading,
        error,
        createRide,
        updateRide,
        deleteRide,
        createVehicle,
        updateVehicle,
        deleteVehicle,
        setTransportRide,
        getRideById,
        getVehicleById,
      }),
      [
        rides,
        vehicles,
        isLoading,
        error,
        createRide,
        updateRide,
        deleteRide,
        createVehicle,
        updateVehicle,
        deleteVehicle,
        setTransportRide,
        getRideById,
        getVehicleById,
      ],
    );

  return <RideContext.Provider value={contextValue}>{children}</RideContext.Provider>;
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to access the Ride Context.
 *
 * Must be used within both `TripProvider` and `RideProvider`.
 *
 * @returns The ride context value
 * @throws {Error} When used outside `RideProvider`
 */
export function useRideContext(): RideContextValue {
  const context = useContext(RideContext);

  if (context === undefined) {
    throw new Error('useRideContext must be used within a RideProvider');
  }

  return context;
}

// ============================================================================
// Exports
// ============================================================================

export { RideContext };
export type { RideProviderProps };
