/**
 * @fileoverview Guards for the dialog around `RideForm`: the create/edit split,
 * the unsaved-changes gate, and the passenger list it hands the form.
 *
 * The passenger list is the interesting one. It comes from `resolveRides`, the
 * shared resolver, rather than from a local filter over transports — a second
 * definition of "who is in this car" is how two screens come to disagree about
 * one journey.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent } from '@/test/utils';
import type {
  Person,
  PersonId,
  Ride,
  RideFormData,
  RideId,
  Transport,
  TransportId,
  TripId,
  Vehicle,
  VehicleId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip1' as TripId;

const mocks = vi.hoisted(() => ({
  createRide: vi.fn(),
  updateRide: vi.fn(),
  captureUsage: vi.fn(),
  successToast: vi.fn(),
  isLoading: { value: false },
}));

const mockRides: Ride[] = [
  {
    id: 'r1' as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime: '2026-07-15T08:00:00.000Z',
    location: 'CDG Terminal 2',
    leadTimeMinutes: 45,
    driverId: 'p1' as PersonId,
  },
];

/** Alice's own leg, booked into the ride above — so Alice drives herself. */
const mockTransports: Transport[] = [
  {
    id: 't1' as TransportId,
    tripId: TRIP_ID,
    personId: 'p1' as PersonId,
    type: 'arrival',
    datetime: '2026-07-15T08:10:00.000Z',
    location: 'CDG Terminal 2',
    needsPickup: true,
    rideId: 'r1' as RideId,
  },
];

const mockPersons: Person[] = [
  {
    id: 'p1' as PersonId,
    tripId: TRIP_ID,
    name: 'Alice',
    color: '#3b82f6' as Person['color'],
  },
];

const mockVehicles: Vehicle[] = [
  { id: 'v1' as VehicleId, tripId: TRIP_ID, name: 'The Espace', seatCount: 7 },
];

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({
    rides: mockRides,
    vehicles: mockVehicles,
    isLoading: mocks.isLoading.value,
    createRide: mocks.createRide,
    updateRide: mocks.updateRide,
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({ persons: mockPersons }),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({ transports: mockTransports }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: mocks.successToast,
    errorToast: vi.fn(),
  }),
}));

vi.mock('@/lib/posthog', () => ({ captureUsage: mocks.captureUsage }));

/** The submitted ride: Alice drives, and Alice is also in the car. */
const submitted: RideFormData = {
  direction: 'pickup',
  meetDatetime: '2026-07-15T08:00:00.000Z',
  location: 'CDG Terminal 2',
  leadTimeMinutes: 45,
  driverId: 'p1' as PersonId,
};

vi.mock('@/features/transports/components/RideForm', () => ({
  RideForm: ({
    ride,
    passengerIds,
    defaultDirection,
    onCancel,
    onSubmit,
    onDirtyChange,
  }: {
    ride?: Ride;
    passengerIds?: readonly PersonId[];
    defaultDirection?: string;
    onCancel: () => void;
    onSubmit: (data: RideFormData) => Promise<void>;
    onDirtyChange?: (isDirty: boolean) => void;
  }) => (
    <div data-testid="ride-form">
      {ride ? (
        <span data-testid="edit-mode">{ride.location}</span>
      ) : (
        <span data-testid="create-mode">New</span>
      )}
      {defaultDirection !== undefined && (
        <span data-testid="default-direction">{defaultDirection}</span>
      )}
      <span data-testid="passenger-ids">{(passengerIds ?? []).join(',')}</span>
      <button data-testid="cancel-btn" onClick={onCancel}>
        Cancel
      </button>
      <button
        data-testid="submit-btn"
        onClick={() => {
          void onSubmit(submitted).catch(() => {});
        }}
      >
        Submit
      </button>
      <button data-testid="dirty-btn" onClick={() => onDirtyChange?.(true)}>
        Mark dirty
      </button>
    </div>
  ),
}));

import { RideDialog } from '../RideDialog';

// ============================================================================
// Tests
// ============================================================================

