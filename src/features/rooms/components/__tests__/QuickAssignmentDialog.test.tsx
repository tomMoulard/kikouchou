/**
 * @fileoverview Tests for QuickAssignmentDialog component.
 * @module features/rooms/components/__tests__/QuickAssignmentDialog.test
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAssignmentDialog } from '../QuickAssignmentDialog';
import type { Person, PersonId, Room, RoomId, Trip } from '@/types';

// ============================================================================
// Mock Data
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockPerson: Person = {
  id: 'p1' as PersonId,
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

/** Bob, whose headcount some tests raise to make one row fill two beds. */
function makeBob(headcount?: number): Person {
  return {
    id: 'p2' as PersonId,
    tripId: 'trip-1' as Person['tripId'],
    name: 'Bob',
    color: '#ef4444' as Person['color'],
    ...(headcount === undefined ? {} : { headcount }),
  };
}

/** Reassigned per test, so a headcount change cannot leak into the next one. */
let mockPersons: Person[] = [mockPerson, makeBob()];

const mockRoom: Room = {
  id: 'room-1' as RoomId,
  tripId: 'trip-1' as Room['tripId'],
  name: 'Main Bedroom',
  capacity: 2,
  order: 0,
};

// ============================================================================
// Mocks
// ============================================================================

const mockCreateAssignment = vi.fn().mockResolvedValue(undefined);
const mockCheckConflict = vi.fn().mockResolvedValue(false);
const mockGetAssignmentsByRoom = vi.fn().mockReturnValue([]);

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({
    currentTrip: mockTrip,
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: mockPersons,
  }),
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: [mockRoom],
  }),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    createAssignment: mockCreateAssignment,
    checkConflict: mockCheckConflict,
    getAssignmentsByRoom: mockGetAssignmentsByRoom,
  }),
}));

/**
 * A **stable** translation double.
 *
 * The suite-wide mock in `src/test/setup.ts` builds a fresh `t` per call, and
 * this dialog lists `t` in the dependency array of its conflict-check effect. A
 * new identity every render re-arms that effect forever, so `isCheckingConflict`
 * never settles and the submit button stays disabled for good. Real i18next
 * returns a stable `t`; this double does the same.
 */
