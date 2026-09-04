/**
 * @fileoverview Unit tests for EventDetailDialog component.
 * Tests type guards, assignment detail rendering, and action flows.
 * @module features/calendar/components/__tests__/EventDetailDialog.test
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  EventDetailDialog,
  isAssignmentEvent,
  isTransportEvent,
  type AssignmentEventData,
  type TransportEventData,
} from '../EventDetailDialog';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
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
  DirectionsButton: () => <button>directions</button>,
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

function makeTransportEvent(overrides: Partial<TransportEventData> = {}): TransportEventData {
  return {
    type: 'transport',
    transport: makeTransport(),
    person: makePerson(),
    ...overrides,
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
