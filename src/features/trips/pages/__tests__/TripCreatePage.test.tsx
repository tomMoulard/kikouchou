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

vi.mock('@/lib/db', () => ({
  createTrip: (...args: unknown[]) => mockCreateTrip(...args),
  setCurrentTrip: (...args: unknown[]) => mockSetCurrentTrip(...args),
  cloneRoomsToTrip: (...args: unknown[]) => mockCloneRoomsToTrip(...args),
}));

vi.mock('@/hooks', () => ({
  useUnsavedChanges: () => ({
    isBlocked: false,
    proceed: vi.fn(),
    reset: vi.fn(),
    skipNextBlock: vi.fn(),
  }),
}));

// Mock TripForm to avoid deep component tree
vi.mock('@/features/trips/components/TripForm', () => ({
  TripForm: ({ onSubmit, onCancel, onImportSourceChange }: {
    onSubmit: (data: unknown) => Promise<void>;
    onCancel: () => void;
    onImportSourceChange?: (id: string | null) => void;
  }) => (
    <div data-testid="trip-form">
      <button data-testid="submit-btn" onClick={() => void onSubmit({ name: 'New Trip', startDate: '2026-07-01', endDate: '2026-07-10' }).catch(() => {})}>Submit</button>
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
      <button data-testid="import-source-btn" onClick={() => onImportSourceChange?.('source-trip-id')}>Set Import</button>
      <button data-testid="clear-import-btn" onClick={() => onImportSourceChange?.(null)}>Clear Import</button>
    </div>
  ),
}));

import { TripCreatePage } from '../TripCreatePage';

describe('TripCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTrip.mockResolvedValue({ id: 'new-trip-1' });
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
