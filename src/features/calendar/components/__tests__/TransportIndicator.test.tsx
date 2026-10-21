/**
 * @fileoverview Tests for the TransportIndicator component.
 * @module features/calendar/components/__tests__/TransportIndicator.test
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/utils';
import { resolveRides } from '@/features/transports/utils/ride-model';
import { TransportIndicator } from '../TransportIndicator';
import type { CalendarTransport } from '../../types';
import type {
  HexColor,
  ISODateTimeString,
  Person,
  PersonId,
  Ride,
  RideId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function makeTransport(overrides: Partial<CalendarTransport & { type: 'arrival' | 'departure' }> = {}): {
  transport: CalendarTransport;
  type: 'arrival' | 'departure';
} {
  const transport: CalendarTransport = {
    transport: {
      id: 'transport-1' as TransportId,
      tripId: 'trip-1' as TripId,
      personId: 'person-1' as PersonId,
      type: overrides.type ?? 'arrival',
      datetime: '2026-07-15T14:30:00' as ISODateTimeString,
      location: 'Paris Gare du Nord',
      needsPickup: false,
      transportMode: 'train',
    },
    person: undefined,
    personName: overrides.personName ?? 'Alice',
    color: (overrides.color ?? '#3b82f6') as HexColor,
    ...overrides,
  };

  return {
    transport,
    type: transport.transport.type,
  };
}

/** The guest at the wheel, so a ride can name somebody the trip holds. */
const driver: Person = {
  id: 'person-2' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Bruno',
  color: '#f97316' as HexColor,
};

/**
 * Puts a calendar transport in a real car.
 *
 * The journey goes through `resolveRides` rather than being hand-written, so
 * the pill is tested against the shape the page actually hands it.
 *
 * The meeting time is a `…Z` instant, 15 minutes before the leg's own. Nothing
 * here asserts a rendered clock, and a bare literal would land the leg inside
 * or outside the ride's match window depending on the runner's offset.
 */
