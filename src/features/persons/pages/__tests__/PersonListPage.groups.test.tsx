/**
 * @fileoverview Adding guests from a saved group, and the page's error tails.
 *
 * The import is the one flow on this page that writes several guests at once
 * and can partly succeed: a group edited between opening the picker and
 * confirming it brings in fewer people than were ticked, and the page has to
 * say so rather than report a clean success.
 *
 * The picker itself has its own tests. Here it is a button that hands back a
 * fixed selection, so what is asserted is what the page does with it.
 *
 * @module features/persons/pages/__tests__/PersonListPage.groups.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';
import type { Person, Trip } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn();
const mockDeletePerson = vi.fn();
const mockSuccessToast = vi.fn();
const mockImportMembers = vi.fn();
// Hoisted: `vi.mock` factories run before the module body, and the notifications
// double is one of them.
const { mockWarning } = vi.hoisted(() => ({ mockWarning: vi.fn() }));

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
  id: 'person-1' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

/** Two groups, so the page has to walk the selection rather than take the first. */
const SELECTIONS = [
  { group: { id: 'group-1', name: 'The cousins' }, memberIds: ['m1', 'm2'] },
  { group: { id: 'group-2', name: 'The neighbours' }, memberIds: ['m3'] },
];

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockSuccessToast, errorToast: vi.fn() }),
}));

vi.mock('@/lib/notifications', () => ({
  notify: { warning: mockWarning, error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/contexts/PersonContext', () => ({ usePersonContext: vi.fn() }));
vi.mock('@/contexts/RoomContext', () => ({ useRoomContext: vi.fn() }));
vi.mock('@/contexts/AssignmentContext', () => ({ useAssignmentContext: vi.fn() }));
vi.mock('@/contexts/TransportContext', () => ({ useTransportContext: vi.fn() }));

vi.mock('@/features/persons/components/PersonDialog', () => ({
  PersonDialog: ({ open, personId }: { open: boolean; personId?: string }) =>
    open ? <div data-testid="person-dialog" data-person-id={personId ?? ''} /> : null,
}));

vi.mock('@/features/guest-groups', () => ({
  useGuestGroups: () => ({ importMembers: mockImportMembers }),
  GuestGroupImportDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: (selections: unknown) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="import-group-dialog">
        <button
          data-testid="confirm-import"
          onClick={() => {
            void onConfirm(SELECTIONS).catch(() => {
              // The page re-throws so the real picker can stay open on failure.
            });
          }}
        >
          confirm
        </button>
      </div>
    ) : null,
  SaveGuestsAsGroupDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="save-group-dialog" /> : null,
}));

import { PersonListPage } from '../PersonListPage';
import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { useTransportContext } from '@/contexts/TransportContext';

// ============================================================================
// Helpers
// ============================================================================

function resetMocks(): void {
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    trips: [mockTrip],
    checkConnection: vi.fn(),
  } as unknown as ReturnType<typeof useTripContext>);
  vi.mocked(usePersonContext).mockReturnValue({
    persons: [mockPerson],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => (id === mockPerson.id ? mockPerson : undefined)),
    createPerson: vi.fn(),
    updatePerson: vi.fn(),
    deletePerson: mockDeletePerson,
  } as unknown as ReturnType<typeof usePersonContext>);
  vi.mocked(useRoomContext).mockReturnValue({
    rooms: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useRoomContext>);
  vi.mocked(useAssignmentContext).mockReturnValue({
    assignments: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useAssignmentContext>);
  vi.mocked(useTransportContext).mockReturnValue({
    getTransportsByPerson: vi.fn(() => []),
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useTransportContext>);
}

function renderPage() {
  return render(<PersonListPage />, { withProviders: false });
}

/** Opens the picker and confirms the two-group selection. */
async function importTheGroups(user: ReturnType<typeof render>['user']): Promise<void> {
  await user.click(screen.getByRole('button', { name: /guestGroups.importAction/i }));
  await user.click(await screen.findByTestId('confirm-import'));
}

// ============================================================================
// Tests
// ============================================================================

describe('PersonListPage — adding guests from a group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockDeletePerson.mockResolvedValue(undefined);
    mockImportMembers.mockResolvedValue({ persons: [{}, {}], skippedMemberIds: [] });
    resetMocks();
  });

  it('opens the picker from the header', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: /guestGroups.importAction/i }));

    expect(await screen.findByTestId('import-group-dialog')).toBeInTheDocument();
  });

  it('imports every group that was ticked, in the order they were ticked', async () => {
    const { user } = renderPage();

    await importTheGroups(user);

    await waitFor(() => {
      expect(mockImportMembers).toHaveBeenCalledTimes(2);
    });
    expect(mockImportMembers).toHaveBeenNthCalledWith(1, mockTrip.id, 'group-1', ['m1', 'm2']);
    expect(mockImportMembers).toHaveBeenNthCalledWith(2, mockTrip.id, 'group-2', ['m3']);
    expect(mockSuccessToast).toHaveBeenCalled();
  });

  it('says how many people were left behind by an edited group', async () => {
    mockImportMembers
      .mockResolvedValueOnce({ persons: [{}], skippedMemberIds: ['m2'] })
      .mockResolvedValueOnce({ persons: [{}], skippedMemberIds: [] });
    const { user } = renderPage();

    await importTheGroups(user);

    await waitFor(() => {
      expect(mockWarning).toHaveBeenCalled();
    });
    // Partly done is still done: the guests that did arrive are reported.
    expect(mockSuccessToast).toHaveBeenCalled();
  });

  it('says nothing about skipped people when nobody was skipped', async () => {
    const { user } = renderPage();

    await importTheGroups(user);

    await waitFor(() => {
      expect(mockSuccessToast).toHaveBeenCalled();
    });
    expect(mockWarning).not.toHaveBeenCalled();
  });

  it('reports a failed import rather than claiming the guests arrived', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockImportMembers.mockRejectedValue(new Error('offline'));
    const { user } = renderPage();

    await importTheGroups(user);

    await waitFor(() => {
      expect(mockImportMembers).toHaveBeenCalled();
    });
    expect(mockSuccessToast).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('offers to save the current guests as a group', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: /guestGroups.saveAsGroup/i }));

    expect(await screen.findByTestId('save-group-dialog')).toBeInTheDocument();
  });
});

describe('PersonListPage — the tails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockDeletePerson.mockResolvedValue(undefined);
    mockImportMembers.mockResolvedValue({ persons: [], skippedMemberIds: [] });
    resetMocks();
  });

  it('reports a trip switch that failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSetCurrentTrip.mockRejectedValue(new Error('gone'));
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
      isLoading: false,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [mockTrip],
      checkConnection: vi.fn(),
    } as unknown as ReturnType<typeof useTripContext>);

    renderPage();

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    consoleError.mockRestore();
  });

  it('sends the reader back to their trips when this one is gone', async () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
      isLoading: false,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [],
      checkConnection: vi.fn(),
    } as unknown as ReturnType<typeof useTripContext>);

    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: /common.back/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips');
  });
});

describe('PersonListPage — when the guest list will not load', () => {
  const reload = vi.fn();
  const realLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    resetMocks();
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [],
      isLoading: false,
      error: new Error('the read failed'),
      getPersonById: vi.fn(() => undefined),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as unknown as ReturnType<typeof usePersonContext>);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('offers a reload, and a way back to the calendar', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: /common.retry/i }));
    expect(reload).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /common.back/i }));
    expect(mockNavigate).toHaveBeenCalledWith(`/trips/${mockTrip.id}/calendar`);
  });
});
