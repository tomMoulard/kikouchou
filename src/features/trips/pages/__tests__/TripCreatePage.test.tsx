import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockCreateTrip = vi.fn().mockResolvedValue({ id: 'new-trip-1' });
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockCloneRoomsToTrip = vi.fn().mockResolvedValue(undefined);
const mockCreatePersonWithAutoColor = vi.fn().mockResolvedValue(undefined);
const mockCreatePerson = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => ({
  createTrip: (...args: unknown[]) => mockCreateTrip(...args),
  setCurrentTrip: (...args: unknown[]) => mockSetCurrentTrip(...args),
  cloneRoomsToTrip: (...args: unknown[]) => mockCloneRoomsToTrip(...args),
  createPersonWithAutoColor: (...args: unknown[]) => mockCreatePersonWithAutoColor(...args),
  createPerson: (...args: unknown[]) => mockCreatePerson(...args),
}));

// The page renders without AppProviders here, and `useAuth` throws outside its
// provider by design. Mocking the hook keeps this suite about the page.
const mockUser = vi.fn<() => { user_metadata?: Record<string, unknown>; email?: string } | null>(
  () => null,
);

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser() }),
}));

const mockErrorToast = vi.fn();

vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockErrorToast(...args) } }));

const mockSuccessToast = vi.fn();

vi.mock('@/hooks', () => ({
  useUnsavedChanges: () => ({
    isBlocked: false,
    proceed: vi.fn(),
    reset: vi.fn(),
    skipNextBlock: vi.fn(),
  }),
  useOfflineAwareToast: () => ({ successToast: mockSuccessToast }),
}));

// Mock TripForm to avoid deep component tree
const lastCurrentUserName = vi.fn();

vi.mock('@/features/trips/components/TripForm', () => ({
  TripForm: ({ onSubmit, onCancel, onImportSourceChange, onGuestsChange, currentUserName }: {
    onSubmit: (data: unknown) => Promise<void>;
    onCancel: () => void;
    onImportSourceChange?: (id: string | null) => void;
    onGuestsChange?: (
      guests: readonly { name: string; color?: string }[],
    ) => void;
    currentUserName?: string;
  }) => {
    lastCurrentUserName(currentUserName);
    return (
      <div data-testid="trip-form">
        <button data-testid="submit-btn" onClick={() => void onSubmit({ name: 'New Trip', startDate: '2026-07-01', endDate: '2026-07-10' }).catch(() => {})}>Submit</button>
        <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
        <button data-testid="import-source-btn" onClick={() => onImportSourceChange?.('source-trip-id')}>Set Import</button>
        <button data-testid="clear-import-btn" onClick={() => onImportSourceChange?.(null)}>Clear Import</button>
        <button data-testid="guests-btn" onClick={() => onGuestsChange?.([{ name: 'Tom' }, { name: 'Marie' }])}>Set Guests</button>
        {/* A guest that came from a saved group: it carries a colour, so the
            page creates it with that colour rather than an assigned one. */}
        <button data-testid="imported-guests-btn" onClick={() => onGuestsChange?.([{ name: 'Alice', color: '#3b82f6' }])}>Set Imported Guests</button>
      </div>
    );
  },
}));

import { TripCreatePage } from '../TripCreatePage';

