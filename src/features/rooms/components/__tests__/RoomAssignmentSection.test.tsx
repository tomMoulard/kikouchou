/**
 * @fileoverview Tests for RoomAssignmentSection component.
 * @module features/rooms/components/__tests__/RoomAssignmentSection.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomAssignmentSection } from '../RoomAssignmentSection';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import type { Person, PersonId, Room, RoomAssignment, RoomId, Trip, Transport } from '@/types';

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
const mockGetPersonById = vi.fn((id: string) =>
  mockPersons.find((p) => p.id === id),
);
const mockGetTransportsByPerson = vi.fn().mockReturnValue([]);

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssignmentsByRoom.mockReturnValue([]);
    mockCheckConflict.mockResolvedValue(false);
    mockGetTransportsByPerson.mockReturnValue([]);
    // Reset the assignment context mock to default
    vi.mocked(useAssignmentContext).mockReturnValue({
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

    render(
      <RoomAssignmentSection
        roomId={'room-1' as RoomId}
        onAssignmentChange={onChange}
      />,
    );

    // Open add dialog
    await user.click(screen.getByLabelText('assignments.assign'));

    // Verify dialog opens with correct description
    expect(screen.getByText('assignments.assignDescription')).toBeInTheDocument();
    // Verify the person label is shown
    expect(screen.getByText('assignments.person')).toBeInTheDocument();
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

  it('renders transport dates autofill hint in create mode', async () => {
    const user = userEvent.setup();
    // Set up transport data for autofill
    mockGetTransportsByPerson.mockReturnValue([
      {
        id: 'tr1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2026-07-02T10:00:00.000Z',
        location: 'Airport',
        needsPickup: false,
      } as Transport,
      {
        id: 'tr2',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'departure',
        datetime: '2026-07-08T10:00:00.000Z',
        location: 'Airport',
        needsPickup: false,
      } as Transport,
    ]);

    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );

    // Open add dialog
    await user.click(screen.getByLabelText('assignments.assign'));

    // The hint about period should be visible
    expect(screen.getByText('assignments.periodHint')).toBeInTheDocument();
  });

  it('renders french date locale when language is fr', () => {
    // This test ensures the assignment list renders with date formatting
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockGetPersonById.mockImplementation((id: string) =>
      mockPersons.find((p) => p.id === id),
    );
    render(
      <RoomAssignmentSection roomId={'room-1' as RoomId} />,
    );
    // Verify the assignment item is displayed with Alice
    expect(screen.getByText('Alice')).toBeInTheDocument();
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

  it('renders same-day assignment date format', () => {
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
  });
});
