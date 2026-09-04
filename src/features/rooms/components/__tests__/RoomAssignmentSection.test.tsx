/**
 * @fileoverview Tests for RoomAssignmentSection component.
 * @module features/rooms/components/__tests__/RoomAssignmentSection.test
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomAssignmentSection } from '../RoomAssignmentSection';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import type { Person, PersonId, Room, RoomAssignment, RoomId, Trip, Transport } from '@/types';

/**
 * An ISO instant for a wall-clock time on a given day, built from local parts.
 *
 * Transport fixtures must not be written as literal `Z` timestamps: the app
 * turns a transport into an assignment date with `toLocalISODateString`, so
 * `'2026-07-02T10:00:00.000Z'` becomes July 1st for every viewer west of
 * Greenwich and the fixture then encodes the machine's UTC offset.
 */
function instantOn(day: string, hour: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date, hour, 0, 0, 0).toISOString();
}

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

const mockPersons: Person[] = [
  {
    id: 'p1' as PersonId,
    tripId: 'trip-1' as Person['tripId'],
    name: 'Alice',
    color: '#3b82f6' as Person['color'],
  },
  {
    id: 'p2' as PersonId,
    tripId: 'trip-1' as Person['tripId'],
    name: 'Bob',
    color: '#ef4444' as Person['color'],
  },
];

const mockRoom: Room = {
  id: 'room-1' as RoomId,
  tripId: 'trip-1' as Room['tripId'],
  name: 'Main Bedroom',
  capacity: 2,
  order: 0,
};

const mockAssignment: RoomAssignment = {
  id: 'a1' as RoomAssignment['id'],
  tripId: 'trip-1' as RoomAssignment['tripId'],
  roomId: 'room-1' as RoomId,
  personId: 'p1' as PersonId,
  startDate: '2026-07-02' as RoomAssignment['startDate'],
  endDate: '2026-07-08' as RoomAssignment['endDate'],
};

// ============================================================================
// Mocks
// ============================================================================

const mockCreateAssignment = vi.fn().mockResolvedValue(undefined);
const mockUpdateAssignment = vi.fn().mockResolvedValue(undefined);
const mockDeleteAssignment = vi.fn().mockResolvedValue(undefined);
const mockCheckConflict = vi.fn().mockResolvedValue(false);
const mockGetAssignmentsByRoom = vi.fn().mockReturnValue([]);
/** Trip-wide assignments; `undefined` means "just this room's". */
let mockTripAssignments: RoomAssignment[] | undefined;
const mockGetPersonById = vi.fn((id: string) =>
  mockPersons.find((p) => p.id === id),
);
const mockGetTransportsByPerson = vi.fn().mockReturnValue([]);
const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({
    currentTrip: mockTrip,
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: mockPersons,
    isLoading: false,
    getPersonById: mockGetPersonById,
  }),
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: [mockRoom],
  }),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: vi.fn(() => ({
    // The section scans every assignment in the trip to spot a guest booked in
    // two rooms on the same night. Tests that care set `mockTripAssignments`;
    // for the rest, the trip holds exactly this room's assignments.
    get assignments() {
      return mockTripAssignments ?? mockGetAssignmentsByRoom();
    },
    getAssignmentsByRoom: mockGetAssignmentsByRoom,
    createAssignment: mockCreateAssignment,
    updateAssignment: mockUpdateAssignment,
    deleteAssignment: mockDeleteAssignment,
    checkConflict: mockCheckConflict,
    isLoading: false,
  })),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({
    getTransportsByPerson: mockGetTransportsByPerson,
  }),
}));