describe('TripCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTrip.mockResolvedValue({ id: 'new-trip-1' });
    mockCloneRoomsToTrip.mockResolvedValue(undefined);
    mockCreatePersonWithAutoColor.mockResolvedValue(undefined);
    mockUser.mockReturnValue(null);
  });

  it('renders the create page with form', () => {
    render(<TripCreatePage />, { withProviders: false });
    expect(screen.getByText('trips.new')).toBeInTheDocument();
    expect(screen.getByTestId('trip-form')).toBeInTheDocument();
  });

  it('navigates back on cancel', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });
    await user.click(screen.getByTestId('cancel-btn'));
    expect(mockNavigate).toHaveBeenCalledWith('/trips');
  });

  it('creates trip, sets current trip, and navigates on submit', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    await user.click(screen.getByTestId('submit-btn'));

    expect(mockCreateTrip).toHaveBeenCalledWith({
      name: 'New Trip',
      startDate: '2026-07-01',
      endDate: '2026-07-10',
    });
    expect(mockSetCurrentTrip).toHaveBeenCalledWith('new-trip-1');
    expect(mockNavigate).toHaveBeenCalledWith('/trips/new-trip-1/calendar');
    // Through the offline-aware helper, like every other entity: a trip
    // created offline must not claim a success the network never saw.
    expect(mockSuccessToast).toHaveBeenCalledWith('trips.created');
  });

  it('clones rooms when import source is set', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    // Set import source first
    await user.click(screen.getByTestId('import-source-btn'));
    // Then submit
    await user.click(screen.getByTestId('submit-btn'));

    expect(mockCloneRoomsToTrip).toHaveBeenCalledWith('source-trip-id', 'new-trip-1');
    expect(mockNavigate).toHaveBeenCalledWith('/trips/new-trip-1/calendar');
  });

  it('handles room clone failure gracefully (trip still created)', async () => {
    mockCloneRoomsToTrip.mockRejectedValue(new Error('Clone failed'));
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    await user.click(screen.getByTestId('import-source-btn'));
    await user.click(screen.getByTestId('submit-btn'));

    // Trip should still be created and navigation should happen
    expect(mockCreateTrip).toHaveBeenCalled();
    expect(mockSetCurrentTrip).toHaveBeenCalledWith('new-trip-1');
    expect(mockNavigate).toHaveBeenCalledWith('/trips/new-trip-1/calendar');
  });

  it('adds the collected guests to the new trip, in list order', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    await user.click(screen.getByTestId('guests-btn'));
    await user.click(screen.getByTestId('submit-btn'));

    expect(mockCreatePersonWithAutoColor.mock.calls).toEqual([
      ['new-trip-1', 'Tom'],
      ['new-trip-1', 'Marie'],
    ]);
    expect(mockNavigate).toHaveBeenCalledWith('/trips/new-trip-1/calendar');
  });

  it('creates a guest from a group with what the group carried', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    await user.click(screen.getByTestId('imported-guests-btn'));
    await user.click(screen.getByTestId('submit-btn'));

    // The colour came from the saved group, so it is used as-is rather than
    // assigned from the palette — the point of saving the group at all.
    expect(mockCreatePerson).toHaveBeenCalledWith('new-trip-1', {
      name: 'Alice',
      color: '#3b82f6',
    });
    expect(mockCreatePersonWithAutoColor).not.toHaveBeenCalled();
  });

  it('adds no guests when the form reported none', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    await user.click(screen.getByTestId('submit-btn'));

    expect(mockCreatePersonWithAutoColor).not.toHaveBeenCalled();
  });

  it('keeps the trip and warns when a guest cannot be added', async () => {
    // The trip is already in the database by this point, so a failed guest is a
    // warning — never a reason to strand the user on the form.
    mockCreatePersonWithAutoColor
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Guest failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    await user.click(screen.getByTestId('guests-btn'));
    await user.click(screen.getByTestId('submit-btn'));

    expect(mockErrorToast).toHaveBeenCalledWith('trips.guestsCreateFailed');
    expect(mockSetCurrentTrip).toHaveBeenCalledWith('new-trip-1');
    expect(mockNavigate).toHaveBeenCalledWith('/trips/new-trip-1/calendar');
    consoleSpy.mockRestore();
  });

  it('passes no name to prefill when signed out', () => {
    render(<TripCreatePage />, { withProviders: false });

    expect(lastCurrentUserName).toHaveBeenLastCalledWith(undefined);
  });

  it("passes the account's display name to prefill when signed in", () => {
    mockUser.mockReturnValue({ user_metadata: { full_name: 'Tom Moulard' } });

    render(<TripCreatePage />, { withProviders: false });

    expect(lastCurrentUserName).toHaveBeenLastCalledWith('Tom Moulard');
  });

  it('falls back to the email local part when the account carries no name', () => {
    mockUser.mockReturnValue({ email: 'marie@example.com' });

    render(<TripCreatePage />, { withProviders: false });

    expect(lastCurrentUserName).toHaveBeenLastCalledWith('marie');
  });

  it('does not navigate when trip creation returns no id', async () => {
    mockCreateTrip.mockResolvedValue({ id: undefined });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Override TripForm mock temporarily — the mock's onClick calls onSubmit and
    // the thrown error becomes an unhandled rejection. We need to catch it.
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    // The submit handler will throw, but we verify navigation didn't happen
    await user.click(screen.getByTestId('submit-btn'));

    // Give async error time to propagate
    await new Promise(r => setTimeout(r, 50));

    expect(mockNavigate).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
