/**
 * @fileoverview Unit tests for EventDetailDialog component.
 * Tests type guards, assignment detail rendering, and action flows.
 * @module features/calendar/components/__tests__/EventDetailDialog.test
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  EventDetailDialog,
  isAssignmentEvent,
  isTransportEvent,
  type ActivityEventData,
  type AssignmentEventData,
  type TransportEventData,
} from '../EventDetailDialog';
import { resolveRides } from '@/features/transports/utils/ride-model';
import { STALL_TIMEOUT_MS } from '@/hooks/useStalled';
import { notify } from '@/lib/notifications';
import type { GuestOverview } from '../../utils/guest-overview';
import type {
  Activity,
  ActivityId,
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Ride,
  RideId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
  Vehicle,
  VehicleId,
} from '@/types';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/features/transports/components/DirectionsButton', () => ({
  DirectionsButton: ({ locationName }: { readonly locationName?: string }) => (
    <button data-location={locationName ?? ''}>directions</button>
  ),
}));

// ============================================================================
// Test Data Factories
// ============================================================================

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'person-1' as PersonId,
    tripId: 'trip-1' as TripId,
    name: 'Alice',
    color: '#3b82f6' as HexColor,
    ...overrides,
  };
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1' as RoomId,
    tripId: 'trip-1' as TripId,
    name: 'Blue Room',
    capacity: 2,
    order: 0,
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<RoomAssignment> = {}): RoomAssignment {
  return {
    id: 'assignment-1' as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: 'room-1' as RoomId,
    personId: 'person-1' as PersonId,
    startDate: '2026-01-10' as ISODateString,
    endDate: '2026-01-13' as ISODateString,
    ...overrides,
  };
}

function makeTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    id: 'transport-1' as TransportId,
    tripId: 'trip-1' as TripId,
    personId: 'person-1' as PersonId,
    type: 'arrival',
    datetime: '2026-01-10T14:30:00.000Z',
    location: 'Paris CDG Airport',
    transportMode: 'plane',
    transportNumber: 'AF1234',
    needsPickup: false,
    ...overrides,
  };
}

function makeAssignmentEvent(overrides: Partial<AssignmentEventData> = {}): AssignmentEventData {
  return {
    type: 'assignment',
    assignment: makeAssignment(),
    person: makePerson(),
    room: makeRoom(),
    ...overrides,
  };
}

function makeGuestOverview(overrides: Partial<GuestOverview> = {}): GuestOverview {
  const person = makePerson();
  return {
    person,
    checkIn: '2026-01-10' as ISODateString,
    checkOut: '2026-01-13' as ISODateString,
    stays: [{ assignment: makeAssignment(), room: makeRoom() }],
    transports: [],
    activities: [],
    balance: undefined,
    currency: undefined,
    ...overrides,
  };
}

function makeTransportEvent(overrides: Partial<TransportEventData> = {}): TransportEventData {
  return {
    type: 'transport',
    transport: makeTransport(),
    person: makePerson(),
    ...overrides,
  };
}

/**
 * Builds a transport event whose leg travels in a real car.
 *
 * The journey goes through `resolveRides` rather than being hand-written, so
 * the dialog is tested against the shape the app actually hands it — including
 * the `isLegacy` flag the legacy test below turns on by leaving the ride out.
 *
 * Every datetime is a `…Z` instant: nothing here asserts a rendered clock, and
 * a bare literal would put the leg inside or outside the ride's match window
 * depending on the runner's offset.
 */