/**
 * A **stable** translation double.
 *
 * The suite-wide mock in `src/test/setup.ts` returns a fresh `t` on every call,
 * and the form dialog lists `t` in the dependency array of the effect that runs
 * the conflict check. A new identity each render re-arms that effect forever,
 * `isCheckingConflict` never settles, and the submit button can never be
 * clicked. Real i18next hands back a stable `t`, so this double is the faithful
 * one — and it is what lets the tests below actually submit the form.
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

describe('RoomAssignmentSection', () => {
  beforeAll(() => {
    // Radix Select and Popover reach for pointer-capture and scroll APIs jsdom
    // does not implement; without them the guest selector cannot be opened.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssignmentsByRoom.mockReturnValue([]);
    mockTripAssignments = undefined;
    mockCheckConflict.mockResolvedValue(false);
    mockGetTransportsByPerson.mockReturnValue([]);
    // Reset the assignment context mock to default
    vi.mocked(useAssignmentContext).mockReturnValue({
      get assignments() {
        return mockTripAssignments ?? mockGetAssignmentsByRoom();
      },
      getAssignmentsByRoom: mockGetAssignmentsByRoom,
      createAssignment: mockCreateAssignment,
      updateAssignment: mockUpdateAssignment,
      deleteAssignment: mockDeleteAssignment,
      checkConflict: mockCheckConflict,
      isLoading: false,
    } as never);
  });

  it('renders empty state when no assignments exist', () => {
    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    expect(screen.getByText('assignments.empty')).toBeInTheDocument();
    expect(screen.getByText('assignments.emptyDescription')).toBeInTheDocument();
  });

  it('renders assignment list with person names and dates', () => {
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // The dates are half the row, and the check-out day is shown as stored —
    // the list must not quietly render `endDate - 1` as the last night.
    expect(screen.getByText('2 - 8 Jul 2026')).toBeInTheDocument();
  });

  it('flags a guest booked into two rooms on the same night', () => {
    // The list used to pass `hasConflict={false}` unconditionally, so a double
    // booking already stored could never surface outside the edit dialog.
    const clashingAssignment: RoomAssignment = {
      ...mockAssignment,
      id: 'a2' as RoomAssignment['id'],
      roomId: 'room-2' as RoomId,
      startDate: '2026-07-05' as RoomAssignment['startDate'],
      endDate: '2026-07-09' as RoomAssignment['endDate'],
    };
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockTripAssignments = [mockAssignment, clashingAssignment];

    render(<RoomAssignmentSection roomId={'room-1' as RoomId} />);

    expect(screen.getAllByText('assignments.conflict').length).toBeGreaterThan(0);
  });

  it('does not flag a guest moving rooms on their check-out day', () => {
    const nextRoomAssignment: RoomAssignment = {
      ...mockAssignment,
      id: 'a2' as RoomAssignment['id'],
      roomId: 'room-2' as RoomId,
      // Checks out of room-1 on the 8th and into room-2 the same day.
      startDate: '2026-07-08' as RoomAssignment['startDate'],
      endDate: '2026-07-10' as RoomAssignment['endDate'],
    };
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockTripAssignments = [mockAssignment, nextRoomAssignment];

    render(<RoomAssignmentSection roomId={'room-1' as RoomId} />);

    expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
  });

  it('renders header with assignment count badge', () => {
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    expect(screen.getByText('assignments.title')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders add button', () => {
    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    expect(screen.getByLabelText('assignments.assign')).toBeInTheDocument();
  });

  it('opens assignment form dialog when add button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );

    await user.click(screen.getByLabelText('assignments.assign'));
    // Dialog should be open with title and description
    expect(screen.getByText('assignments.assignDescription')).toBeInTheDocument();
  });

  it('shows edit and delete buttons for each assignment', () => {
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    expect(screen.getByLabelText('common.edit')).toBeInTheDocument();
    expect(screen.getByLabelText('common.delete')).toBeInTheDocument();
  });

  it('opens delete confirmation when delete button is clicked', async () => {
    const user = userEvent.setup();
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );

    await user.click(screen.getByLabelText('common.delete'));
    expect(screen.getByText('confirm.removeAssignment')).toBeInTheDocument();
  });

  it('opens edit dialog when edit button is clicked', async () => {
    const user = userEvent.setup();
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );

    await user.click(screen.getByLabelText('common.edit'));
    expect(screen.getByText('assignments.editAssignment')).toBeInTheDocument();
  });

  it('renders unknown badge when person is not found', () => {
    const orphanAssignment: RoomAssignment = {
      ...mockAssignment,
      personId: 'nonexistent' as PersonId,
    };
    mockGetAssignmentsByRoom.mockReturnValue([orphanAssignment]);
    mockGetPersonById.mockReturnValue(undefined);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    expect(screen.getByText('common.unknown')).toBeInTheDocument();
  });

  it('shows "show more" button in compact mode with many assignments', () => {
    const manyAssignments = Array.from({ length: 5 }, (_, i) => ({
      ...mockAssignment,
      id: `a${i}` as RoomAssignment['id'],
      personId: i % 2 === 0 ? ('p1' as PersonId) : ('p2' as PersonId),
    }));
    mockGetAssignmentsByRoom.mockReturnValue(manyAssignments);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} variant="compact" />,
    );
    // In compact mode, only 3 items shown, 2 hidden
    expect(screen.getByText('assignments.showMore')).toBeInTheDocument();
  });

  it('expands to show all when "show more" is clicked', async () => {
    const user = userEvent.setup();
    const manyAssignments = Array.from({ length: 5 }, (_, i) => ({
      ...mockAssignment,
      id: `a${i}` as RoomAssignment['id'],
      personId: i % 2 === 0 ? ('p1' as PersonId) : ('p2' as PersonId),
    }));
    mockGetAssignmentsByRoom.mockReturnValue(manyAssignments);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} variant="compact" />,
    );

    await user.click(screen.getByText('assignments.showMore'));
    // After expanding, all 5 items should be visible and "show more" gone
    expect(screen.queryByText('assignments.showMore')).not.toBeInTheDocument();
    // All list items rendered
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(5);
  });

  it('shows all assignments in expanded variant', () => {
    const manyAssignments = Array.from({ length: 5 }, (_, i) => ({
      ...mockAssignment,
      id: `a${i}` as RoomAssignment['id'],
      personId: i % 2 === 0 ? ('p1' as PersonId) : ('p2' as PersonId),
    }));
    mockGetAssignmentsByRoom.mockReturnValue(manyAssignments);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} variant="expanded" />,
    );

    expect(screen.queryByText('assignments.showMore')).not.toBeInTheDocument();
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(5);
  });

  it('calls onAssignmentChange callback after delete', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockDeleteAssignment.mockResolvedValue(undefined);

    render(
      <RoomAssignmentSection
        roomId={'room-1' as RoomId}
        onAssignmentChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText('common.delete'));
    // Confirm dialog opens - click confirm
    const confirmBtn = screen.getByText('common.delete');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeleteAssignment).toHaveBeenCalledWith('a1');
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
  });

  it('applies custom className', () => {
    const { container } = render(
      <RoomAssignmentSection
        roomId={'room-1' as RoomId}
        className="custom-class"
      />,
    );
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('renders with persons available and add button enabled', () => {
    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    // The add button should exist and be enabled (persons are available)
    const addBtn = screen.getByLabelText('assignments.assign');
    expect(addBtn).toBeInTheDocument();
    expect(addBtn).not.toBeDisabled();
  });

  it('handles form submission for creating assignment', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockGetTransportsByPerson.mockReturnValue([
      {
        id: 'tr1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: instantOn('2026-07-02', 10),
        location: 'Airport',
        needsPickup: false,
      } as Transport,
      {
        id: 'tr2',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'departure',
        datetime: instantOn('2026-07-08', 6),
        location: 'Airport',
        needsPickup: false,
      } as Transport,
    ]);

    render(
      <RoomAssignmentSection
        roomId={'room-1' as RoomId}
        onAssignmentChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText('assignments.assign'));
    expect(screen.getByText('assignments.assignDescription')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
    await user.click(await screen.findByRole('option', { name: /Alice/ }));

    const submit = screen.getByRole('button', { name: 'common.add' });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await user.click(submit);

    // The point of the dialog is the row it writes, so that is what is asserted.
    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalledWith({
        roomId: 'room-1',
        personId: 'p1',
        startDate: '2026-07-02',
        endDate: '2026-07-08',
      });
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
  });

  it('opens edit dialog and shows edit-mode title', async () => {
    const user = userEvent.setup();
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );

    await user.click(screen.getByLabelText('common.edit'));
    // Edit dialog shows edit title
    expect(screen.getByText('assignments.editAssignment')).toBeInTheDocument();
    // Edit dialog shows edit description
    expect(screen.getByText('assignments.editDescription')).toBeInTheDocument();
  });

  it('handles delete failure with error toast', async () => {
    const { toast: toastMock } = await import('sonner');
    const user = userEvent.setup();
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockDeleteAssignment.mockRejectedValueOnce(new Error('Delete failed'));

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );

    // Click delete
    await user.click(screen.getByLabelText('common.delete'));
    // Confirm
    const confirmBtn = screen.getByText('common.delete');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(vi.mocked(toastMock.error)).toHaveBeenCalledWith('errors.deleteFailed');
    });
  });

  it('swaps the period hint for the autofill notice once dates are borrowed', async () => {
    const user = userEvent.setup();
    mockGetTransportsByPerson.mockReturnValue([
      {
        id: 'tr1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: instantOn('2026-07-02', 10),
        location: 'Airport',
        needsPickup: false,
      } as Transport,
      {
        id: 'tr2',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'departure',
        datetime: instantOn('2026-07-08', 10),
        location: 'Airport',
        needsPickup: false,
      } as Transport,
    ]);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );

    await user.click(screen.getByLabelText('assignments.assign'));
    // Before a guest is chosen there is nothing to borrow dates from.
    expect(screen.getByText('assignments.periodHint')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
    await user.click(await screen.findByRole('option', { name: /Alice/ }));

    // Choosing the guest is what pulls the transport window into the picker.
    expect(await screen.findByText('assignments.autofilledFromTransport')).toBeInTheDocument();
    expect(screen.queryByText('assignments.periodHint')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'assignments.period' })).toHaveTextContent(
      /Jul 2, 2026\s*→\s*Jul 8, 2026/,
    );
  });

  it('renders the stored date range on the assignment row', () => {
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockGetPersonById.mockImplementation((id: string) =>
      mockPersons.find((p) => p.id === id),
    );
    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('2 - 8 Jul 2026')).toBeInTheDocument();
  });

  it('does not show count badge when no assignments', () => {
    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    // The count badge should not appear
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('handles multiple assignments in list', () => {
    const secondAssignment: RoomAssignment = {
      ...mockAssignment,
      id: 'a2' as RoomAssignment['id'],
      personId: 'p2' as PersonId,
      startDate: '2026-07-03' as RoomAssignment['startDate'],
      endDate: '2026-07-09' as RoomAssignment['endDate'],
    };
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment, secondAssignment]);
    mockGetPersonById.mockImplementation((id: string) =>
      mockPersons.find((p) => p.id === id),
    );

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // Count badge
  });

  it('renders loading state when assignments are loading', () => {
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [],
      getAssignmentsByRoom: vi.fn().mockReturnValue([]),
      createAssignment: mockCreateAssignment,
      updateAssignment: mockUpdateAssignment,
      deleteAssignment: mockDeleteAssignment,
      checkConflict: mockCheckConflict,
      isLoading: true,
    } as never);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    // Should show loading spinner
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('collapses a same-day assignment to a single date', () => {
    const sameDayAssignment: RoomAssignment = {
      ...mockAssignment,
      startDate: '2026-07-05' as RoomAssignment['startDate'],
      endDate: '2026-07-05' as RoomAssignment['endDate'],
    };
    mockGetAssignmentsByRoom.mockReturnValue([sameDayAssignment]);
    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // A day-use booking reads as one date, not "5 - 5 Jul 2026".
    expect(screen.getByText('5 Jul 2026')).toBeInTheDocument();
  });

  it('offers redirect to rooms page when conflict is detected', async () => {
    const user = userEvent.setup();
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockCheckConflict.mockResolvedValue(true);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );

    await user.click(screen.getByLabelText('common.edit'));

    await waitFor(() => {
      expect(screen.getByText('assignments.conflict')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'assignments.openInRooms' }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/rooms?view=timeline');
  });
});
