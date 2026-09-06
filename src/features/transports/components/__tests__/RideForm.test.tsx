/**
 * @fileoverview Guards for the two rules that make `RideForm` a ride form and
 * not a relabelled transport form: every guest can drive, and a destination
 * remembers how long it takes to get there.
 *
 * The driver options are read off the hidden native `<select>` Radix keeps in
 * sync with its listbox — the popup itself never opens in jsdom, and asserting
 * on the options is what proves a passenger is *offered*, not merely accepted.
 */

import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, userEvent } from '@/test/utils';
import type { Person, PersonId, Ride, RideId, TripId, Vehicle, VehicleId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip1' as TripId;

const mockPersons: Person[] = [
  {
    id: 'p1' as PersonId,
    tripId: TRIP_ID,
    name: 'Alice',
    color: '#3b82f6' as Person['color'],
  },
  {
    id: 'p2' as PersonId,
    tripId: TRIP_ID,
    name: 'Bob',
    color: '#ef4444' as Person['color'],
  },
];

const mockVehicles: Vehicle[] = [
  {
    id: 'v1' as VehicleId,
    tripId: TRIP_ID,
    name: 'The Espace',
    seatCount: 7,
  },
];

/** Two runs to the same airport, the later one with the measured lead time. */
const ridesToCdg: Ride[] = [
  {
    id: 'r-old' as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime: '2026-06-01T09:00:00.000Z',
    location: 'CDG Terminal 2',
    leadTimeMinutes: 20,
  },
  {
    id: 'r-recent' as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    // Trailing space and a different case: the same destination, folded the way
    // `groupPickupsByProximity` folds it.
    meetDatetime: '2026-07-01T09:00:00.000Z',
    location: '  cdg terminal 2 ',
    leadTimeMinutes: 45,
  },
];

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: null,
    handleSubmit: onSubmit,
  }),
}));