function makeRideEvent(
  options: {
    readonly withDriver?: boolean;
    readonly withVehicle?: boolean;
    readonly withSecondPassenger?: boolean;
    readonly needsPickup?: boolean;
  } = {},
): { readonly event: TransportEventData } {
  const {
    withDriver = true,
    withVehicle = true,
    withSecondPassenger = true,
    needsPickup = false,
  } = options;

  const driver = makePerson({ id: 'p2' as PersonId, name: 'Bruno' });
  const otherPassenger = makePerson({ id: 'p3' as PersonId, name: 'Chloé' });

  const vehicle: Vehicle = {
    id: 'vehicle-1' as VehicleId,
    tripId: 'trip-1' as TripId,
    name: 'Espace de location',
    seatCount: 7,
  };

  const ride: Ride = {
    id: 'ride-1' as RideId,
    tripId: 'trip-1' as TripId,
    direction: 'pickup',
    meetDatetime: '2026-01-10T14:45:00.000Z',
    location: 'Paris CDG Airport',
    leadTimeMinutes: 30,
    ...(withDriver ? { driverId: driver.id } : {}),
    ...(withVehicle ? { vehicleId: vehicle.id } : {}),
  };

  const ownLeg = makeTransport({ rideId: ride.id, needsPickup });
  const otherLeg = makeTransport({
    id: 'transport-2' as TransportId,
    personId: otherPassenger.id,
    datetime: '2026-01-10T14:50:00.000Z',
    rideId: ride.id,
  });

  const persons = [makePerson(), driver, otherPassenger];

  const [journey] = resolveRides({
    transports: withSecondPassenger ? [ownLeg, otherLeg] : [ownLeg],
    rides: [ride],
    vehicles: withVehicle ? [vehicle] : [],
    persons,
  });

  return {
    event: makeTransportEvent({ transport: ownLeg, ride: journey, persons }),
  };
}

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn().mockResolvedValue(undefined),
};

// ============================================================================
// Type Guard Tests
// ============================================================================

// Undoes any `vi.spyOn` a test installed. The global setup's `vi.clearAllMocks()`
// only clears recorded calls, so a stubbed `console.error` would otherwise
// outlive the test that stubbed it.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Type Guards', () => {
  it('isAssignmentEvent returns true for assignment events', () => {
    expect(isAssignmentEvent(makeAssignmentEvent())).toBe(true);
  });

  it('isAssignmentEvent returns false for transport events', () => {
    expect(isAssignmentEvent(makeTransportEvent())).toBe(false);
  });

  it('isTransportEvent returns true for transport events', () => {
    expect(isTransportEvent(makeTransportEvent())).toBe(true);
  });

  it('isTransportEvent returns false for assignment events', () => {
    expect(isTransportEvent(makeAssignmentEvent())).toBe(false);
  });
});

// ============================================================================
// EventDetailDialog Tests
// ============================================================================

