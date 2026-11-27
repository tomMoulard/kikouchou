import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';

import type { Trip } from '@/types';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => ({
  setCurrentTrip: (...args: unknown[]) => mockSetCurrentTrip(...args),
}));

const mockReportError = vi.fn();
vi.mock('@/lib/posthog', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

// The page renders without AppProviders here, and `useAuth` throws outside its
// provider by design. Mocking the hook keeps this suite about the page.
const mockUser = vi.fn<() => { user_metadata?: Record<string, unknown>; email?: string } | null>(
  () => null,
);

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser() }),
}));

const mockHideNavigation = vi.fn();
vi.mock('@/contexts/NavigationVisibilityContext', () => ({
  useHideNavigation: (hidden: boolean) => mockHideNavigation(hidden),
}));

const mockSkipNextBlock = vi.fn();
vi.mock('@/hooks', () => ({
  useUnsavedChanges: () => ({
    isBlocked: false,
    proceed: vi.fn(),
    reset: vi.fn(),
    skipNextBlock: mockSkipNextBlock,
  }),
}));

// The wizard has its own suite. Here it is a stub that hands the page what the
// real one would: the props it was given, and a created trip on demand.
const lastWizardProps = vi.fn();
const CREATED_TRIP = { id: 'new-trip-1', name: 'Corsica' } as unknown as Trip;

vi.mock('@/features/trips/components/TripCreateWizard', () => ({
  TripCreateWizard: (props: {
    currentUserName?: string;
    onCreated: (trip: Trip) => void;
    onCancel: () => void;
  }) => {
    lastWizardProps(props);
    return (
      <div data-testid="trip-wizard">
        <button data-testid="created-btn" onClick={() => props.onCreated(CREATED_TRIP)}>
          Open
        </button>
        <button data-testid="cancel-btn" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    );
  },
}));

import { TripCreatePage } from '../TripCreatePage';
import { areRewardsHeld } from '@/lib/achievements/reward-hold';

describe('TripCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockUser.mockReturnValue(null);
  });

  it('shows the wizard under the new trip heading', () => {
    render(<TripCreatePage />, { withProviders: false });

    expect(screen.getByText('trips.new')).toBeInTheDocument();
    expect(screen.getByTestId('trip-wizard')).toBeInTheDocument();
  });

  it('hides the navigation beside the wizard', () => {
    render(<TripCreatePage />, { withProviders: false });

    expect(mockHideNavigation).toHaveBeenLastCalledWith(true);
  });

  // The wizard ends on its sign-in screen, and the first trip unlocks an
  // achievement: its toast covered the sign-in buttons.
  it('holds the achievement message while the page is on screen, and lets go after', () => {
    const { unmount } = render(<TripCreatePage />, { withProviders: false });
    expect(areRewardsHeld()).toBe(true);

    unmount();
    expect(areRewardsHeld()).toBe(false);
  });

  it('navigates back on cancel', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    await user.click(screen.getByTestId('cancel-btn'));

    expect(mockSkipNextBlock).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/trips');
  });

  it('selects the created trip and opens its calendar', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    await user.click(screen.getByTestId('created-btn'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/trips/new-trip-1/calendar');
    });
    expect(mockSetCurrentTrip).toHaveBeenCalledWith('new-trip-1');
    expect(mockSkipNextBlock).toHaveBeenCalled();
  });

  it('still opens the calendar when the trip cannot be selected', async () => {
    const failure = new Error('selection failed');
    mockSetCurrentTrip.mockRejectedValue(failure);
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripCreatePage />, { withProviders: false });

    await user.click(screen.getByTestId('created-btn'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/trips/new-trip-1/calendar');
    });
    expect(mockReportError).toHaveBeenCalledWith(failure, {
      source: 'TripCreatePage.handleWizardCreated',
    });
  });

  it('passes no name for the creator when signed out', () => {
    render(<TripCreatePage />, { withProviders: false });

    expect(lastWizardProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentUserName: undefined }),
    );
  });

  it("passes the account's display name when signed in", () => {
    mockUser.mockReturnValue({ user_metadata: { full_name: 'Tom Moulard' } });

    render(<TripCreatePage />, { withProviders: false });

    expect(lastWizardProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentUserName: 'Tom Moulard' }),
    );
  });

  it('falls back to the email local part when the account carries no name', () => {
    mockUser.mockReturnValue({ email: 'marie@example.com' });

    render(<TripCreatePage />, { withProviders: false });

    expect(lastWizardProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentUserName: 'marie' }),
    );
  });

  describe('a phone held sideways', () => {
    /**
     * Answers only the short-landscape query, as `Layout` is doing beside it.
     */
    function setShortLandscape(isShort: boolean): void {
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) =>
          ({
            matches: query.includes('orientation: landscape') ? isShort : false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      );
    }

    /** The page's outermost element, the one carrying the vertical padding. */
    function getFrame(): Element | null {
      return document.querySelector('.container');
    }

    it('spends less height on its own frame', () => {
      setShortLandscape(true);

      render(<TripCreatePage />, { withProviders: false });

      expect(getFrame()).toHaveClass('py-2');
      expect(getFrame()).not.toHaveClass('py-6');
    });

    it('keeps the usual frame once the phone is upright', () => {
      setShortLandscape(false);

      render(<TripCreatePage />, { withProviders: false });

      expect(getFrame()).toHaveClass('py-6');
      expect(getFrame()).not.toHaveClass('py-2');
    });

    it('still shows the wizard and the way back out', () => {
      setShortLandscape(true);

      render(<TripCreatePage />, { withProviders: false });

      // The shell's own back affordances are gone at this viewport, so the
      // page's heading link is the only one left.
      expect(screen.getByTestId('trip-wizard')).toBeInTheDocument();
      expect(screen.getByText('trips.new')).toBeInTheDocument();
    });
  });
});