vi.mock('@/components/shared/LocationPicker', () => ({
  LocationPicker: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (location: string) => void;
  }) => (
    <input
      id={id}
      data-testid="location-picker"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { RideForm } from '../RideForm';

// ============================================================================
// Helpers
// ============================================================================

/** The values Radix mirrors into the hidden native select for a shadcn Select. */
function optionValues(container: HTMLElement, name: string): string[] {
  const select = container.querySelector(`select[name="${name}"]`);
  expect(select).not.toBeNull();
  return Array.from(select?.querySelectorAll('option') ?? []).map(
    (option) => option.value,
  );
}

function renderForm(
  overrides: Partial<ComponentProps<typeof RideForm>> = {},
): ReturnType<typeof render> {
  return render(
    <RideForm
      persons={mockPersons}
      vehicles={mockVehicles}
      rides={[]}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
      {...overrides}
    />,
    { withProviders: false },
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('RideForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers both directions and starts on pick-up', () => {
    renderForm();

    expect(screen.getByLabelText('rides.directions.pickup')).toBeChecked();
    expect(screen.getByLabelText('rides.directions.dropoff')).not.toBeChecked();
  });

  it('offers a guest who is already a passenger as the driver', () => {
    // The whole point of a ride: Alice drives the hire car to the airport with
    // her own leg in it. `TransportForm` filters the traveller out of its
    // driver list, which would make this arrangement unexpressible.
    const { container } = renderForm({ passengerIds: ['p1' as PersonId] });

    expect(optionValues(container, 'ride-driver')).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );
  });

  it('says the driver is travelling too when they own one of the legs', () => {
    renderForm({
      passengerIds: ['p1' as PersonId],
      ride: {
        id: 'r1' as RideId,
        tripId: TRIP_ID,
        direction: 'pickup',
        meetDatetime: '2026-07-15T08:00:00.000Z',
        location: 'CDG Terminal 2',
        driverId: 'p1' as PersonId,
      },
    });

    expect(screen.getByText('rides.selfDriven')).toBeInTheDocument();
  });

  it('stays quiet when the driver is not one of the passengers', () => {
    renderForm({
      passengerIds: ['p1' as PersonId],
      ride: {
        id: 'r1' as RideId,
        tripId: TRIP_ID,
        direction: 'pickup',
        meetDatetime: '2026-07-15T08:00:00.000Z',
        location: 'CDG Terminal 2',
        driverId: 'p2' as PersonId,
      },
    });

    expect(screen.queryByText('rides.selfDriven')).not.toBeInTheDocument();
  });

  it('defaults the lead time to 30 minutes for an unknown destination', async () => {
    const user = userEvent.setup();
    renderForm({ rides: ridesToCdg });

    await user.type(screen.getByTestId('location-picker'), 'Lyon Part-Dieu');

    expect(screen.getByLabelText('rides.leadTime')).toHaveValue(30);
    expect(screen.queryByText('rides.leadTimeRemembered')).not.toBeInTheDocument();
  });

  it('remembers the lead time of the last ride to the same place', async () => {
    const user = userEvent.setup();
    renderForm({ rides: ridesToCdg });

    await user.type(screen.getByTestId('location-picker'), 'CDG Terminal 2');

    // 45 from the July run, not 20 from June and not the 30-minute default.
    expect(screen.getByLabelText('rides.leadTime')).toHaveValue(45);
    expect(screen.getByText('rides.leadTimeRemembered')).toBeInTheDocument();
  });

  it('never overwrites a lead time the driver typed themselves', async () => {
    const user = userEvent.setup();
    renderForm({ rides: ridesToCdg });

    const leadTime = screen.getByLabelText('rides.leadTime');
    await user.clear(leadTime);
    await user.type(leadTime, '15');

    await user.type(screen.getByTestId('location-picker'), 'CDG Terminal 2');

    expect(leadTime).toHaveValue(15);
  });

  it('keeps the ride’s own lead time in edit mode', () => {
    renderForm({
      rides: ridesToCdg,
      ride: {
        id: 'r1' as RideId,
        tripId: TRIP_ID,
        direction: 'dropoff',
        meetDatetime: '2026-07-15T08:00:00.000Z',
        location: 'CDG Terminal 2',
        leadTimeMinutes: 75,
      },
    });

    expect(screen.getByLabelText('rides.leadTime')).toHaveValue(75);
    expect(screen.getByLabelText('rides.directions.dropoff')).toBeChecked();
    expect(screen.getByTestId('location-picker')).toHaveValue('CDG Terminal 2');
  });

  it('leaves the lead time blank for a ride that never stated one', async () => {
    // A ride projected from a peer carries no lead time. Showing 30 would make
    // the next save state it, and a stated 30 then outranks the 45 an earlier
    // ride to the same station actually measured.
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({
      rides: ridesToCdg,
      onSubmit,
      ride: {
        id: 'r-peer' as RideId,
        tripId: TRIP_ID,
        direction: 'pickup',
        meetDatetime: '2026-07-15T08:00:00.000Z',
        location: 'CDG Terminal 2',
      },
    });

    expect(screen.getByLabelText('rides.leadTime')).toHaveValue(null);

    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ leadTimeMinutes: undefined }),
    );
  });

  it('submits the meeting time as an instant, with the chosen driver', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText(/rides.meetDatetime/), {
      target: { value: '2026-07-15T10:00' },
    });
    await user.type(screen.getByTestId('location-picker'), 'CDG Terminal 2');
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'pickup',
        // Built the same way the form builds it, so the assertion carries no
        // timezone of its own — CI runs at UTC and a developer does not.
        meetDatetime: new Date('2026-07-15T10:00').toISOString(),
        location: 'CDG Terminal 2',
        leadTimeMinutes: 30,
      }),
    );
  });

  it('refuses to submit without a meeting time or a place', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({ onSubmit });

    await user.click(screen.getByText('common.save'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a lead time that is not a whole number of minutes in range', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText(/rides.meetDatetime/), {
      target: { value: '2026-07-15T10:00' },
    });
    await user.type(screen.getByTestId('location-picker'), 'CDG Terminal 2');
    fireEvent.change(screen.getByLabelText('rides.leadTime'), {
      target: { value: '5000' },
    });
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('rides.errors.invalidLeadTime')).toBeInTheDocument();
  });

  it('lets the schema refuse a field the form does not police itself', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText(/rides.meetDatetime/), {
      target: { value: '2026-07-15T10:00' },
    });
    await user.type(screen.getByTestId('location-picker'), 'CDG Terminal 2');
    fireEvent.change(screen.getByLabelText('transports.notes'), {
      target: { value: 'x'.repeat(1001) },
    });
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('rides.errors.notesTooLong')).toBeInTheDocument();
  });

  it('lists the trip’s cars and says so when there are none', () => {
    const { container } = renderForm();
    expect(optionValues(container, 'ride-vehicle')).toContain('v1');

    const { container: empty } = renderForm({ vehicles: [] });
    expect(optionValues(empty, 'ride-vehicle')).not.toContain('v1');
    expect(screen.getAllByText('vehicles.noVehicles').length).toBeGreaterThan(0);
  });

  it('reports dirty state and cancels', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onDirtyChange = vi.fn();
    renderForm({ onCancel, onDirtyChange });

    await user.type(screen.getByTestId('location-picker'), 'CDG Terminal 2');
    expect(onDirtyChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByText('common.cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