function withRide(
  calendarTransport: CalendarTransport,
  options: { readonly withDriver?: boolean } = {},
): { readonly calendarTransport: CalendarTransport } {
  const { withDriver = true } = options;

  const ride: Ride = {
    id: 'ride-1' as RideId,
    tripId: 'trip-1' as TripId,
    direction: 'pickup',
    meetDatetime: '2026-07-15T12:45:00.000Z' as ISODateTimeString,
    location: 'Paris Gare du Nord',
    ...(withDriver ? { driverId: driver.id } : {}),
  };

  const leg: Transport = { ...calendarTransport.transport, rideId: ride.id };

  const [journey] = resolveRides({
    transports: [leg],
    rides: [ride],
    vehicles: [],
    persons: [driver],
  });

  return {
    calendarTransport: { ...calendarTransport, transport: leg, ride: journey },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportIndicator', () => {
  it('renders arrival indicator with down arrow', () => {
    const { transport, type } = makeTransport({ type: 'arrival' });
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('renders departure indicator with up arrow', () => {
    const { transport, type } = makeTransport({ type: 'departure' });
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText('↑')).toBeInTheDocument();
  });

  it('displays person name', () => {
    const { transport, type } = makeTransport({ personName: 'Bob' });
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('displays time', () => {
    const { transport, type } = makeTransport();
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText('14:30')).toBeInTheDocument();
  });

  it('displays location', () => {
    const { transport, type } = makeTransport();
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText(/Paris Gare du Nord/)).toBeInTheDocument();
  });

  it('renders as a div when no onClick is provided', () => {
    const { transport, type } = makeTransport();
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders as a button when onClick is provided', () => {
    const { transport, type } = makeTransport();
    const onClick = vi.fn();
    render(
      <TransportIndicator transport={transport} type={type} onClick={onClick} />,
      { withProviders: false },
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls onClick with transport data when clicked', async () => {
    const { transport, type } = makeTransport();
    const onClick = vi.fn();
    const { user } = render(
      <TransportIndicator transport={transport} type={type} onClick={onClick} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(transport);
  });

  it('has proper aria-label for interactive arrival', () => {
    const { transport, type } = makeTransport({ type: 'arrival' });
    const onClick = vi.fn();
    render(
      <TransportIndicator transport={transport} type={type} onClick={onClick} />,
      { withProviders: false },
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', expect.stringContaining('calendar.viewTransportDetails'));
  });

  it('has title attribute with transport details', () => {
    const { transport, type } = makeTransport({ personName: 'Charlie' });
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    const indicator = screen.getByTitle(/14:30 Charlie/);
    expect(indicator).toBeInTheDocument();
  });

  // A pill three words wide cannot spell out the arrangement, but it must not
  // keep it secret either: the glyph is always paired with a name in the
  // tooltip and the accessible label.
  describe('a leg that travels in a car', () => {
    it('marks the pill and names the driver in its label', () => {
      const { transport, type } = makeTransport();
      const { calendarTransport } = withRide(transport);
      const onClick = vi.fn();

      render(
        <TransportIndicator transport={calendarTransport} type={type} onClick={onClick} />,
        { withProviders: false },
      );

      expect(screen.getByTestId('ride-glyph')).toBeInTheDocument();

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute(
        'aria-label',
        expect.stringContaining('rides.partOfRideWithDriver'),
      );
      expect(button).toHaveAttribute(
        'title',
        expect.stringContaining('rides.partOfRideWithDriver'),
      );
    });

    it('still says "shared ride" when nobody is driving it yet', () => {
      const { transport, type } = makeTransport();
      const { calendarTransport } = withRide(transport, { withDriver: false });

      render(<TransportIndicator transport={calendarTransport} type={type} />, {
        withProviders: false,
      });

      expect(screen.getByTestId('ride-glyph')).toBeInTheDocument();
      expect(screen.getByTitle(/rides\.partOfRide$/)).toBeInTheDocument();
    });

    it('renders a legacy driverId-only leg exactly as it did before rides', () => {
      const { transport, type } = makeTransport();
      const legacyLeg: Transport = { ...transport.transport, driverId: driver.id };

      // What `resolveRides` reports for a bare `driverId`: a one-passenger
      // journey flagged `isLegacy`. The pill must ignore it — nobody has
      // arranged a shared car, and a glyph would say they had.
      const [journey] = resolveRides({
        transports: [legacyLeg],
        rides: [],
        vehicles: [],
        persons: [driver],
      });
      expect(journey?.isLegacy).toBe(true);

      render(
        <TransportIndicator
          transport={{ ...transport, transport: legacyLeg, ride: journey }}
          type={type}
        />,
        { withProviders: false },
      );

      expect(screen.queryByTestId('ride-glyph')).not.toBeInTheDocument();
      expect(screen.getByTitle('14:30 Alice - Paris Gare du Nord')).toBeInTheDocument();
    });

    it('appends the ride to the label it already had', () => {
      const { transport, type } = makeTransport();
      const { calendarTransport } = withRide(transport);

      render(<TransportIndicator transport={calendarTransport} type={type} />, {
        withProviders: false,
      });

      const pill = screen.getByLabelText(/calendar\.personArriving/);
      expect(pill).toHaveAttribute('aria-label', 'calendar.personArriving · rides.partOfRideWithDriver');
      expect(pill).toHaveAttribute(
        'title',
        '14:30 Alice - Paris Gare du Nord · rides.partOfRideWithDriver',
      );
    });
  });

  describe('labels, colours and keys', () => {
    it.each([
      ['arrival', 'calendar.personArriving', 'border-success-border'],
      ['departure', 'calendar.personDeparting', 'border-departure-border'],
    ] as const)('names a read-only %s and colours it', (type, label, tone) => {
      const { transport } = makeTransport({ type });
      render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });

      const pill = screen.getByLabelText(label);
      expect(pill).toHaveAttribute('aria-label', label);
      expect(pill).toHaveClass('flex', 'rounded', 'border', 'min-h-[44px]', tone);
      expect(pill).not.toHaveClass('cursor-pointer');
    });

    it('names a tappable leg after its details and makes it look tappable', () => {
      const { transport, type } = makeTransport();
      render(<TransportIndicator transport={transport} type={type} onClick={vi.fn()} />, {
        withProviders: false,
      });

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'calendar.viewTransportDetails');
      expect(button).toHaveClass('cursor-pointer', 'hover:opacity-80', 'focus-visible:ring-2');
    });

    it('leaves the place out of a leg that has none', () => {
      const { transport, type } = makeTransport();
      render(
        <TransportIndicator
          transport={{ ...transport, transport: { ...transport.transport, location: '' } }}
          type={type}
        />,
        { withProviders: false },
      );

      expect(screen.getByTitle('14:30 Alice')).toBeInTheDocument();
      expect(screen.queryByText(/^- /)).not.toBeInTheDocument();
    });

    it('carries the guest colour on its dot', () => {
      const { transport, type } = makeTransport({ color: '#abcdef' as HexColor });
      const { container } = render(<TransportIndicator transport={transport} type={type} />, {
        withProviders: false,
      });

      expect(container.querySelector('.rounded-full')).toHaveStyle({ backgroundColor: '#abcdef' });
    });

    it.each(['Enter', ' '])('opens the leg on the %j key', (key) => {
      const { transport, type } = makeTransport();
      const onClick = vi.fn();
      render(<TransportIndicator transport={transport} type={type} onClick={onClick} />, {
        withProviders: false,
      });

      expect(fireEvent.keyDown(screen.getByRole('button'), { key })).toBe(false);
      expect(onClick).toHaveBeenCalledWith(transport);
    });

    it('leaves every other key to the browser', () => {
      const { transport, type } = makeTransport();
      const onClick = vi.fn();
      render(<TransportIndicator transport={transport} type={type} onClick={onClick} />, {
        withProviders: false,
      });

      expect(fireEvent.keyDown(screen.getByRole('button'), { key: 'a' })).toBe(true);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('draws the icon of the mode, and a neutral one for a leg with none', () => {
      const { transport, type } = makeTransport();
      const { container, rerender } = render(<TransportIndicator transport={transport} type={type} />, {
        withProviders: false,
      });
      expect(container.querySelector('svg.lucide-tram-front')).not.toBeNull();

      rerender(
        <TransportIndicator
          transport={{ ...transport, transport: { ...transport.transport, transportMode: undefined } }}
          type={type}
        />,
      );
      expect(container.querySelector('svg.lucide-circle-dot')).not.toBeNull();
    });

    it('prefixes the place with a dash in its own span', () => {
      const { transport, type } = makeTransport();
      render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });

      expect(screen.getByText('- Paris Gare du Nord')).toHaveClass('truncate', 'opacity-75');
    });

    it('fades on hover once it can be tapped', () => {
      const { transport, type } = makeTransport();
      render(<TransportIndicator transport={transport} type={type} onClick={vi.fn()} />, {
        withProviders: false,
      });

      expect(screen.getByRole('button')).toHaveClass('transition-opacity');
    });

    it('opens with the handler it was last given', () => {
      const { transport, type } = makeTransport();
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = render(
        <TransportIndicator transport={transport} type={type} onClick={first} />,
        { withProviders: false },
      );

      rerender(<TransportIndicator transport={transport} type={type} onClick={second} />);
      const button = screen.getByRole('button');
      fireEvent.click(button);
      fireEvent.keyDown(button, { key: 'Enter' });

      expect(second).toHaveBeenCalledTimes(2);
      expect(first).not.toHaveBeenCalled();
    });
  });
});
