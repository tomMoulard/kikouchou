/**
 * @fileoverview Tests for QuickAssignmentDialog component.
 * @module features/rooms/components/__tests__/QuickAssignmentDialog.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAssignmentDialog } from '../QuickAssignmentDialog';
import type { Person, PersonId, Room, RoomAssignment, RoomId, Trip } from '@/types';

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

const mockPersons: Person[] = [
  mockPerson,
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

describe('QuickAssignmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckConflict.mockResolvedValue(false);
    mockGetAssignmentsByRoom.mockReturnValue([]);
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
    const { container } = render(
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
});