describe('EventDetailDialog', () => {
  describe('Loading state', () => {
    it('shows loading title when event is null', () => {
      render(<EventDetailDialog {...defaultProps} event={null} />);
      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });
  });

  describe('Assignment events', () => {
    it('renders dialog title for room assignment', () => {
      render(<EventDetailDialog {...defaultProps} event={makeAssignmentEvent()} />);
      expect(screen.getByText('Room Assignment')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Event details');
    });

    it('displays person badge', () => {
      render(<EventDetailDialog {...defaultProps} event={makeAssignmentEvent()} />);
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('displays room name', () => {
      render(<EventDetailDialog {...defaultProps} event={makeAssignmentEvent()} />);
      expect(screen.getByText('Blue Room')).toBeInTheDocument();
    });

    it('shows unknown when person is undefined', () => {
      const event = makeAssignmentEvent({ person: undefined });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      expect(screen.getAllByText('common.unknown').length).toBeGreaterThanOrEqual(1);
    });

    it('shows unknown when room is undefined', () => {
      const event = makeAssignmentEvent({ room: undefined });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      expect(screen.getAllByText('common.unknown').length).toBeGreaterThanOrEqual(1);
    });

    it('displays related transports when present', () => {
      const transport = makeTransport({ location: 'Marseille Gare' });
      const event = makeAssignmentEvent({ relatedTransports: [transport] });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      expect(screen.getByText('Marseille Gare')).toBeInTheDocument();
      expect(screen.getByText('Travel')).toBeInTheDocument();
    });

    it('shows transport notes in related transports', () => {
      const transport = makeTransport({ notes: 'Special note text' });
      const event = makeAssignmentEvent({ relatedTransports: [transport] });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      expect(screen.getByText('Special note text')).toBeInTheDocument();
    });

    it('shows directions button for transports with coordinates', () => {
      const transport = makeTransport({ coordinates: { lat: 48.8, lon: 2.35 } });
      const event = makeAssignmentEvent({ relatedTransports: [transport] });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      expect(screen.getByText('directions')).toBeInTheDocument();
    });
  });

  describe('Transport events', () => {
    it('renders dialog title for arrival', () => {
      render(<EventDetailDialog {...defaultProps} event={makeTransportEvent()} />);
      expect(screen.getByText('Arrival')).toBeInTheDocument();
    });

    it('renders dialog title for departure', () => {
      const event = makeTransportEvent({
        transport: makeTransport({ type: 'departure' }),
      });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      expect(screen.getByText('Departure')).toBeInTheDocument();
    });

    it('displays transport location', () => {
      render(<EventDetailDialog {...defaultProps} event={makeTransportEvent()} />);
      expect(screen.getByText('Paris CDG Airport')).toBeInTheDocument();
    });

    it('displays transport number', () => {
      render(<EventDetailDialog {...defaultProps} event={makeTransportEvent()} />);
      const modeText = screen.getByText(/AF1234/);
      expect(modeText).toBeInTheDocument();
    });

    it('shows driver badge when driver is present', () => {
      const driver = makePerson({ id: 'p2' as PersonId, name: 'Bob Driver' });
      const event = makeTransportEvent({ driver });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      expect(screen.getByText('Bob Driver')).toBeInTheDocument();
    });

    it('shows needs pickup badge', () => {
      const event = makeTransportEvent({
        transport: makeTransport({ needsPickup: true }),
      });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      expect(screen.getByText('transports.needsPickup')).toBeInTheDocument();
    });

    it('shows notes when present', () => {
      const event = makeTransportEvent({
        transport: makeTransport({ notes: 'Gate B42' }),
      });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      expect(screen.getByText('Gate B42')).toBeInTheDocument();
    });

    it('does not show location when empty', () => {
      const event = makeTransportEvent({
        transport: makeTransport({ location: '' }),
      });
      render(<EventDetailDialog {...defaultProps} event={event} />);
      // No MapPin text content for empty location
      expect(screen.queryByText('Paris CDG Airport')).not.toBeInTheDocument();
    });
  });

  // The question a guest opens their own arrival to ask: who is fetching me,
  // and who else is in the car.
  describe('The car that serves the leg', () => {
    it('names the driver, the car, the meeting time and the other passengers', () => {
      const { event } = makeRideEvent();

      render(<EventDetailDialog {...defaultProps} event={event} />);

      const section = screen.getByTestId('transport-ride-section');

      // Which way the car is going, in words as well as the arrow.
      expect(section).toHaveTextContent('rides.directions.pickup');
      expect(section).toHaveTextContent('↓');

      // When and where it meets.
      expect(section).toHaveTextContent('rides.meetAt');
      expect(section).toHaveTextContent('Paris CDG Airport');

      // Who drives, and in what.
      expect(within(section).getByText('Bruno')).toBeInTheDocument();
      expect(within(section).getByText('Espace de location')).toBeInTheDocument();

      // Who else is in it — and not the guest whose own leg this dialog is.
      expect(section).toHaveTextContent('Others in the car');
      expect(within(section).getByText('Chloé')).toBeInTheDocument();
      expect(within(section).queryByText('Alice')).not.toBeInTheDocument();
    });

    it('drops the "needs pickup" badge once somebody is driving the leg', () => {
      const { event } = makeRideEvent({ needsPickup: true });

      render(<EventDetailDialog {...defaultProps} event={event} />);

      // The leg is flagged `needsPickup` and its own `driverId` is empty, which
      // is how a leg in a ride is stored. Asking that field alone put an amber
      // "nobody is collecting you" chip directly above a section naming Bruno
      // as the driver — one dialog saying both things at once.
      expect(screen.queryByText('transports.needsPickup')).not.toBeInTheDocument();
      expect(screen.getByTestId('transport-ride-section')).toBeInTheDocument();
    });

    it('keeps the "needs pickup" badge while the ride has no driver', () => {
      const { event } = makeRideEvent({ needsPickup: true, withDriver: false });

      render(<EventDetailDialog {...defaultProps} event={event} />);

      expect(screen.getByText('transports.needsPickup')).toBeInTheDocument();
    });

    it('says so when nobody else is in the car', () => {
      const { event } = makeRideEvent({ withSecondPassenger: false });

      render(<EventDetailDialog {...defaultProps} event={event} />);

      const section = screen.getByTestId('transport-ride-section');
      expect(section).toHaveTextContent('Nobody else in this car');
    });

    it('falls back to "nobody driving" and "no car" when neither is chosen', () => {
      const { event } = makeRideEvent({ withDriver: false, withVehicle: false });

      render(<EventDetailDialog {...defaultProps} event={event} />);

      const section = screen.getByTestId('transport-ride-section');
      expect(section).toHaveTextContent('rides.noDriver');
      expect(section).toHaveTextContent('rides.noVehicle');
    });

    it('renders a legacy driverId-only leg exactly as it did before rides', () => {
      const driver = makePerson({ id: 'p2' as PersonId, name: 'Bruno' });
      const transport = makeTransport({ driverId: driver.id });

      // What `resolveRides` reports for a bare `driverId`: a one-passenger
      // journey flagged `isLegacy`. The dialog must ignore it and keep drawing
      // the old driver row, or every pre-ride trip would sprout a ride section
      // for a car nobody arranged.
      const [journey] = resolveRides({
        transports: [transport],
        rides: [],
        vehicles: [],
        persons: [makePerson(), driver],
      });
      expect(journey?.isLegacy).toBe(true);

      const event = makeTransportEvent({ transport, driver, ride: journey });

      render(<EventDetailDialog {...defaultProps} event={event} />);

      expect(screen.queryByTestId('transport-ride-section')).not.toBeInTheDocument();
      expect(screen.getByText('transports.driver:')).toBeInTheDocument();
      expect(screen.getByText('Bruno')).toBeInTheDocument();
    });
  });

  describe('Actions', () => {
    it('calls onEdit and closes dialog when edit button is clicked', async () => {
      const onEdit = vi.fn();
      const onOpenChange = vi.fn();
      const user = userEvent.setup();

      render(
        <EventDetailDialog
          {...defaultProps}
          onEdit={onEdit}
          onOpenChange={onOpenChange}
          event={makeTransportEvent()}
        />
      );

      await user.click(screen.getByText('common.edit'));
      expect(onEdit).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('opens delete confirmation dialog when delete button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <EventDetailDialog {...defaultProps} event={makeTransportEvent()} />
      );

      await user.click(screen.getByText('common.delete'));

      await waitFor(() => {
        expect(screen.getByText('confirm.deleteTransport')).toBeInTheDocument();
      });
    });

    it('opens assignment-specific delete confirmation', async () => {
      const user = userEvent.setup();

      render(
        <EventDetailDialog {...defaultProps} event={makeAssignmentEvent()} />
      );

      await user.click(screen.getByText('common.delete'));

      await waitFor(() => {
        expect(screen.getByText('confirm.removeAssignment')).toBeInTheDocument();
      });
    });

    it('calls onDelete and closes both dialogs on confirmed delete', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      const onOpenChange = vi.fn();
      const user = userEvent.setup();

      render(
        <EventDetailDialog
          {...defaultProps}
          onDelete={onDelete}
          onOpenChange={onOpenChange}
          event={makeTransportEvent()}
        />
      );

      // Click delete button in the event dialog
      await user.click(screen.getByText('common.delete'));

      const confirm = await screen.findByRole('alertdialog');
      expect(within(confirm).getByText('confirm.deleteTransport')).toBeInTheDocument();

      // Both the footer button and the confirm button read `common.delete`, so
      // the confirm one has to be scoped to the alert dialog. This test used to
      // stop at `expect(confirmBtn).toBeDefined()` and never click it, leaving
      // the whole `onDelete` wiring — the thing it is named for — unverified.
      await user.click(within(confirm).getByRole('button', { name: 'common.delete' }));

      // Both inside the same `waitFor`: `onDelete` is called synchronously and
      // `onOpenChange` only after the await resumes, so a poll landing between
      // the two would see zero calls on an assertion left outside.
      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledOnce();
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
    });

    it('keeps the event dialog open when the delete fails', async () => {
      const onDelete = vi.fn().mockRejectedValue(new Error('Delete failed'));
      const onOpenChange = vi.fn();
      // Restored by the file-level `afterEach`, not by a trailing
      // `mockRestore()`: a failing assertion would skip that line and leave
      // `console.error` stubbed for every later test in the file.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      render(
        <EventDetailDialog
          {...defaultProps}
          onDelete={onDelete}
          onOpenChange={onOpenChange}
          event={makeTransportEvent()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByText('common.delete'));

      const confirm = await screen.findByRole('alertdialog');
      await user.click(within(confirm).getByRole('button', { name: 'common.delete' }));

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledOnce();
      });

      // The row is still there, so the dialog the user would retry from must
      // still be there too.
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByText('Arrival')).toBeInTheDocument();
      expect(consoleError).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// The whole guest, under the booking
// ============================================================================

// A pill on the calendar is one booking, but the question behind clicking it is
// usually about the guest: when do they land, what did they sign up for, do
// they still owe the kitty.
describe('the guest overview', () => {
  it('shows nothing extra for a booking with no overview gathered', () => {
    render(<EventDetailDialog {...defaultProps} event={makeAssignmentEvent()} />);

    expect(screen.queryByTestId('guest-overview')).not.toBeInTheDocument();
  });

  it('shows the guest’s check-in and check-out', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({ guestOverview: makeGuestOverview() })}
      />,
    );

    const overview = screen.getByTestId('guest-overview');
    expect(within(overview).getByText('Check-in')).toBeInTheDocument();
    expect(within(overview).getByText('Check-out')).toBeInTheDocument();
  });

  it('says what the guest owes the group', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({
          guestOverview: makeGuestOverview({
            balance: { personId: 'person-1' as PersonId, paid: 10, owed: 52, balance: -42 },
            currency: 'EUR',
          }),
        })}
      />,
    );

    const overview = screen.getByTestId('guest-overview');
    expect(within(overview).getByText('Owes the group')).toBeInTheDocument();
    expect(within(overview).getByText(/42/)).toBeInTheDocument();
  });

  it('says when the group owes the guest instead', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({
          guestOverview: makeGuestOverview({
            balance: { personId: 'person-1' as PersonId, paid: 90, owed: 20, balance: 70 },
            currency: 'EUR',
          }),
        })}
      />,
    );

    expect(
      within(screen.getByTestId('guest-overview')).getByText('The group owes them'),
    ).toBeInTheDocument();
  });

  it('distinguishes a settled guest from one with no money lines at all', () => {
    const { rerender } = render(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({ guestOverview: makeGuestOverview() })}
      />,
    );

    expect(screen.getByText('Not on any money line yet')).toBeInTheDocument();

    rerender(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({
          guestOverview: makeGuestOverview({
            balance: { personId: 'person-1' as PersonId, paid: 30, owed: 30, balance: 0 },
            currency: 'EUR',
          }),
        })}
      />,
    );

    expect(screen.getByText('Square with the group')).toBeInTheDocument();
  });

  it('does not repeat a leg the dialog already shows in full', () => {
    const leg = makeTransport();

    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({
          relatedTransports: [leg],
          guestOverview: makeGuestOverview({ transports: [leg] }),
        })}
      />,
    );

    expect(
      within(screen.getByTestId('guest-overview')).queryByText('Other travel'),
    ).not.toBeInTheDocument();
  });

  it('lists the guest’s other travel', () => {
    const shown = makeTransport();
    const elsewhere = makeTransport({
      id: 'transport-9' as TransportId,
      type: 'departure',
      location: 'Gare de Lyon',
      datetime: '2026-01-13T08:00:00.000Z',
    });

    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({
          relatedTransports: [shown],
          guestOverview: makeGuestOverview({ transports: [shown, elsewhere] }),
        })}
      />,
    );

    const overview = screen.getByTestId('guest-overview');
    expect(within(overview).getByText('Other travel')).toBeInTheDocument();
    expect(within(overview).getByText('Gare de Lyon')).toBeInTheDocument();
  });
});

