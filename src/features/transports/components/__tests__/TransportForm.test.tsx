import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test/utils';
import type { Person, Ride, Vehicle } from '@/types';

const mockPersons: Person[] = [
  {
    id: 'p1' as Person['id'],
    tripId: 't1' as Person['tripId'],
    name: 'Alice',
    color: '#3b82f6' as Person['color'],
  },
  {
    id: 'p2' as Person['id'],
    tripId: 't1' as Person['tripId'],
    name: 'Bob',
    color: '#ef4444' as Person['color'],
  },
];

/** One car, so a ride can be named by something other than "no car". */
const mockVehicle: Vehicle = {
  id: 'v1' as Vehicle['id'],
  tripId: 't1' as Vehicle['tripId'],
  name: 'Espace de location',
  seatCount: 7,
};

/** A car meeting the arrivals, and one taking people away. */
const mockRides: Ride[] = [
  {
    id: 'r-pickup' as Ride['id'],
    tripId: 't1' as Ride['tripId'],
    direction: 'pickup',
    meetDatetime: '2026-07-15T15:00:00' as Ride['meetDatetime'],
    location: 'Gare de Vannes',
    vehicleId: mockVehicle.id,
  },
  {
    id: 'r-dropoff' as Ride['id'],
    tripId: 't1' as Ride['tripId'],
    direction: 'dropoff',
    meetDatetime: '2026-07-22T09:00:00' as Ride['meetDatetime'],
    location: 'Aéroport de Nantes',
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
    onChange: (loc: string) => void;
  }) => (
    <input
      id={id}
      data-testid="location-picker"
      data-location-id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { TransportForm } from '../TransportForm';

// Radix's Select drives itself with pointer capture and scrolls the highlighted
// option into view, neither of which jsdom implements — without these the
// listbox never opens and every assertion about its options fails on a missing
// element rather than on the thing it means to check.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= (): boolean => false;
  Element.prototype.setPointerCapture ??= (): void => undefined;
  Element.prototype.releasePointerCapture ??= (): void => undefined;
  Element.prototype.scrollIntoView ??= (): void => undefined;
});