describe('RideDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRide.mockResolvedValue(undefined);
    mocks.updateRide.mockResolvedValue(undefined);
    mocks.isLoading.value = false;
  });

  it('renders create mode when no rideId is given', () => {
    render(<RideDialog open onOpenChange={vi.fn()} />, { withProviders: false });

    expect(screen.getByText('rides.new')).toBeInTheDocument();
    expect(screen.getByText('rides.newDescription')).toBeInTheDocument();
    expect(screen.getByTestId('create-mode')).toBeInTheDocument();
  });

  it('renders edit mode for a known ride', () => {
    render(<RideDialog rideId={'r1' as RideId} open onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByText('rides.edit')).toBeInTheDocument();
    expect(screen.getByText('rides.editDescription')).toBeInTheDocument();
    expect(screen.getByTestId('edit-mode')).toHaveTextContent('CDG Terminal 2');
  });

  it('says so when the ride is gone', () => {
    render(<RideDialog rideId={'nope' as RideId} open onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByText('errors.rideNotFound')).toBeInTheDocument();
  });

  it('waits rather than claiming the ride is gone while the query runs', () => {
    // `RideContext` publishes its rides through state fed by an effect, so the
    // first renders after a mount or a trip switch see an empty list. Calling
    // that "not found" flashes an error over a ride that exists.
    mocks.isLoading.value = true;

    render(<RideDialog rideId={'r1' as RideId} open onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.queryByText('errors.rideNotFound')).not.toBeInTheDocument();
  });

  it('hands the form the passengers resolved from the legs', () => {
    render(<RideDialog rideId={'r1' as RideId} open onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByTestId('passenger-ids')).toHaveTextContent('p1');
  });

  it('passes the default direction in create mode only', () => {
    const { unmount } = render(
      <RideDialog open onOpenChange={vi.fn()} defaultDirection="dropoff" />,
      { withProviders: false },
    );
    expect(screen.getByTestId('default-direction')).toHaveTextContent('dropoff');
    unmount();

    render(
      <RideDialog
        rideId={'r1' as RideId}
        open
        onOpenChange={vi.fn()}
        defaultDirection="dropoff"
      />,
      { withProviders: false },
    );
    expect(screen.queryByTestId('default-direction')).not.toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<RideDialog open={false} onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.queryByText('rides.new')).not.toBeInTheDocument();
  });

  it('creates the ride and closes', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<RideDialog open onOpenChange={onOpenChange} />, {
      withProviders: false,
    });

    await user.click(screen.getByTestId('submit-btn'));

    expect(mocks.createRide).toHaveBeenCalledWith(submitted);
    expect(mocks.updateRide).not.toHaveBeenCalled();
    expect(mocks.successToast).toHaveBeenCalledWith('rides.createSuccess');
    expect(mocks.captureUsage).toHaveBeenCalledWith(
      'ride_saved',
      expect.objectContaining({ operation: 'created', direction: 'pickup' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('updates the ride and reports that the driver is also a passenger', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<RideDialog rideId={'r1' as RideId} open onOpenChange={onOpenChange} />, {
      withProviders: false,
    });

    await user.click(screen.getByTestId('submit-btn'));

    expect(mocks.updateRide).toHaveBeenCalledWith('r1', submitted);
    expect(mocks.createRide).not.toHaveBeenCalled();
    expect(mocks.successToast).toHaveBeenCalledWith('rides.updateSuccess');
    expect(mocks.captureUsage).toHaveBeenCalledWith(
      'ride_saved',
      expect.objectContaining({
        operation: 'updated',
        self_driven: true,
        passengers: 1,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes straight away when the form is clean', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<RideDialog open onOpenChange={onOpenChange} />, {
      withProviders: false,
    });

    await user.click(screen.getByTestId('cancel-btn'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('asks before discarding a dirty form', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<RideDialog open onOpenChange={onOpenChange} />, {
      withProviders: false,
    });

    await user.click(screen.getByTestId('dirty-btn'));
    await user.click(screen.getByTestId('cancel-btn'));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText('unsaved.discardChanges')).toBeInTheDocument();
  });
});
