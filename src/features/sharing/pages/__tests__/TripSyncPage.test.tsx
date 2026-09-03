/**
 * @fileoverview Tests for TripSyncPage component.
 * @module features/sharing/pages/__tests__/TripSyncPage.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { Trip } from '@/types';

// ============================================================================
// Mock Data
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Summer Retreat',
  location: 'Chamonix',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockGetTripById = vi.fn().mockResolvedValue(mockTrip);

vi.mock('@/lib/db', () => ({
  getTripById: (...args: unknown[]) => mockGetTripById(...args),
}));

vi.mock('@/lib/sharing', () => ({
  decodeChangeset: vi.fn(),
  parseFrame: vi.fn().mockReturnValue(null),
  reassembleFrames: vi.fn(),
  computeMerge: vi.fn(),
  applyMerge: vi.fn(),
}));

// Mock QRScanner since it uses camera
vi.mock('@/components/shared/QRScanner', () => ({
  QRScanner: ({ onScan }: { onScan: (data: string) => void }) => (
    <div data-testid="qr-scanner">
      <button data-testid="mock-scan" onClick={() => onScan('test-data')}>Scan</button>
    </div>
  ),
}));

// Mock TripSyncExportPanel since it's complex
vi.mock('../../components/TripSyncExportPanel', () => ({
  TripSyncExportPanel: ({ trip }: { trip: Trip }) => (
    <div data-testid="export-panel">Export panel for {trip.name}</div>
  ),
}));

import { TripSyncPage } from '../TripSyncPage';

// Helper to render with router
function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ============================================================================
// Tests
// ============================================================================

describe('TripSyncPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTripById.mockResolvedValue(mockTrip);
  });

  it('renders loading state initially', () => {
    // Make trip load never resolve
    mockGetTripById.mockReturnValue(new Promise(() => {}));

    renderWithRouter(<TripSyncPage />);
    expect(screen.getByText('sharing.sync.pageTitle')).toBeInTheDocument();
  });

  it('renders trip not found when trip does not exist', async () => {
    mockGetTripById.mockResolvedValue(null);

    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.tripNotFound')).toBeInTheDocument();
    });
    // An empty state, announced politely — not a bare paragraph.
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('sharing.sync.tripNotFound');
  });

  it('surfaces a load failure as a retryable error, not as "trip not found"', async () => {
    // A read that threw is not the same thing as a trip that is not there.
    mockGetTripById.mockRejectedValueOnce(new Error('IndexedDB is unavailable'));

    renderWithRouter(<TripSyncPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent('sharing.sync.loadError');
    expect(alert).toHaveTextContent('IndexedDB is unavailable');
    expect(screen.queryByText('sharing.sync.tripNotFound')).not.toBeInTheDocument();
  });

  it('retries the load and recovers when the second read succeeds', async () => {
    const user = userEvent.setup();
    mockGetTripById.mockRejectedValueOnce(new Error('IndexedDB is unavailable'));

    renderWithRouter(<TripSyncPage />);

    await screen.findByRole('alert');
    // Second call falls through to the beforeEach resolved value.
    await user.click(screen.getByRole('button', { name: 'common.retry' }));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.importTab')).toBeInTheDocument();
    });
    expect(mockGetTripById).toHaveBeenCalledTimes(2);
  });

  it('renders sync page with import and export tabs after loading', async () => {
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.importTab')).toBeInTheDocument();
    });
    expect(screen.getByText('sharing.sync.exportTab')).toBeInTheDocument();
    expect(screen.getByText('sharing.sync.pageTitle')).toBeInTheDocument();
  });

  it('renders trip name as description in header', async () => {
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByText('Summer Retreat')).toBeInTheDocument();
    });
  });

  it('shows import tab content by default', async () => {
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.importInstructions')).toBeInTheDocument();
    });
    expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
  });

  it('switches to export tab when clicked', async () => {
    const user = userEvent.setup();

    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.exportTab')).toBeInTheDocument();
    });

    await user.click(screen.getByText('sharing.sync.exportTab'));

    await waitFor(() => {
      expect(screen.getByTestId('export-panel')).toBeInTheDocument();
    });
  });

  it('renders QR scanner in import tab', async () => {
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
    });
  });

  it('shows scan error when QR data is for different trip', async () => {
    const { decodeChangeset } = await import('@/lib/sharing');
    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'different-trip-id',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.wrongTrip')).toBeInTheDocument();
    });
  });

  it('shows decode error on malformed QR data', async () => {
    const { decodeChangeset } = await import('@/lib/sharing');
    vi.mocked(decodeChangeset).mockImplementation(() => {
      throw new Error('Malformed data');
    });

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('Malformed data')).toBeInTheDocument();
    });
  });

  it('shows merge review when QR data is valid', async () => {
    const { decodeChangeset, computeMerge } = await import('@/lib/sharing');
    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 2, autoUpdates: 1, conflicts: 0, warnings: 0 },
      autoApply: { persons: [], assignments: [], transports: [] },
      conflicts: [],
      warnings: [],
    } as never);

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.mergeSummary')).toBeInTheDocument();
    });
    expect(screen.getByText('sharing.sync.autoApplyCount')).toBeInTheDocument();
  });

  it('shows no changes message in merge review', async () => {
    const { decodeChangeset, computeMerge } = await import('@/lib/sharing');
    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 0, autoUpdates: 0, conflicts: 0, warnings: 0 },
      autoApply: { persons: [], assignments: [], transports: [] },
      conflicts: [],
      warnings: [],
    } as never);

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.noChanges')).toBeInTheDocument();
    });
  });

  it('shows conflicts and allows resolution', async () => {
    const { decodeChangeset, computeMerge } = await import('@/lib/sharing');
    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 0, autoUpdates: 0, conflicts: 1, warnings: 0 },
      autoApply: { persons: [], assignments: [], transports: [] },
      conflicts: [{
        entityId: 'entity-1',
        entityType: 'person',
        label: 'Alice',
        conflictingFields: ['name', 'color'],
      }],
      warnings: [],
    } as never);

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.conflictsTitle')).toBeInTheDocument();
    });

    // Check conflict card content
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('sharing.sync.conflictFields')).toBeInTheDocument();
    expect(screen.getByText('sharing.sync.conflictCount')).toBeInTheDocument();

    // Apply button should be disabled (unresolved conflict)
    const applyBtn = screen.getByText('sharing.sync.applyMerge');
    expect(applyBtn.closest('button')).toBeDisabled();

    // Resolve conflict by keeping mine
    await user.click(screen.getByText('sharing.sync.keepMine'));

    // Apply button should now be enabled
    await waitFor(() => {
      expect(applyBtn.closest('button')).not.toBeDisabled();
    });
  });

  it('applies merge and navigates on success', async () => {
    const { decodeChangeset, computeMerge, applyMerge } = await import('@/lib/sharing');
    const { toast } = await import('sonner');

    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 2, autoUpdates: 1, conflicts: 0, warnings: 0 },
      autoApply: { persons: [{ id: 'p1', name: 'Alice' }], assignments: [], transports: [] },
      conflicts: [],
      warnings: [],
    } as never);

    vi.mocked(applyMerge).mockResolvedValue({
      roomsUpserted: 0,
      personsUpserted: 1,
      assignmentsUpserted: 0,
      transportsUpserted: 0,
      conflictsAccepted: 0,
      conflictsKept: 0,
    });

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.applyMerge')).toBeInTheDocument();
    });

    await user.click(screen.getByText('sharing.sync.applyMerge'));

    await waitFor(() => {
      expect(vi.mocked(applyMerge)).toHaveBeenCalled();
    });
    expect(vi.mocked(toast.success)).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/calendar');
  });

  it('shows apply error toast on merge failure', async () => {
    const { decodeChangeset, computeMerge, applyMerge } = await import('@/lib/sharing');
    const { toast } = await import('sonner');

    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 1, autoUpdates: 0, conflicts: 0, warnings: 0 },
      autoApply: { persons: [{ id: 'p1', name: 'Bob' }], assignments: [], transports: [] },
      conflicts: [],
      warnings: [],
    } as never);

    vi.mocked(applyMerge).mockRejectedValue(new Error('DB write failed'));

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.applyMerge')).toBeInTheDocument();
    });

    await user.click(screen.getByText('sharing.sync.applyMerge'));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
  });

  it('shows warnings in merge review', async () => {
    const { decodeChangeset, computeMerge } = await import('@/lib/sharing');

    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 1, autoUpdates: 0, conflicts: 0, warnings: 2 },
      autoApply: { persons: [{ id: 'p1', name: 'Alice' }], assignments: [], transports: [] },
      conflicts: [],
      warnings: [
        { message: 'Room capacity exceeded' },
        { message: 'Person already assigned' },
      ],
    } as never);

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.warningsTitle')).toBeInTheDocument();
    });
    expect(screen.getByText('Room capacity exceeded')).toBeInTheDocument();
    expect(screen.getByText('Person already assigned')).toBeInTheDocument();
    expect(screen.getByText('sharing.sync.warningCount')).toBeInTheDocument();
  });

  it('toggles auto-apply details section', async () => {
    const { decodeChangeset, computeMerge } = await import('@/lib/sharing');

    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 0, autoUpdates: 3, conflicts: 0, warnings: 0 },
      autoApply: {
        persons: [{ id: 'p1', name: 'Alice' }],
        assignments: [{ id: 'a1-full-id-here' }],
        transports: [{ id: 'tr1', type: 'arrival', location: 'Paris Gare' }],
      },
      conflicts: [],
      warnings: [],
    } as never);

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.autoApplied')).toBeInTheDocument();
    });

    // Details should be hidden initially
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();

    // Click to expand details
    await user.click(screen.getByText('sharing.sync.autoApplied'));

    // Now details should be visible
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('resets scan state when scan another button is clicked', async () => {
    const { decodeChangeset, computeMerge } = await import('@/lib/sharing');

    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 0, autoUpdates: 0, conflicts: 0, warnings: 0 },
      autoApply: { persons: [], assignments: [], transports: [] },
      conflicts: [],
      warnings: [],
    } as never);

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.scanAnother')).toBeInTheDocument();
    });

    await user.click(screen.getByText('sharing.sync.scanAnother'));

    // Should return to scanner view
    await waitFor(() => {
      expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
    });
  });

  it('handles multi-frame QR code scanning', async () => {
    const { parseFrame, reassembleFrames } = await import('@/lib/sharing');

    // First frame: not complete
    vi.mocked(parseFrame).mockReturnValueOnce({ index: 0, total: 2, data: 'part1' });
    vi.mocked(reassembleFrames).mockReturnValueOnce(null);

    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    // Trigger scan for first frame
    const user = userEvent.setup();
    await user.click(screen.getByTestId('mock-scan'));

    // Should show frame progress
    await waitFor(() => {
      expect(screen.getByText('sharing.sync.framesProgress')).toBeInTheDocument();
    });
  });

  it('shows non-Error exception as generic decode error', async () => {
    const { decodeChangeset } = await import('@/lib/sharing');
    vi.mocked(decodeChangeset).mockImplementation(() => {
      throw 'string error'; // non-Error thrown
    });

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.decodeError')).toBeInTheDocument();
    });
  });

  it('resolves conflict with accept-guest option', async () => {
    const { decodeChangeset, computeMerge } = await import('@/lib/sharing');

    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 0, autoUpdates: 0, conflicts: 1, warnings: 0 },
      autoApply: { persons: [], assignments: [], transports: [] },
      conflicts: [{
        entityId: 'entity-1',
        entityType: 'assignment',
        label: 'Room A assignment',
        conflictingFields: ['dates'],
      }],
      warnings: [],
    } as never);

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('sharing.sync.acceptGuest')).toBeInTheDocument();
    });

    await user.click(screen.getByText('sharing.sync.acceptGuest'));

    // Apply button should be enabled now
    const applyBtn = screen.getByText('sharing.sync.applyMerge');
    await waitFor(() => {
      expect(applyBtn.closest('button')).not.toBeDisabled();
    });
  });

  it('renders transport entity type icon in conflict card', async () => {
    const { decodeChangeset, computeMerge } = await import('@/lib/sharing');

    vi.mocked(decodeChangeset).mockReturnValue({
      tripId: 'trip-1',
      version: 1,
      timestamp: Date.now(),
      persons: [],
      rooms: [],
      assignments: [],
      transports: [],
    } as never);

    vi.mocked(computeMerge).mockResolvedValue({
      summary: { additions: 0, autoUpdates: 0, conflicts: 1, warnings: 0 },
      autoApply: { persons: [], assignments: [], transports: [] },
      conflicts: [{
        entityId: 'entity-2',
        entityType: 'transport',
        label: 'Train to Paris',
        conflictingFields: ['datetime'],
      }],
      warnings: [],
    } as never);

    const user = userEvent.setup();
    renderWithRouter(<TripSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-scan')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mock-scan'));

    await waitFor(() => {
      expect(screen.getByText('Train to Paris')).toBeInTheDocument();
    });
  });
});
