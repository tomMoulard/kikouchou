/**
 * @fileoverview Integration tests for Transport Event Detail Dialog (Phase 18.7).
 *
 * Tests the complete flow of clicking transport events in the calendar
 * and viewing/editing/deleting transport details through the dialog.
 *
 * @module features/calendar/__tests__/TransportEventDetail.integration.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  EventDetailDialog,
  type AssignmentEventData,
  type TransportEventData,
} from '../components/EventDetailDialog';
import { TransportIndicator } from '../components/TransportIndicator';
import type { Person, Transport } from '@/types';
import type { CalendarTransport } from '../types';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates a test person with all required fields.
 */
function createTestPerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'person-1' as import('@/types').PersonId,
    tripId: 'trip-1' as import('@/types').TripId,
    name: 'Alice',
    color: '#3b82f6' as import('@/types').HexColor,
    ...overrides,
  };
}

/**
 * Creates a test transport with all required fields.
 */
function createTestTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    id: 'transport-1' as import('@/types').TransportId,
    tripId: 'trip-1' as import('@/types').TripId,
    personId: 'person-1' as import('@/types').PersonId,
    type: 'arrival',
    datetime: '2024-01-15T14:30:00.000Z',
    location: 'Paris Charles de Gaulle Airport',
    transportMode: 'plane',
    transportNumber: 'AF1234',
    needsPickup: true,
    notes: 'Terminal 2E, gate B42. Call when landed.',
    ...overrides,
  };
}

/**
 * Creates a calendar transport wrapper.
 */
function createCalendarTransport(
  transport: Transport = createTestTransport(),
  person: Person = createTestPerson(),
): CalendarTransport {
  return {
    transport,
    person,
    personName: person.name,
    color: person.color,
  };
}

/**
 * Creates a transport event data object for EventDetailDialog.
 */
function createTransportEventData(
  transport: Transport = createTestTransport(),
  person: Person = createTestPerson(),
  driver?: Person,
): TransportEventData {
  return {
    type: 'transport',
    transport,
    person,
    driver,
  };
}

// ============================================================================
// TransportIndicator Tests
// ============================================================================