// ============================================================================
// Travel listed under a stay
// ============================================================================

describe('the travel listed under a stay', () => {
  function renderLegs(legs: readonly Transport[]) {
    return render(
      <EventDetailDialog {...defaultProps} event={makeAssignmentEvent({ relatedTransports: legs })} />,
    );
  }

  it('marks an arrival with a down arrow, in the arrival colours', () => {
    renderLegs([makeTransport()]);

    const badge = screen.getByText(/↓/);
    expect(badge).toHaveTextContent('↓ Arrival');
    expect(badge).toHaveClass('border-success-border', '[a&]:hover:bg-primary/90');
  });

  it('marks a departure with an up arrow, in the departure colours', () => {
    renderLegs([makeTransport({ type: 'departure' })]);

    const badge = screen.getByText(/↑/);
    expect(badge).toHaveTextContent('↑ Departure');
    expect(badge).toHaveClass('border-departure-border', '[a&]:hover:bg-secondary/90');
  });

  it('names the mode and the service number', () => {
    renderLegs([makeTransport()]);

    expect(screen.getByText('transports.modes.plane · AF1234')).toBeInTheDocument();
  });

  it('falls back to "other" and adds nothing when the leg has no mode or number', () => {
    renderLegs([makeTransport({ transportMode: undefined, transportNumber: undefined })]);

    expect(screen.getByText('transports.modes.other')).toHaveTextContent(/^transports\.modes\.other$/);
  });
});

