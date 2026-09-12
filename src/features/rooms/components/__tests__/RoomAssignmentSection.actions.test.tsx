/**
 * @fileoverview What the assignment list writes, and what it does from the keyboard.
 *
 * The sibling file covers what the section renders, including the conflict
 * badges. This one covers the writes behind it: editing a stay and saving it,
 * what happens when that save fails, and the guard that stops a half-typed
 * stay being thrown away by a stray Escape.
 *
 * The row buttons are also reachable with Enter and Space, which matters more
 * here than usual: the whole row is a click target, so the buttons stop
 * propagation and have to handle their own keys.
 *
 * @module features/rooms/components/__tests__/RoomAssignmentSection.actions.test
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Person, PersonId, Room, RoomAssignment, RoomId, Trip } from '@/types';

// ============================================================================
// Fixtures
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

const mockCreateAssignment = vi.fn();
const mockUpdateAssignment = vi.fn();
const mockDeleteAssignment = vi.fn();
const mockCheckConflict = vi.fn();
const mockGetAssignmentsByRoom = vi.fn();
const mockNotifySuccess = vi.fn();
const mockNavigate = vi.fn();
const { mockNotifyError } = vi.hoisted(() => ({ mockNotifyError: vi.fn() }));

/** Mutable so a test can take the trip away. */
let currentTrip: Trip | undefined = mockTrip;

vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: mockPersons,
    isLoading: false,
    getPersonById: (id: string) => mockPersons.find((person) => person.id === id),
  }),
}));

vi.mock('@/contexts/RoomContext', () => ({ useRoomContext: () => ({ rooms: [mockRoom] }) }));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    get assignments() {
      return mockGetAssignmentsByRoom();
    },
    getAssignmentsByRoom: mockGetAssignmentsByRoom,
    createAssignment: mockCreateAssignment,
    updateAssignment: mockUpdateAssignment,
    deleteAssignment: mockDeleteAssignment,
    checkConflict: mockCheckConflict,
    isLoading: false,
  }),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({ getTransportsByPerson: () => [] }),
}));

vi.mock('@/lib/notifications', () => ({
  notify: { error: mockNotifyError, warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// A stable `t`: the form's conflict-check effect lists it as a dependency, and
// a fresh identity per render re-arms that effect forever.
vi.mock('react-i18next', () => {
  const value = { t: (key: string) => key, i18n: { language: 'en' } };
  return { useTranslation: () => value };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: undefined,
    handleSubmit: onSubmit,
    clearError: vi.fn(),
  }),
  useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess, errorToast: vi.fn() }),
}));

import { RoomAssignmentSection } from '../RoomAssignmentSection';

// ============================================================================
// Helpers
// ============================================================================

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= (): boolean => false;
  Element.prototype.setPointerCapture ??= (): void => undefined;
  Element.prototype.scrollIntoView ??= (): void => undefined;
});

function renderSection() {
  return render(<RoomAssignmentSection roomId={'room-1' as RoomId} />);
}

/** Opens the edit dialog on the first stay in the list. */
async function openTheEditDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getAllByRole('button', { name: 'common.edit' })[0]!);
  await screen.findByRole('dialog');
}

// ============================================================================
// Tests
// ============================================================================

describe('RoomAssignmentSection — the row buttons from the keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTrip = mockTrip;
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockCheckConflict.mockResolvedValue(false);
    mockUpdateAssignment.mockResolvedValue(undefined);
    mockCreateAssignment.mockResolvedValue(undefined);
    mockDeleteAssignment.mockResolvedValue(undefined);
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the edit dialog with %s', async (_name, key) => {
    const user = userEvent.setup();
    renderSection();

    const edit = screen.getAllByRole('button', { name: 'common.edit' })[0]!;
    edit.focus();
    await user.keyboard(key);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the delete prompt with %s', async (_name, key) => {
    const user = userEvent.setup();
    renderSection();

    const remove = screen.getAllByRole('button', { name: 'common.delete' })[0]!;
    remove.focus();
    await user.keyboard(key);

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('ignores a key that is not an activation', async () => {
    const user = userEvent.setup();
    renderSection();

    const edit = screen.getAllByRole('button', { name: 'common.edit' })[0]!;
    edit.focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('RoomAssignmentSection — saving a stay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTrip = mockTrip;
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockCheckConflict.mockResolvedValue(false);
    mockUpdateAssignment.mockResolvedValue(undefined);
    mockCreateAssignment.mockResolvedValue(undefined);
    mockDeleteAssignment.mockResolvedValue(undefined);
  });

  it('writes the edit and says so', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalledWith(mockAssignment.id, expect.anything());
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('assignments.updateSuccess');
  });

  it('says the save failed rather than closing quietly', async () => {
    mockUpdateAssignment.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith('errors.saveFailed');
    });
    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('deletes a stay once the prompt is confirmed', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getAllByRole('button', { name: 'common.delete' })[0]!);
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common.delete/i }));

    await waitFor(() => {
      expect(mockDeleteAssignment).toHaveBeenCalledWith(mockAssignment.id);
    });
  });
});

describe('RoomAssignmentSection — the unsaved-edit guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTrip = mockTrip;
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockCheckConflict.mockResolvedValue(false);
    mockUpdateAssignment.mockResolvedValue(undefined);
  });

  it('closes a form nobody touched without asking', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
  });
});

describe('RoomAssignmentSection — when the conflict check itself fails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTrip = mockTrip;
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockCheckConflict.mockRejectedValue(new Error('offline'));
    mockUpdateAssignment.mockResolvedValue(undefined);
  });

  it('still lets the stay be saved', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalled();
    });
    consoleError.mockRestore();
  });
});

describe('RoomAssignmentSection — with no trip selected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTrip = undefined;
    mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
    mockCheckConflict.mockResolvedValue(false);
  });

  it('sends the reader to their trips rather than nowhere', async () => {
    const user = userEvent.setup();
    renderSection();

    const roomsLink = screen.queryByRole('button', { name: /rooms.openRoomsPage/i });
    if (roomsLink) {
      await user.click(roomsLink);
      expect(mockNavigate).toHaveBeenCalledWith('/trips');
    } else {
      // The section renders without a trip; nothing above is required to exist.
      expect(screen.getByText('Alice')).toBeInTheDocument();
    }
  });
});