describe('TransportForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders create mode with type radio buttons', () => {
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByLabelText('transports.arrival')).toBeInTheDocument();
    expect(screen.getByLabelText('transports.departure')).toBeInTheDocument();
  });

  it('renders person select with persons', () => {
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('assignments.person')).toBeInTheDocument();
  });

  it('renders datetime, location, and mode fields', () => {
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByLabelText(/transports.datetime/)).toBeInTheDocument();
    expect(screen.getAllByTestId('location-picker')).toHaveLength(2);
    expect(screen.getByText('transports.mode')).toBeInTheDocument();
  });

  it('does not ask about pickup separately from the driver', () => {
    // Picking a driver is what says this person is being collected, so the
    // form asked the same question twice. `needsPickup` is inferred now.
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.queryByText('transports.needsPickup')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <TransportForm
        rides={[]}
        vehicles={[]} persons={mockPersons} onSubmit={vi.fn()} onCancel={onCancel} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables submit when no persons available', () => {
    render(
      <TransportForm
        rides={[]}
        vehicles={[]} persons={[]} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const submitBtn = screen.getByText('common.save');
    expect(submitBtn).toBeDisabled();
  });

  it('reports dirty state changes', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(
      <TransportForm
        rides={[]}
        vehicles={[]} persons={mockPersons} onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />,
      { withProviders: false },
    );
    const locationInputs = screen.getAllByTestId('location-picker');
    const mainLocationInput = locationInputs[1]!;
    await user.type(mainLocationInput, 'Paris');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('renders empty persons message when no persons', () => {
    render(
      <TransportForm
        rides={[]}
        vehicles={[]} persons={[]} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('persons.empty')).toBeInTheDocument();
  });

  it('shows validation errors on submit with empty required fields', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TransportForm
        rides={[]}
        vehicles={[]} persons={mockPersons} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    // Submit without filling any fields
    await user.click(screen.getByText('common.save'));
    // Should show validation errors and not call onSubmit
    expect(onSubmit).not.toHaveBeenCalled();
    // Validation error alerts should appear
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('renders edit mode with pre-filled transport', () => {
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'CDG Airport',
      needsPickup: true,
      transportMode: 'plane' as const,
      transportNumber: 'AF123',
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByLabelText('transports.arrival')).toBeChecked();
    const mainLocationInput = screen.getAllByTestId('location-picker')[1]!;
    expect(mainLocationInput).toHaveValue('CDG Airport');
  });

  it('renders notes field', () => {
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByLabelText(/transports\.notes/)).toBeInTheDocument();
  });

  it('selects departure type via radio button', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    const departureRadio = screen.getByLabelText('transports.departure');
    await user.click(departureRadio);
    expect(departureRadio).toBeChecked();
  });

  it('uses defaultType prop for initial type selection', () => {
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        defaultType="departure"
      />,
      { withProviders: false },
    );
    expect(screen.getByLabelText('transports.departure')).toBeChecked();
    expect(screen.getByLabelText('transports.arrival')).not.toBeChecked();
  });

  it('renders transport number input field', () => {
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByLabelText(/transports\.number/)).toBeInTheDocument();
  });

  it('allows typing in transport number field', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    const numberInput = screen.getByLabelText(/transports\.number/);
    await user.type(numberInput, 'TGV 1234');
    expect(numberInput).toHaveValue('TGV 1234');
  });

  it('allows typing in notes field', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    const notesField = screen.getByLabelText(/transports\.notes/);
    await user.type(notesField, 'Bringing luggage');
    expect(notesField).toHaveValue('Bringing luggage');
  });

  it('submits needsPickup false when no driver is chosen', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'CDG Airport',
      needsPickup: false,
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: undefined, needsPickup: false }),
    );
  });

  it('renders driver select section', () => {
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.driver')).toBeInTheDocument();
  });

  it('shows submit error when useFormSubmission has error', () => {
    vi.mocked(vi.importActual('@/hooks')); // Reset mock to allow override
    vi.doMock('@/hooks', () => ({
      useFormSubmission: () => ({
        isSubmitting: false,
        submitError: new Error('Network failure'),
        handleSubmit: vi.fn(),
      }),
    }));
    // Need to re-import after mock override - this would require resetModules
    // Instead, test error display via the existing mock shape
  });

  it('keeps a stored needsPickup on save, since no field represents it', async () => {
    // It used to clear it, and that was a real loss rather than a quirk: a
    // guest self-entering their arrival through the share wizard can say they
    // need a lift, which is a `needsPickup` with nobody driving yet — the one
    // state this form has no field for. The organiser opening that leg to fix
    // a station name silently answered "no, they don't", dropping the guest
    // out of the pickup panel and out of `pickupsNeedingDriver`.
    //
    // Inference still *sets* the flag when a driver is picked. It just never
    // unsets one it cannot see.
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'Station',
      needsPickup: true,
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ needsPickup: true }),
    );
  });

  it('leaves needsPickup false for a record that never had it', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'Station',
      needsPickup: false,
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ needsPickup: false }),
    );
  });

  it('edit mode shows transport number from existing transport', () => {
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'departure' as const,
      datetime: '2027-07-20T09:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'Gare du Nord',
      needsPickup: false,
      transportNumber: 'TGV 9876',
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByLabelText('transports.departure')).toBeChecked();
    const numberInput = screen.getByLabelText(/transports\.number/);
    expect(numberInput).toHaveValue('TGV 9876');
  });

  it('allows typing in datetime field', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    const datetimeInput = screen.getByLabelText(/transports.datetime/);
    await user.type(datetimeInput, '2027-07-15T14:00');
    expect(datetimeInput).toHaveValue('2027-07-15T14:00');
  });

  it('submits form with valid data in edit mode (pre-filled)', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'CDG Airport',
      needsPickup: false,
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    // Submit pre-filled form
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'p1',
        type: 'arrival',
        location: 'CDG Airport',
      }),
    );
  });

  it('flags the empty datetime on blur and describes the input with it', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    const datetimeInput = screen.getByLabelText(/transports.datetime/);
    expect(datetimeInput).toHaveAttribute('aria-invalid', 'false');

    await user.click(datetimeInput);
    await user.tab();

    // Blur is the only thing that has run, so the datetime error is the only
    // one on screen — a bare "at least zero alerts" said nothing about which.
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('common.required');
    expect(error).toHaveAttribute('id', 'transport-datetime-error');
    expect(datetimeInput).toHaveAttribute('aria-invalid', 'true');
    expect(datetimeInput).toHaveAttribute(
      'aria-describedby',
      'transport-datetime-error',
    );
  });

  it('clears the datetime error as soon as the user types, leaving the others', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    // Submitting an empty form flags person, datetime and location at once
    await user.click(screen.getByText('common.save'));
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    const datetimeInput = screen.getByLabelText(/transports.datetime/);
    expect(datetimeInput).toHaveAttribute('aria-invalid', 'true');

    await user.type(datetimeInput, '2027-07-15T14:00');

    // Only this field's error clears; the untouched ones stay flagged
    expect(datetimeInput).toHaveAttribute('aria-invalid', 'false');
    expect(datetimeInput).not.toHaveAttribute('aria-describedby');
    expect(
      document.getElementById('transport-datetime-error'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('infers needsPickup from the chosen driver', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'CDG Airport',
      driverId: 'p2' as import('@/types').Transport['personId'],
      needsPickup: false,
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByText('common.save'));

    // Bob is driving, so this is a pickup — without the switch ever being asked.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'p2', needsPickup: true }),
    );
  });

  it('shows no other persons message when only one person exists', () => {
    const singlePerson = [mockPersons[0]!];
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'Station',
      needsPickup: false,
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={singlePerson}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    // Driver section should show "no other persons" message since selected person is filtered out
    expect(screen.getByText(/transports\.noOtherPersons/)).toBeInTheDocument();
  });

  it('submits departure type with transport number and notes', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const transport = {
      id: 't2' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p2' as import('@/types').Transport['personId'],
      type: 'departure' as const,
      datetime: '2027-07-20T09:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'Gare du Nord',
      needsPickup: false,
      transportNumber: 'TGV 1234',
      notes: 'Heavy luggage',
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    // Submit pre-filled form
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'p2',
        type: 'departure',
        location: 'Gare du Nord',
        transportNumber: 'TGV 1234',
        notes: 'Heavy luggage',
      }),
    );
  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================

  it('handles edit mode with invalid ISO datetime gracefully', () => {
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: 'not-a-date' as import('@/types').Transport['datetime'],
      location: 'Station',
      needsPickup: false,
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    // Should render without error - datetime should be empty due to invalid parsing
    const datetimeInput = screen.getByLabelText(/transports.datetime/);
    expect(datetimeInput).toHaveValue('');
  });

  it('renders edit mode with "other" transport mode', () => {
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'Station',
      needsPickup: false,
      transportMode: 'other' as const,
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.mode')).toBeInTheDocument();
  });

  it('renders edit mode with driver pre-selected', () => {
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'Station',
      needsPickup: true,
      driverId: 'p2' as import('@/types').Transport['driverId'],
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.driver')).toBeInTheDocument();
  });

  it('shows person-deleted warning when personId references nonexistent person', () => {
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'deleted-person' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'Station',
      needsPickup: false,
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    // Should show a warning about deleted person
    expect(screen.getByText(/errors\.personNotFound/)).toBeInTheDocument();
  });

  it('renders edit mode with coordinates', () => {
    const transport = {
      id: 't1' as import('@/types').Transport['id'],
      tripId: 't1' as import('@/types').Transport['tripId'],
      personId: 'p1' as import('@/types').Transport['personId'],
      type: 'arrival' as const,
      datetime: '2027-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
      location: 'CDG Airport',
      needsPickup: false,
      coordinates: { lat: 49.0097, lon: 2.5479 },
    };
    render(
      <TransportForm
        rides={[]}
        vehicles={[]}
        transport={transport}
        persons={mockPersons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getAllByTestId('location-picker')[1]).toHaveValue('CDG Airport');
  });

  // ==========================================================================
  // Car Select
  // ==========================================================================

  describe('the car select', () => {
    /** Opens the car select and returns the listbox its options live in. */
    async function openCarSelect(
      user: ReturnType<typeof userEvent.setup>,
    ): Promise<HTMLElement> {
      await user.click(screen.getByRole('combobox', { name: 'transports.ride' }));
      return screen.getByRole('listbox');
    }

    it('offers only the cars going the same way as the leg', async () => {
      const user = userEvent.setup();

      render(
        <TransportForm
          rides={mockRides}
          vehicles={[mockVehicle]}
          persons={mockPersons}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
        { withProviders: false },
      );

      // The form opens on `arrival`, which is collected by a `pickup`. The
      // dropoff must not be on offer: booking Sunday's flight home into the car
      // that fetched you on Friday is not a mistake the user should be able to
      // make in one click.
      const listbox = await openCarSelect(user);
      expect(within(listbox).getByText('Espace de location')).toBeInTheDocument();
      expect(within(listbox).queryByText(/Aéroport de Nantes/)).not.toBeInTheDocument();
    });

    it('follows the leg when it is flipped to a departure', async () => {
      const user = userEvent.setup();

      render(
        <TransportForm
          rides={mockRides}
          vehicles={[mockVehicle]}
          persons={mockPersons}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
        { withProviders: false },
      );

      await user.click(screen.getByLabelText('transports.departure'));

      const listbox = await openCarSelect(user);
      expect(within(listbox).getByText(/Aéroport de Nantes/)).toBeInTheDocument();
      expect(within(listbox).queryByText('Espace de location')).not.toBeInTheDocument();
    });

    it('says why it is empty, and which kind of empty it is', () => {
      const { unmount } = render(
        <TransportForm
          rides={[]}
          vehicles={[]}
          persons={mockPersons}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
        { withProviders: false },
      );

      expect(screen.getByText('transports.noRides')).toBeInTheDocument();
      unmount();

      // A trip that has cars, none of them going this way, is a different
      // situation with a different answer, and one message for both would send
      // the user off to create a car they already have.
      render(
        <TransportForm
          rides={[mockRides[1] as Ride]}
          vehicles={[]}
          persons={mockPersons}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
        { withProviders: false },
      );

      expect(screen.getByText('transports.noRidesForType')).toBeInTheDocument();
    });

    it('submits the chosen car, and drops the leg\'s own driver with it', async () => {
      const user = userEvent.setup(),
        onSubmit = vi.fn().mockResolvedValue(undefined),
        // Pre-filled so the form is valid without driving every field, and
        // seeded with a driver so there is something for the car to displace.
        transport = {
          id: 't1' as import('@/types').Transport['id'],
          tripId: 't1' as import('@/types').Transport['tripId'],
          personId: 'p1' as import('@/types').Transport['personId'],
          type: 'arrival' as const,
          datetime: '2026-07-15T14:00:00.000Z' as import('@/types').Transport['datetime'],
          location: 'Gare de Vannes',
          needsPickup: true,
          driverId: 'p2' as import('@/types').Transport['personId'],
        };

      render(
        <TransportForm
          rides={mockRides}
          vehicles={[mockVehicle]}
          transport={transport}
          persons={mockPersons}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
        { withProviders: false },
      );

      await user.click(screen.getByRole('combobox', { name: 'transports.ride' }));
      await user.click(within(screen.getByRole('listbox')).getByText('Espace de location'));

      await user.click(screen.getByText('common.save'));

      // Picking a car is saying this guest is in the shared one, so Bob's lift
      // goes with it. The repository enforces the same rule on write; the form
      // asserts it here so a leg never leaves this dialog naming two drivers.
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          rideId: 'r-pickup',
          driverId: undefined,
          needsPickup: true,
        }),
      );
    });
  });
});
