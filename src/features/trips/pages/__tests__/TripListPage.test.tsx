import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Trip } from '@/types';

// Must be before imports that use them
const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockCheckConnection = vi.fn().mockResolvedValue(undefined);
const mockResolveTripPresenceProfile = vi.fn().mockResolvedValue(null);

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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(() => ({
    trips: [mockTrip],
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    checkConnection: mockCheckConnection,
  })),
}));

vi.mock('@/features/sharing', () => ({
  ImportTripQrDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="import-qr-dialog" /> : null,
  ShareDialog: ({
    open,
    onOpenChange,
    onSyncReady,
  }: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onSyncReady?: (sync: { tripId: string; roomId: string; encryptionKey: string }) => void;
  }) =>
    open ? (
      <div data-testid="share-dialog">
        <button
          data-testid="ready-share-sync"
          onClick={() =>
            onSyncReady?.({
              tripId: 'trip-1',
              roomId: 'room-1',
              encryptionKey: 'key-1',
            })
          }
        >
          Ready
        </button>
        <button data-testid="close-share-dialog" onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}));

vi.mock('@/lib/yjs', () => ({
  TripYjsSyncBinding: ({
    tripId,
    roomId,
    encryptionKey,
  }: {
    tripId: string;
    roomId: string;
    encryptionKey: string;
  }) => (
    <div data-testid="trip-yjs-sync-binding">
      {tripId}:{roomId}:{encryptionKey}
    </div>
  ),
  resolveTripPresenceProfile: (...args: unknown[]) => mockResolveTripPresenceProfile(...args),
}));

vi.mock('@/features/trips/components/TripsLocationMap', () => ({
  TripsLocationMap: ({
    trips,
    asCard,
    height,
  }: {
    trips: readonly Trip[];
    asCard?: boolean;
    height?: number;
  }) => (
    <div
      data-testid="trips-location-map"
      data-trip-count={trips.length}
      data-as-card={String(asCard)}
      data-height={height}
    />
  ),
}));

// Stub the "joined elsewhere" section: it needs AuthProvider, which
// withProviders:false does not supply, and its own states are covered in
// features/trips/components/__tests__.
vi.mock('../../components/RemoteTripsSection', () => ({
  RemoteTripsSection: () => <div data-testid="remote-trips-section" />,
}));

vi.mock('@/lib/db/database', () => ({
  db: {
    persons: {
      where: () => ({
        anyOf: () => ({
          toArray: () => Promise.resolve([]),
        }),
      }),
    },
  },
}));

import { TripListPage } from '../TripListPage';
import { useTripContext } from '@/contexts/TripContext';