vi.mock('react-i18next', () => {
  const value = {
    t: (key: string) => key,
    i18n: { language: 'en' },
  };
  return { useTranslation: () => value };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: undefined,
    handleSubmit: onSubmit,
    clearError: vi.fn(),
  }),
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('QuickAssignmentDialog', () => {
  beforeAll(() => {
    // Radix Select reaches for pointer-capture and scroll APIs jsdom omits.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckConflict.mockResolvedValue(false);
    mockGetAssignmentsByRoom.mockReturnValue([]);
    mockPersons = [mockPerson, makeBob()];
  });

  it('returns null when room is not found', () => {
    const { container } = render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'nonexistent' as RoomId}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with person info when person is provided (drag-drop)', () => {
    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
        suggestedStartDate="2026-07-02"
        suggestedEndDate="2026-07-08"
      />,
    );

    expect(screen.getByText('assignments.quickAssign')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Main Bedroom')).toBeInTheDocument();
  });

  it('renders dialog with person selector when person is null (claim flow)', () => {
    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={null}
        roomId={'room-1' as RoomId}
      />,
    );

    expect(screen.getByText('rooms.claimRoom')).toBeInTheDocument();
    expect(screen.getByLabelText('assignments.person')).toBeInTheDocument();
  });

  it('renders room name in read-only field', () => {
    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
      />,
    );

    expect(screen.getByText('Main Bedroom')).toBeInTheDocument();
  });

  it('renders date range picker and period hint', () => {
    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
      />,
    );

    expect(screen.getByText('assignments.period')).toBeInTheDocument();
    expect(screen.getByText('assignments.periodHint')).toBeInTheDocument();
  });

  it('pre-fills the picker with the dropped guest’s stay window', () => {
    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
        suggestedStartDate="2026-07-02"
        suggestedEndDate="2026-07-08"
      />,
    );

    // Dropping a guest on a room is meant to save the date entry entirely; an
    // empty picker (or one shifted a day) is the whole feature failing.
    expect(screen.getByRole('button', { name: 'assignments.period' })).toHaveTextContent(
      /Jul 2, 2026\s*→\s*Jul 8, 2026/,
    );
  });

  it('leaves the picker empty and the form unsubmittable without suggested dates', () => {
    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
      />,
    );

    expect(screen.getByRole('button', { name: 'assignments.period' })).toHaveTextContent(
      'dateRangePicker.placeholder',
    );
    expect(screen.getByRole('button', { name: 'common.add' })).toBeDisabled();
  });

  it('enables the add button once a guest and a window are known', async () => {
    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
        suggestedStartDate="2026-07-02"
        suggestedEndDate="2026-07-08"
      />,
    );

    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeEnabled();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.add' })).toBeEnabled();
    });
  });

  it('blocks the add button and explains when the guest is already booked', async () => {
    mockCheckConflict.mockResolvedValue(true);

    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
        suggestedStartDate="2026-07-02"
        suggestedEndDate="2026-07-08"
      />,
    );

    expect(await screen.findByText('assignments.conflict')).toBeInTheDocument();
    // A double booking must not be creatable by hammering the button.
    expect(screen.getByRole('button', { name: 'common.add' })).toBeDisabled();
    expect(mockCheckConflict).toHaveBeenCalledWith('p1', '2026-07-02', '2026-07-08');
  });

  it('warns when the incoming guest would overflow the room', async () => {
    // One guest row standing for two people already fills this two-bed room on
    // the same nights, so a third person cannot fit. Counting rows rather than
    // people would see "1 booked, 1 bed free" and stay silent.
    mockPersons = [mockPerson, makeBob(2)];
    mockGetAssignmentsByRoom.mockReturnValue([
      {
        id: 'a1',
        tripId: 'trip-1',
        roomId: 'room-1',
        personId: 'p2',
        startDate: '2026-07-02',
        endDate: '2026-07-08',
      },
    ]);

    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
        suggestedStartDate="2026-07-02"
        suggestedEndDate="2026-07-08"
      />,
    );

    expect(await screen.findByText('rooms.capacityWarning')).toBeInTheDocument();
  });

  it('does not warn when the room still has a free bed on every night', async () => {
    // Bob is a single guest in a two-bed room: Alice fits beside him.
    mockPersons = [mockPerson, makeBob(1)];
    mockGetAssignmentsByRoom.mockReturnValue([
      {
        id: 'a1',
        tripId: 'trip-1',
        roomId: 'room-1',
        personId: 'p2',
        startDate: '2026-07-02',
        endDate: '2026-07-08',
      },
    ]);

    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
        suggestedStartDate="2026-07-02"
        suggestedEndDate="2026-07-08"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.add' })).toBeEnabled();
    });
    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
  });

  it('renders cancel and add buttons', () => {
    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
      />,
    );

    expect(screen.getByText('common.cancel')).toBeInTheDocument();
    expect(screen.getByText('common.add')).toBeInTheDocument();
  });

  it('does not render when not open', () => {
    render(
      <QuickAssignmentDialog
        open={false}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
      />,
    );
    // The dialog itself is rendered (return null only when room is missing),
    // but the content is hidden
    expect(screen.queryByText('assignments.quickAssign')).not.toBeInTheDocument();
  });

  it('calls onOpenChange when cancel is clicked (no dirty state)', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={onOpenChange}
        person={mockPerson}
        roomId={'room-1' as RoomId}
        suggestedStartDate="2026-07-02"
        suggestedEndDate="2026-07-08"
      />,
    );

    await user.click(screen.getByText('common.cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows dialog description text', () => {
    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={vi.fn()}
        person={mockPerson}
        roomId={'room-1' as RoomId}
      />,
    );

    expect(screen.getByText('assignments.quickAssignDescription')).toBeInTheDocument();
  });

  it('asks before discarding a guest the user picked in the claim flow', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={onOpenChange}
        person={null}
        roomId={'room-1' as RoomId}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
    await user.click(await screen.findByRole('option', { name: /Bob/ }));

    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    // Closing on a dirty form has to route through the confirmation, not throw
    // the selection away silently.
    expect(await screen.findByText('unsaved.discardChanges')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('creates the assignment for the guest chosen in the claim flow', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <QuickAssignmentDialog
        open={true}
        onOpenChange={onOpenChange}
        person={null}
        roomId={'room-1' as RoomId}
        suggestedStartDate="2026-07-02"
        suggestedEndDate="2026-07-08"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
    await user.click(await screen.findByRole('option', { name: /Bob/ }));

    const submit = screen.getByRole('button', { name: 'common.add' });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await user.click(submit);

    // The claimed room goes to the guest who was selected, over the suggested
    // window, on the days it was given.
    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalledWith({
        roomId: 'room-1',
        personId: 'p2',
        startDate: '2026-07-02',
        endDate: '2026-07-08',
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