describe('TransportIndicator', () => {
  describe('Basic Rendering', () => {
    it('renders transport details', () => {
      const transport = createCalendarTransport();

      render(
        <TransportIndicator transport={transport} type="arrival" />
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText(/Paris Charles de Gaulle/)).toBeInTheDocument();
    });

    it('renders arrival type with green styling', () => {
      const transport = createCalendarTransport();

      render(
        <TransportIndicator transport={transport} type="arrival" />
      );

      const indicator = screen.getByLabelText('calendar.personArriving');
      // Check it has arrival styling classes (green)
      expect(indicator.className).toContain('bg-green');
    });

    it('renders departure type with orange styling', () => {
      const transport = createCalendarTransport(
        createTestTransport({ type: 'departure' }),
      );

      render(
        <TransportIndicator transport={transport} type="departure" />
      );

      const indicator = screen.getByLabelText('calendar.personDeparting');
      // Check it has departure styling classes (orange)
      expect(indicator.className).toContain('bg-orange');
    });

    it('displays time correctly', () => {
      const transport = createCalendarTransport(
        createTestTransport({ datetime: '2024-01-15T14:30:00.000Z' }),
      );

      render(
        <TransportIndicator transport={transport} type="arrival" />
      );

      // Time should be formatted (depends on locale, but should contain numbers)
      expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
    });

    it('displays transport mode icon', () => {
      const transport = createCalendarTransport(
        createTestTransport({ transportMode: 'plane' }),
      );

      render(
        <TransportIndicator transport={transport} type="arrival" />
      );

      // Transport icon should be present (lucide icon)
      const svg = document.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Interactive Mode', () => {
    it('renders as button when onClick is provided', () => {
      const transport = createCalendarTransport();
      const onClick = vi.fn();

      render(
        <TransportIndicator transport={transport} type="arrival" onClick={onClick} />
      );

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders as div when onClick is not provided', () => {
      const transport = createCalendarTransport();

      render(
        <TransportIndicator transport={transport} type="arrival" />
      );

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('calls onClick when clicked', async () => {
      const user = userEvent.setup();
      const transport = createCalendarTransport();
      const onClick = vi.fn();

      render(
        <TransportIndicator transport={transport} type="arrival" onClick={onClick} />
      );

      await user.click(screen.getByRole('button'));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onClick).toHaveBeenCalledWith(transport);
    });

    it('has correct aria-label when interactive', () => {
      const transport = createCalendarTransport();
      const onClick = vi.fn();

      render(
        <TransportIndicator transport={transport} type="arrival" onClick={onClick} />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label');
      // The aria-label uses i18n key which is mocked to return the key
      expect(button.getAttribute('aria-label')).toContain('calendar.viewTransportDetails');
    });

    it('supports keyboard activation with Enter', async () => {
      const user = userEvent.setup();
      const transport = createCalendarTransport();
      const onClick = vi.fn();

      render(
        <TransportIndicator transport={transport} type="arrival" onClick={onClick} />
      );

      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard('{Enter}');

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('supports keyboard activation with Space', async () => {
      const user = userEvent.setup();
      const transport = createCalendarTransport();
      const onClick = vi.fn();

      render(
        <TransportIndicator transport={transport} type="arrival" onClick={onClick} />
      );

      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard(' ');

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('has focus-visible styling', () => {
      const transport = createCalendarTransport();
      const onClick = vi.fn();

      render(
        <TransportIndicator transport={transport} type="arrival" onClick={onClick} />
      );

      const button = screen.getByRole('button');
      expect(button.className).toContain('focus-visible:ring');
    });
  });
});

// ============================================================================
// EventDetailDialog - Transport Event Tests
// ============================================================================

describe('EventDetailDialog - Transport Events', () => {
  describe('View Transport Details', () => {
    it('displays dialog title based on transport type - arrival', () => {
      const event = createTransportEventData(
        createTestTransport({ type: 'arrival' }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // Title should contain "Arrival" (from i18n mock returns key)
      expect(screen.getByText('transports.arrival')).toBeInTheDocument();
    });

    it('displays dialog title based on transport type - departure', () => {
      const event = createTransportEventData(
        createTestTransport({ type: 'departure' }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.getByText('transports.departure')).toBeInTheDocument();
    });

    it('displays arrival badge with correct styling', () => {
      const event = createTransportEventData(
        createTestTransport({ type: 'arrival' }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Find the badge with the arrow indicator
      const badge = screen.getByText('↓');
      expect(badge).toBeInTheDocument();
      // Green styling for arrivals
      expect(badge.className).toContain('bg-green');
    });

    it('displays departure badge with correct styling', () => {
      const event = createTransportEventData(
        createTestTransport({ type: 'departure' }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Find the badge with the arrow indicator
      const badge = screen.getByText('↑');
      expect(badge).toBeInTheDocument();
      // Orange styling for departures
      expect(badge.className).toContain('bg-orange');
    });

    it('displays person name with PersonBadge', () => {
      const person = createTestPerson({ name: 'Alice' });
      const event = createTransportEventData(createTestTransport(), person);
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('displays transport mode', () => {
      const event = createTransportEventData(
        createTestTransport({ transportMode: 'plane' }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Mode label from i18n mock
      expect(screen.getByText(/transports\.modes\.plane/)).toBeInTheDocument();
    });

    it('displays transport number when available', () => {
      const event = createTransportEventData(
        createTestTransport({ transportNumber: 'AF1234' }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.getByText(/AF1234/)).toBeInTheDocument();
    });

    it('displays location when available', () => {
      const event = createTransportEventData(
        createTestTransport({ location: 'Paris Charles de Gaulle Airport' }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.getByText('Paris Charles de Gaulle Airport')).toBeInTheDocument();
    });

    it('displays driver when assigned', () => {
      const driver = createTestPerson({
        id: 'person-2' as import('@/types').PersonId,
        name: 'Pierre',
        color: '#ef4444' as import('@/types').HexColor,
      });
      const event = createTransportEventData(createTestTransport(), createTestPerson(), driver);
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Driver label and name should be present (label includes colon)
      expect(screen.getByText(/transports\.driver/)).toBeInTheDocument();
      expect(screen.getByText('Pierre')).toBeInTheDocument();
    });

    it('does not display driver section when not assigned', () => {
      const event = createTransportEventData(createTestTransport());
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Driver label should not be present
      expect(screen.queryByText('transports.driver')).not.toBeInTheDocument();
    });

    it('displays pickup badge when needsPickup is true', () => {
      const event = createTransportEventData(
        createTestTransport({ needsPickup: true }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.getByText('transports.needsPickup')).toBeInTheDocument();
    });

    it('does not display pickup badge when needsPickup is false', () => {
      const event = createTransportEventData(
        createTestTransport({ needsPickup: false }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.queryByText('transports.needsPickup')).not.toBeInTheDocument();
    });

    it('displays notes when available', () => {
      const event = createTransportEventData(
        createTestTransport({ notes: 'Terminal 2E, gate B42. Call when landed.' }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.getByText('Terminal 2E, gate B42. Call when landed.')).toBeInTheDocument();
    });

    it('does not display notes section when not available', () => {
      const event = createTransportEventData(
        createTestTransport({ notes: undefined }),
      );
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Notes section should not be present
      expect(screen.queryByText(/Terminal/)).not.toBeInTheDocument();
    });

    it('handles unknown person gracefully', () => {
      const event: TransportEventData = {
        type: 'transport',
        transport: createTestTransport(),
        person: undefined,
      };
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Should show "Unknown" placeholder
      expect(screen.getByText('common.unknown')).toBeInTheDocument();
    });

    it('does not render dialog when closed', () => {
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={false}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders loading state when event is null', () => {
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={null}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });
  });

  describe('Edit Transport', () => {
    it('renders Edit button', () => {
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      const editButton = screen.getByRole('button', { name: /common\.edit/i });
      expect(editButton).toBeInTheDocument();
    });

    it('calls onEdit when Edit button is clicked', async () => {
      const user = userEvent.setup();
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      await user.click(screen.getByRole('button', { name: /common\.edit/i }));

      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('closes dialog after Edit click', async () => {
      const user = userEvent.setup();
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      await user.click(screen.getByRole('button', { name: /common\.edit/i }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('Delete Transport', () => {
    it('renders Delete button', () => {
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      const deleteButton = screen.getByRole('button', { name: /common\.delete/i });
      expect(deleteButton).toBeInTheDocument();
    });

    it('opens confirmation dialog when Delete clicked', async () => {
      const user = userEvent.setup();
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      await user.click(screen.getByRole('button', { name: /common\.delete/i }));

      // Confirmation dialog should open
      await waitFor(() => {
        expect(screen.getByText('transports.deleteConfirmTitle')).toBeInTheDocument();
      });
    });

    it('shows correct confirmation message for transport', async () => {
      const user = userEvent.setup();
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      await user.click(screen.getByRole('button', { name: /common\.delete/i }));

      await waitFor(() => {
        expect(screen.getByText('transports.deleteConfirm')).toBeInTheDocument();
      });
    });

    it('calls onDelete when delete is confirmed', async () => {
      const user = userEvent.setup();
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Click delete to open confirmation
      await user.click(screen.getByRole('button', { name: /common\.delete/i }));

      // Wait for confirmation dialog
      await waitFor(() => {
        expect(screen.getByText('transports.deleteConfirmTitle')).toBeInTheDocument();
      });

      // Find all dialogs and get the confirmation dialog
      const dialogs = screen.getAllByRole('dialog');
      const confirmDialog = dialogs[dialogs.length - 1]!; // Confirmation dialog is the second one (non-null assertion)

      // Click confirm button in the confirmation dialog
      const confirmButton = within(confirmDialog).getByRole('button', { name: /common\.delete/i });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledTimes(1);
      });
    });

    it('closes both dialogs on successful delete', async () => {
      const user = userEvent.setup();
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Click delete
      await user.click(screen.getByRole('button', { name: /common\.delete/i }));

      await waitFor(() => {
        expect(screen.getByText('transports.deleteConfirmTitle')).toBeInTheDocument();
      });

      // Get confirmation dialog
      const dialogs = screen.getAllByRole('dialog');
      const confirmDialog = dialogs[dialogs.length - 1]!;

      // Confirm delete
      const confirmButton = within(confirmDialog).getByRole('button', { name: /common\.delete/i });
      await user.click(confirmButton);

      // Main dialog should close
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('does not close dialog on delete error', async () => {
      const user = userEvent.setup();
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockRejectedValue(new Error('Delete failed'));

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Click delete
      await user.click(screen.getByRole('button', { name: /common\.delete/i }));

      await waitFor(() => {
        expect(screen.getByText('transports.deleteConfirmTitle')).toBeInTheDocument();
      });

      // Get confirmation dialog
      const dialogs = screen.getAllByRole('dialog');
      const confirmDialog = dialogs[dialogs.length - 1]!;

      // Confirm delete
      const confirmButton = within(confirmDialog).getByRole('button', { name: /common\.delete/i });
      await user.click(confirmButton);

      // Wait for error handling
      await waitFor(() => {
        expect(onDelete).toHaveBeenCalled();
      });

      // Main dialog should NOT close on error
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it('cancels delete when Cancel clicked in confirmation', async () => {
      const user = userEvent.setup();
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Click delete
      await user.click(screen.getByRole('button', { name: /common\.delete/i }));

      await waitFor(() => {
        expect(screen.getByText('transports.deleteConfirmTitle')).toBeInTheDocument();
      });

      // Get confirmation dialog
      const dialogs = screen.getAllByRole('dialog');
      const confirmDialog = dialogs[dialogs.length - 1]!;

      // Click cancel
      const cancelButton = within(confirmDialog).getByRole('button', { name: /common\.cancel/i });
      await user.click(cancelButton);

      // onDelete should NOT be called
      expect(onDelete).not.toHaveBeenCalled();
      
      // Main dialog should still be open (onOpenChange not called with false)
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  describe('Accessibility', () => {
    it('has role="dialog"', () => {
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has accessible title', () => {
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // DialogTitle should be present
      expect(screen.getByText('transports.arrival')).toBeInTheDocument();
    });

    it('Edit button has icon with aria-hidden', () => {
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      const editButton = screen.getByRole('button', { name: /common\.edit/i });
      const icon = editButton.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('Delete button has icon with aria-hidden', () => {
      const event = createTransportEventData();
      const onOpenChange = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn().mockResolvedValue(undefined);

      render(
        <EventDetailDialog
          open={true}
          onOpenChange={onOpenChange}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      const deleteButton = screen.getByRole('button', { name: /common\.delete/i });
      const icon = deleteButton.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
  });
});

// ============================================================================
// EventDetailDialog - Assignment Event Tests (for comparison)
// ============================================================================

describe('EventDetailDialog - Assignment Events', () => {
  /**
   * Creates an assignment event data object.
   */
  function createAssignmentEventData(): AssignmentEventData {
    return {
      type: 'assignment',
      assignment: {
        id: 'assignment-1' as import('@/types').RoomAssignmentId,
        tripId: 'trip-1' as import('@/types').TripId,
        roomId: 'room-1' as import('@/types').RoomId,
        personId: 'person-1' as import('@/types').PersonId,
        startDate: '2024-01-15' as import('@/types').ISODateString,
        endDate: '2024-01-20' as import('@/types').ISODateString,
      },
      person: createTestPerson(),
      room: {
        id: 'room-1' as import('@/types').RoomId,
        tripId: 'trip-1' as import('@/types').TripId,
        name: 'Master Bedroom',
        capacity: 2,
        order: 0,
      },
    };
  }

  it('displays assignment details correctly', () => {
    const event = createAssignmentEventData();
    const onOpenChange = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <EventDetailDialog
        open={true}
        onOpenChange={onOpenChange}
        event={event}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Master Bedroom')).toBeInTheDocument();
    // Title should be assignments.title
    expect(screen.getByText('assignments.title')).toBeInTheDocument();
  });

  it('shows correct delete confirmation for assignment', async () => {
    const user = userEvent.setup();
    const event = createAssignmentEventData();
    const onOpenChange = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <EventDetailDialog
        open={true}
        onOpenChange={onOpenChange}
        event={event}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByRole('button', { name: /common\.delete/i }));

    await waitFor(() => {
      expect(screen.getByText('assignments.deleteConfirmTitle')).toBeInTheDocument();
      expect(screen.getByText('assignments.deleteConfirm')).toBeInTheDocument();
    });
  });
});