// ============================================================================
// Transport details
// ============================================================================

describe('a leg opened on its own', () => {
  it('falls back to "other" when the leg has no mode', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeTransportEvent({
          transport: makeTransport({ transportMode: undefined, transportNumber: undefined }),
        })}
      />,
    );

    expect(screen.getByText('transports.modes.other')).toBeInTheDocument();
  });

  it('asks before deleting a leg', async () => {
    const user = userEvent.setup();
    render(<EventDetailDialog {...defaultProps} event={makeTransportEvent()} />);

    await user.click(screen.getByText('common.delete'));

    const prompt = await screen.findByRole('alertdialog');
    expect(within(prompt).getByText('confirm.deleteTransportDescription')).toBeInTheDocument();
  });
});

// ============================================================================
// Activity details
// ============================================================================

describe('an activity', () => {
  function makeActivity(overrides: Partial<Activity> = {}): Activity {
    return {
      id: 'activity-1' as ActivityId,
      tripId: 'trip-1' as TripId,
      title: 'Plant fair',
      category: 'horticulture',
      startDatetime: '2026-01-11T09:00:00',
      endDatetime: '2026-01-11T12:00:00',
      allDay: false,
      participantIds: [],
      ...overrides,
    };
  }

  function makeActivityEvent(overrides: Partial<ActivityEventData> = {}): ActivityEventData {
    return {
      type: 'activity',
      activity: makeActivity(),
      participants: [],
      ...overrides,
    };
  }

  it('is titled after the activity and names its category, day and hours', () => {
    render(<EventDetailDialog {...defaultProps} event={makeActivityEvent()} />);

    expect(screen.getByRole('heading', { name: 'Plant fair' })).toBeInTheDocument();
    expect(screen.getByText('activities.categories.horticulture')).toBeInTheDocument();
    expect(screen.getByText('Sun 11 Jan')).toBeInTheDocument();
    expect(screen.getByText(/^09:00 \S 12:00$/u)).toBeInTheDocument();
  });

  it('says "all day" instead of hours for an all-day activity', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeActivityEvent({ activity: makeActivity({ allDay: true }) })}
      />,
    );

    expect(screen.getByText('activities.allDay')).toBeInTheDocument();
  });

  it('shows the place and gives directions to it', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeActivityEvent({
          activity: makeActivity({
            location: 'Saint-Jean',
            coordinates: { lat: 45.7, lon: 4.8 },
          }),
        })}
      />,
    );

    expect(screen.getByText('Saint-Jean')).toBeInTheDocument();
    expect(screen.getByText('directions')).toHaveAttribute('data-location', 'Saint-Jean');
  });

  it('gives directions under the title when the place has no name', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeActivityEvent({
          activity: makeActivity({ coordinates: { lat: 45.7, lon: 4.8 } }),
        })}
      />,
    );

    expect(screen.getByText('directions')).toHaveAttribute('data-location', 'Plant fair');
  });

  it('counts the guests who signed up and lists them', () => {
    const bob = makePerson({ id: 'p2' as PersonId, name: 'Bob' });
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeActivityEvent({
          activity: makeActivity({ participantIds: [makePerson().id, bob.id] }),
          participants: [makePerson(), bob],
        })}
      />,
    );

    expect(screen.getByText('activities.participantCount')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('activities.full')).not.toBeInTheDocument();
  });

  it('says nobody has signed up yet', () => {
    render(<EventDetailDialog {...defaultProps} event={makeActivityEvent()} />);

    expect(screen.getByText('Nobody has signed up yet')).toBeInTheDocument();
  });

  it('shows the places taken out of the cap, and flags a full activity', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeActivityEvent({
          activity: makeActivity({
            participantIds: ['p1' as PersonId, 'p2' as PersonId],
            maxParticipants: 2,
          }),
        })}
      />,
    );

    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByText('activities.full')).toHaveClass('border-warning');
  });

  it('does not flag an activity with places left', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeActivityEvent({
          activity: makeActivity({
            participantIds: ['p1' as PersonId, 'p2' as PersonId],
            maxParticipants: 3,
          }),
        })}
      />,
    );

    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.queryByText('activities.full')).not.toBeInTheDocument();
  });

  it('names the organiser and shows the notes', () => {
    const organizer = makePerson({ id: 'p9' as PersonId, name: 'Olga' });
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeActivityEvent({
          activity: makeActivity({ notes: 'Bring gloves' }),
          organizer,
        })}
      />,
    );

    expect(screen.getByText('activities.organizer:')).toBeInTheDocument();
    expect(screen.getByText('Olga')).toBeInTheDocument();
    expect(screen.getByText('Bring gloves')).toBeInTheDocument();
  });

  it('asks before deleting an activity', async () => {
    const user = userEvent.setup();
    render(<EventDetailDialog {...defaultProps} event={makeActivityEvent()} />);

    await user.click(screen.getByText('common.delete'));

    const prompt = await screen.findByRole('alertdialog');
    expect(within(prompt).getByText('confirm.deleteActivity')).toBeInTheDocument();
    expect(within(prompt).getByText('confirm.deleteActivityDescription')).toBeInTheDocument();
  });

  it('counts nobody when the activity carries no participant list', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeActivityEvent({
          activity: { ...makeActivity(), participantIds: undefined } as unknown as Activity,
        })}
      />,
    );

    expect(screen.getByText('activities.participantCount')).toBeInTheDocument();
  });

  it('tints the category icon with the category colour', () => {
    render(<EventDetailDialog {...defaultProps} event={makeActivityEvent()} />);

    const icon = screen.getByText('activities.categories.horticulture').previousElementSibling;
    expect(icon).toHaveStyle({ color: '#16a34a' });
  });

  it('gives the place and the notes a row of their own', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeActivityEvent({
          activity: makeActivity({ location: 'Saint-Jean', notes: 'Bring gloves' }),
        })}
      />,
    );

    expect(screen.getByText('Saint-Jean').tagName).toBe('SPAN');
    expect(screen.getByText('Saint-Jean').previousElementSibling?.tagName.toLowerCase()).toBe('svg');
    expect(screen.getByText('Bring gloves')).toHaveClass('rounded-md', 'bg-muted/50', 'p-3');
  });
});

