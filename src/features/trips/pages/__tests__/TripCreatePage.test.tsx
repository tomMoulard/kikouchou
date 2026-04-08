import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/lib/db', () => ({
  createTrip: vi.fn().mockResolvedValue({ id: 'new-trip-1' }),
  setCurrentTrip: vi.fn().mockResolvedValue(undefined),
  cloneRoomsToTrip: vi.fn().mockResolvedValue(undefined),
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
  TripForm: ({ onSubmit, onCancel }: { onSubmit: (data: unknown) => Promise<void>; onCancel: () => void }) => (
    <div data-testid="trip-form">
      <button data-testid="submit-btn" onClick={() => onSubmit({ name: 'New Trip', startDate: '2026-07-01', endDate: '2026-07-10' })}>Submit</button>
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { TripCreatePage } from '../TripCreatePage';

describe('TripCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
