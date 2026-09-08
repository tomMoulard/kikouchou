/**
 * @fileoverview Tests for VehicleListPage.
 *
 * @module features/vehicles/pages/__tests__/VehicleListPage.test
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import { hexColor } from '@/test/utils';
import type { Person, PersonId, Trip, TripId, Vehicle, VehicleId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

const mockTrip: Trip = {
  id: TRIP_ID,
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  startDate: '2099-06-01' as Trip['startDate'],
  endDate: '2099-06-10' as Trip['endDate'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const bob: Person = {
  id: 'person-bob' as PersonId,
  tripId: TRIP_ID,
  name: 'Bob',
  color: hexColor('#ef4444'),
};

const espace: Vehicle = {
  id: 'vehicle-espace' as VehicleId,
  tripId: TRIP_ID,
  name: 'Espace de location',
  ownerId: bob.id,
  seatCount: 7,
  childSeats: ['booster', 'booster'],
};

const clio: Vehicle = {
  id: 'vehicle-clio' as VehicleId,
  tripId: TRIP_ID,
  name: 'La Clio',
};

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockCreateVehicle = vi.fn().mockResolvedValue(undefined);
const mockUpdateVehicle = vi.fn().mockResolvedValue(undefined);
const mockDeleteVehicle = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(),
}));

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: vi.fn(),
}));

import { VehicleListPage } from '@/features/vehicles/pages/VehicleListPage';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTripContext } from '@/contexts/TripContext';

// ============================================================================
// Helpers
// ============================================================================

function setMocks(
  vehicles: readonly Vehicle[] = [],
  overrides: { readonly currentTrip?: Trip | null; readonly error?: Error } = {},
): void {
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip:
      overrides.currentTrip === undefined ? mockTrip : overrides.currentTrip,
    trips: [mockTrip],
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
  } as unknown as ReturnType<typeof useTripContext>);

  vi.mocked(usePersonContext).mockReturnValue({
    persons: [bob],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof usePersonContext>);

  vi.mocked(useRideContext).mockReturnValue({
    rides: [],
    vehicles,
    isLoading: false,
    error: overrides.error ?? null,
    createVehicle: mockCreateVehicle,
    updateVehicle: mockUpdateVehicle,
    deleteVehicle: mockDeleteVehicle,
  } as unknown as ReturnType<typeof useRideContext>);
}

function renderPage() {
  return render(<VehicleListPage />, {
    initialRoute: '/trips/trip-1/vehicles',
    withProviders: false,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('VehicleListPage', () => {
  beforeAll(() => {
    // Radix Select reaches for pointer-capture and scroll APIs jsdom omits.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers to add the first car when the trip has none', () => {
    setMocks([]);
    renderPage();

    expect(screen.getByText('vehicles.noVehicles')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'vehicles.new' })).toBeInTheDocument();
  });

  it('lists a car with its owner, its seats and its child seats', () => {
    setMocks([espace]);
    renderPage();

    expect(screen.getByText('Espace de location')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('vehicles.seatCountBadge')).toBeInTheDocument();
    // Two boosters are one badge saying two, not two badges.
    expect(screen.getByText('childSeats.required')).toBeInTheDocument();
  });

  it('says the seats are unknown rather than showing a car with none', () => {
    setMocks([clio]);
    renderPage();

    expect(screen.getByText('vehicles.seatsUnknown')).toBeInTheDocument();
  });

  it('names a car nobody owns rather than leaving the line blank', () => {
    setMocks([clio]);
    renderPage();

    expect(screen.getByText('vehicles.noOwner')).toBeInTheDocument();
  });

  it('renders the order the context published, without sorting again', () => {
    // `RideContext` already orders by name, matching the repository and the
    // shared document's own comparator. A second sort here would be a fourth
    // opinion on the same question, and the one nobody would think to update.
    setMocks([clio, espace]);
    renderPage();

    const [first, second] = screen.getAllByRole('listitem');

    expect(first).toHaveTextContent('La Clio');
    expect(second).toHaveTextContent('Espace de location');
  });

  it('creates a car through the dialog', async () => {
    const user = userEvent.setup();
    setMocks([]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'vehicles.new' }));
    await user.type(await screen.findByLabelText(/vehicles\.name/), 'La Clio');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockCreateVehicle).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateVehicle).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'La Clio' }),
    );
  });

  it('opens the edit dialog seeded with the car that was clicked', async () => {
    const user = userEvent.setup();
    setMocks([espace]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'vehicles.editNamed' }));

    expect(
      await screen.findByRole('heading', { name: 'vehicles.edit' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/vehicles\.name/)).toHaveValue('Espace de location');
  });

  it('warns that the rides survive before deleting a car', async () => {
    const user = userEvent.setup();
    setMocks([espace]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'vehicles.deleteNamed' }));

    expect(await screen.findByText('vehicles.deleteTitle')).toBeInTheDocument();
    // The confirmation has to say the journey is not cancelled with the car.
    expect(screen.getByText(/vehicles\.deleteDescription/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'common.delete' }));

    await waitFor(() => {
      expect(mockDeleteVehicle).toHaveBeenCalledWith(espace.id);
    });
  });

  it('keeps the car when the confirmation is dismissed', async () => {
    const user = userEvent.setup();
    setMocks([espace]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'vehicles.deleteNamed' }));
    await user.click(await screen.findByRole('button', { name: 'common.cancel' }));

    expect(mockDeleteVehicle).not.toHaveBeenCalled();
  });

  it('refuses to render another trip’s cars', () => {
    setMocks([espace], { currentTrip: null });
    renderPage();

    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
    expect(screen.queryByText('Espace de location')).not.toBeInTheDocument();
  });

  it('surfaces a load failure instead of an empty list', () => {
    setMocks([], { error: new Error('boom') });
    renderPage();

    // An error rendered as "no cars yet" invites somebody to retype a car they
    // already have.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('vehicles.noVehicles')).not.toBeInTheDocument();
  });
});