// ============================================================================
// Details the first pass left loose
// ============================================================================

describe('EventDetailDialog details', () => {
  /** An offset-less leg, so the rendered day does not move with the runner. */
  function localLeg(overrides: Partial<Transport> = {}): Transport {
    return makeTransport({ datetime: '2026-01-10T14:30:00', ...overrides });
  }

  it('dates a leg in full', () => {
    render(
      <EventDetailDialog {...defaultProps} event={makeTransportEvent({ transport: localLeg() })} />,
    );

    expect(screen.getByText('January 10th, 2026')).toBeInTheDocument();
  });

  it('dates the travel listed under a stay in full', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({ relatedTransports: [localLeg()] })}
      />,
    );

    expect(screen.getByText('January 10th, 2026')).toBeInTheDocument();
  });

  it('shows no travel section for an empty list of legs', () => {
    render(
      <EventDetailDialog {...defaultProps} event={makeAssignmentEvent({ relatedTransports: [] })} />,
    );

    expect(screen.queryByText('Travel')).not.toBeInTheDocument();
  });

  it('marks the badge of an arrival and of a departure with their variants', () => {
    const { rerender } = render(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({
          relatedTransports: [localLeg(), localLeg({ id: 'out' as TransportId, type: 'departure' })],
        })}
      />,
    );

    expect(screen.getByText(/↓/)).toHaveAttribute('data-variant', 'default');
    expect(screen.getByText(/↑/)).toHaveAttribute('data-variant', 'secondary');

    rerender(
      <EventDetailDialog
        {...defaultProps}
        event={makeTransportEvent({ transport: localLeg({ type: 'departure' }) })}
      />,
    );
    const departure = screen.getByText('↑');
    expect(departure).toHaveAttribute('data-variant', 'secondary');
    expect(departure).toHaveClass('border-departure-border');

    rerender(<EventDetailDialog {...defaultProps} event={makeTransportEvent({ transport: localLeg() })} />);
    const arrival = screen.getByText('↓');
    expect(arrival).toHaveAttribute('data-variant', 'default');
    expect(arrival).toHaveClass('border-success-border');
  });

  it('gives the place and the notes of a leg rows of their own', () => {
    render(
      <EventDetailDialog
        {...defaultProps}
        event={makeTransportEvent({ transport: localLeg({ notes: 'Gate B42' }) })}
      />,
    );

    expect(screen.getByText('Paris CDG Airport').tagName).toBe('SPAN');
    expect(
      screen.getByText('Paris CDG Airport').previousElementSibling?.tagName.toLowerCase(),
    ).toBe('svg');
    expect(screen.getByText('Gate B42')).toHaveClass('rounded-md', 'p-3');
  });

  it('offers directions to a leg only when it has a position', () => {
    const { rerender } = render(
      <EventDetailDialog {...defaultProps} event={makeTransportEvent({ transport: localLeg() })} />,
    );
    expect(screen.queryByText('directions')).not.toBeInTheDocument();

    rerender(
      <EventDetailDialog
        {...defaultProps}
        event={makeTransportEvent({
          transport: localLeg({ coordinates: { lat: 48.8, lon: 2.35 } }),
        })}
      />,
    );
    expect(screen.getByText('directions')).toHaveAttribute('data-location', 'Paris CDG Airport');
  });

  it('heads the car that serves the leg', () => {
    const { event } = makeRideEvent();
    render(<EventDetailDialog {...defaultProps} event={event} />);

    expect(screen.getByRole('heading', { name: 'Ride' })).toBeInTheDocument();
  });

  it('drops the pickup badge when a ride with a driver arrives while open', () => {
    const { event } = makeRideEvent({ needsPickup: true });
    const { rerender } = render(
      <EventDetailDialog
        {...defaultProps}
        event={{ ...event, ride: undefined }}
      />,
    );
    expect(screen.getByText('transports.needsPickup')).toBeInTheDocument();

    rerender(<EventDetailDialog {...defaultProps} event={event} />);

    expect(screen.queryByText('transports.needsPickup')).not.toBeInTheDocument();
  });

  it('draws the room icon, and redraws it when the room changes', () => {
    const { rerender } = render(<EventDetailDialog {...defaultProps} event={makeAssignmentEvent()} />);
    expect(screen.getByText('Blue Room').previousElementSibling).toHaveClass('lucide-bed-double');

    rerender(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({ room: makeRoom({ icon: 'bed-single' }) })}
      />,
    );
    expect(screen.getByText('Blue Room').previousElementSibling).toHaveClass('lucide-bed-single');
  });

  it('lists a leg under "other travel" once the stay stops showing it', () => {
    const leg = localLeg();
    const overview = makeGuestOverview({ transports: [leg] });
    const { rerender } = render(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({ relatedTransports: [leg], guestOverview: overview })}
      />,
    );
    expect(screen.queryByText('Other travel')).not.toBeInTheDocument();

    rerender(
      <EventDetailDialog
        {...defaultProps}
        event={makeAssignmentEvent({ relatedTransports: undefined, guestOverview: overview })}
      />,
    );
    expect(screen.getByText('Other travel')).toBeInTheDocument();
  });

  it('shows no delete prompt until Delete is pressed', () => {
    render(<EventDetailDialog {...defaultProps} event={makeTransportEvent()} />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('closes the delete prompt on Cancel', async () => {
    const user = userEvent.setup();
    render(<EventDetailDialog {...defaultProps} event={makeTransportEvent()} />);

    await user.click(screen.getByText('common.delete'));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  it('keeps the prompt while a delete is still running', async () => {
    const user = userEvent.setup();
    render(
      <EventDetailDialog
        {...defaultProps}
        onDelete={() => new Promise<void>(() => undefined)}
        event={makeTransportEvent()}
      />,
    );

    await user.click(screen.getByText('common.delete'));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: 'common.delete' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('lets Escape close the prompt once a delete has stalled', async () => {
    // A delete that never settles (a write blocked by another tab, say) must
    // not hold the prompt forever: past STALL_TIMEOUT_MS the prompt offers its
    // way out again, and the event dialog must not take it back.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(
        <EventDetailDialog
          {...defaultProps}
          onDelete={() => new Promise<void>(() => undefined)}
          event={makeTransportEvent()}
        />,
      );

      await user.click(screen.getByText('common.delete'));
      const prompt = await screen.findByRole('alertdialog');
      await user.click(within(prompt).getByRole('button', { name: 'common.delete' }));
      await act(async () => {
        vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000);
      });
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the delete failed, and lets the prompt be cancelled after', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const notifyError = vi.spyOn(notify, 'error').mockImplementation(() => undefined);
    const onDelete = vi.fn().mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<EventDetailDialog {...defaultProps} onDelete={onDelete} event={makeTransportEvent()} />);

    await user.click(screen.getByText('common.delete'));
    let prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: 'common.delete' }));
    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith('Failed to delete', expect.anything());
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    await user.click(screen.getByText('common.delete'));
    prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });
});