describe('TripListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTripPresenceProfile.mockResolvedValue(null);
    vi.mocked(useTripContext).mockReturnValue({
      trips: [mockTrip],
      isLoading: false,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
  });

  it('renders the trip list with trips', async () => {
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByText('trips.title')).toBeInTheDocument();
      expect(screen.getByText('Test Trip')).toBeInTheDocument();
    });
  });

  it('renders loading state', () => {
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: true,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    expect(screen.getByText('trips.title')).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: false,
      error: new Error('Database error'),
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    expect(screen.getByText('trips.title')).toBeInTheDocument();
  });

  it('renders empty state when no trips', () => {
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: false,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    expect(screen.getByText('trips.empty')).toBeInTheDocument();
  });

  it('navigates to create page on new trip button click', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: false,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    // Click the action button in EmptyState (there may be multiple; pick the first button)
    const newBtns = screen.getAllByRole('button', { name: 'trips.new' });
    await user.click(newBtns[0]!);
    expect(mockNavigate).toHaveBeenCalledWith('/trips/new');
  });

  it('selects a trip and navigates to its calendar', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByText('Test Trip')).toBeInTheDocument();
    });
    // Click the trip card
    await user.click(screen.getByText('Test Trip'));
    await waitFor(() => {
      expect(mockSetCurrentTrip).toHaveBeenCalledWith('trip-1');
      expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/calendar');
    });
  });

  it('handles trip selection error gracefully', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    mockSetCurrentTrip.mockRejectedValueOnce(new Error('DB error'));
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByText('Test Trip')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Test Trip'));
    await waitFor(() => {
      expect(mockSetCurrentTrip).toHaveBeenCalled();
    });
    // Should not crash and should be able to click again
    mockSetCurrentTrip.mockResolvedValueOnce(undefined);
    await user.click(screen.getByText('Test Trip'));
    await waitFor(() => {
      expect(mockSetCurrentTrip).toHaveBeenCalledTimes(2);
    });
  });

  it('opens import QR dialog when import button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByText('Test Trip')).toBeInTheDocument();
    });
    // Click the QR import button (aria-label)
    const importBtns = screen.getAllByLabelText(/trips\.importFromQrAria/);
    await user.click(importBtns[0]!);
    expect(screen.getByTestId('import-qr-dialog')).toBeInTheDocument();
  });

  it('renders trip list with role="list"', async () => {
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'trips.title' })).toBeInTheDocument();
    });
  });

  it('calls checkConnection on error retry', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: false,
      error: new Error('Connection error'),
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    // ErrorDisplay should have a retry button
    const retryBtn = screen.getByRole('button', { name: /common\.retry/i });
    await user.click(retryBtn);
    expect(mockCheckConnection).toHaveBeenCalled();
  });

  it('renders multiple trips in the list', async () => {
    const secondTrip: Trip = {
      id: 'trip-2' as Trip['id'],
      shareId: 'share-2' as Trip['shareId'],
      name: 'Winter Holiday',
      location: 'Alps',
      startDate: '2026-12-20' as Trip['startDate'],
      endDate: '2026-12-30' as Trip['endDate'],
      description: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    vi.mocked(useTripContext).mockReturnValue({
      trips: [mockTrip, secondTrip],
      isLoading: false,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByText('Test Trip')).toBeInTheDocument();
      expect(screen.getByText('Winter Holiday')).toBeInTheDocument();
    });
    // Should have multiple list items
    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBe(2);
  });

  it('shows loading state with import QR button available', () => {
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: true,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    // Import QR button should be available even during loading
    const importBtns = screen.getAllByLabelText(/trips\.importFromQrAria/);
    expect(importBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('renders create button on desktop', () => {
    vi.mocked(useTripContext).mockReturnValue({
      trips: [mockTrip],
      isLoading: false,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    // Desktop new button is hidden on mobile but exists in DOM
    const newBtns = screen.getAllByRole('button', { name: 'trips.new' });
    expect(newBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('opens share dialog when share button is clicked on a trip card', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByText('Test Trip')).toBeInTheDocument();
    });
    // Click the share button on the trip card
    const shareBtn = screen.getByLabelText(/trips\.shareTripAria/);
    await user.click(shareBtn);
    expect(screen.getByTestId('share-dialog')).toBeInTheDocument();
  });

  it('prevents double navigation when clicking trip rapidly', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    // Make setCurrentTrip slow so isNavigating stays true
    mockSetCurrentTrip.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 500)),
    );
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByText('Test Trip')).toBeInTheDocument();
    });
    // Click rapidly — second click should be guarded
    const card = screen.getByText('Test Trip');
    await user.click(card);
    await user.click(card);
    // Only one call should go through due to the guard
    expect(mockSetCurrentTrip).toHaveBeenCalledTimes(1);
  });

  it('closes share dialog when onOpenChange is called with false', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByText('Test Trip')).toBeInTheDocument();
    });
    // Open share dialog
    const shareBtn = screen.getByLabelText(/trips\.shareTripAria/);
    await user.click(shareBtn);
    expect(screen.getByTestId('share-dialog')).toBeInTheDocument();
    // Close it
    const closeBtn = screen.getByTestId('close-share-dialog');
    await user.click(closeBtn);
    expect(screen.queryByTestId('share-dialog')).not.toBeInTheDocument();
  });

  // Deleted with the WebRTC transport: "keeps the shared trip sync binding alive
  // after the share dialog closes".
  //
  // That test guarded a mechanism that existed only because WebRTC needed both
  // peers connected at the same moment — the trip had to be held online while
  // its share link was on screen, in case the other side turned up. The server
  // holds the log now, so the other side can arrive whenever it likes and there
  // is nothing to keep alive. The behaviour was removed, so the test went with
  // it rather than being adapted to assert something that no longer matters.

  // ==========================================================================
  // View Tabs
  // ==========================================================================

  describe('view tabs', () => {
    it('shows the trip cards by default', async () => {
      render(<TripListPage />, { withProviders: false });

      await waitFor(() => {
        expect(screen.getByText('Test Trip')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('trips-location-map')).not.toBeInTheDocument();
    });

    it('offers a list tab and a map tab', async () => {
      render(<TripListPage />, { withProviders: false });

      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'trips.view.list' })).toBeInTheDocument();
      });
      expect(screen.getByRole('radio', { name: 'trips.view.map' })).toBeInTheDocument();
    });

    it('swaps the cards for the map when the map tab is picked', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<TripListPage />, { withProviders: false });

      await user.click(screen.getByRole('radio', { name: 'trips.view.map' }));

      await waitFor(() => {
        expect(screen.getByTestId('trips-location-map')).toBeInTheDocument();
      });
      expect(screen.queryByText('Test Trip')).not.toBeInTheDocument();
    });

    it('hands the map every trip', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<TripListPage />, { withProviders: false });

      await user.click(screen.getByRole('radio', { name: 'trips.view.map' }));

      await waitFor(() => {
        expect(screen.getByTestId('trips-location-map')).toHaveAttribute(
          'data-trip-count',
          '1',
        );
      });
      // The tab already says "map"; the card's own heading would repeat it.
      expect(screen.getByTestId('trips-location-map')).toHaveAttribute(
        'data-as-card',
        'false',
      );
    });

    it('opens straight into the map when the URL asks for it', async () => {
      render(<TripListPage />, {
        withProviders: false,
        initialEntries: ['/trips?view=map'],
      });

      await waitFor(() => {
        expect(screen.getByTestId('trips-location-map')).toBeInTheDocument();
      });
      expect(screen.getByRole('radio', { name: 'trips.view.map' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('falls back to the list for an unknown view', async () => {
      render(<TripListPage />, {
        withProviders: false,
        initialEntries: ['/trips?view=elsewhere'],
      });

      await waitFor(() => {
        expect(screen.getByText('Test Trip')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('trips-location-map')).not.toBeInTheDocument();
    });

    it('shows no tabs at all when there are no trips to view', () => {
      vi.mocked(useTripContext).mockReturnValue({
        trips: [],
        isLoading: false,
        error: null,
        currentTrip: null,
        setCurrentTrip: mockSetCurrentTrip,
        checkConnection: mockCheckConnection,
      });

      render(<TripListPage />, { withProviders: false });

      expect(screen.getByText('trips.empty')).toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'trips.view.map' })).not.toBeInTheDocument();
    });
  });

});
