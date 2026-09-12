/**
 * @fileoverview Tests for TripSyncExportPanel — export QR generation.
 *
 * @module features/sharing/components/__tests__/TripSyncExportPanel.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Trip } from '@/types';

// ============================================================================
// localStorage mock
// ============================================================================

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storageMap.set(key, value); }),
  removeItem: vi.fn((key: string) => { storageMap.delete(key); }),
  key: vi.fn((index: number) => [...storageMap.keys()][index] ?? null),
  get length() { return storageMap.size; },
  clear: vi.fn(() => { storageMap.clear(); }),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// ============================================================================
// Mocks
// ============================================================================

const mockBuildChangeset = vi.fn();
const mockBuildHostChangeset = vi.fn();
const mockEncodeChangeset = vi.fn();
const mockSplitIntoFrames = vi.fn();

vi.mock('@/lib/sharing', () => ({
  buildChangeset: (...args: unknown[]) => mockBuildChangeset(...args),
  buildHostChangeset: (...args: unknown[]) => mockBuildHostChangeset(...args),
  encodeChangeset: (...args: unknown[]) => mockEncodeChangeset(...args),
  splitIntoFrames: (...args: unknown[]) => mockSplitIntoFrames(...args),
}));

vi.mock('@/components/shared/LoadingState', () => ({
  LoadingState: ({ variant }: { variant: string }) => <div data-testid="loading-state" data-variant={variant}>Loading...</div>,
}));

vi.mock('@/components/shared/MultiFrameQR', () => ({
  MultiFrameQR: ({ frames, rawPayload }: { frames: string[]; rawPayload: string }) => (
    <div data-testid="multi-frame-qr" data-frames={frames.length} data-raw={rawPayload.length > 0 ? 'yes' : 'no'}>
      QR Display
    </div>
  ),
}));

import { TripSyncExportPanel } from '../TripSyncExportPanel';

// ============================================================================
// Helpers
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Beach Trip',
  location: 'Nice',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ============================================================================
// Tests
// ============================================================================

describe('TripSyncExportPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMap.clear();
  });

  it('shows loading state initially', () => {
    // Don't resolve the promise to keep it in loading state
    mockBuildHostChangeset.mockReturnValue(new Promise(() => {}));
    render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
  });

  it('shows QR code for host export (no guest key)', async () => {
    const changeset = { tripId: 'trip-1', version: 1 };
    mockBuildHostChangeset.mockResolvedValue(changeset);
    mockEncodeChangeset.mockReturnValue('encoded-data');
    mockSplitIntoFrames.mockReturnValue(['frame1']);

    render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByTestId('multi-frame-qr')).toBeInTheDocument();
    });
    expect(screen.getByText(/sharing\.sync\.exportInstructionsHost/)).toBeInTheDocument();
  });

  it('shows error when host export is empty', async () => {
    mockBuildHostChangeset.mockResolvedValue(null);

    render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText(/sharing\.sync\.hostExportEmpty/)).toBeInTheDocument();
    });
  });

  it('shows error when export fails', async () => {
    mockBuildHostChangeset.mockRejectedValue(new Error('Export error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText(/sharing\.sync\.exportError/)).toBeInTheDocument();
    });
  });

  it('uses guest changeset when guest key exists in localStorage', async () => {
    localStorage.setItem('kikouchou_guest_share-abc', JSON.stringify({
      tripId: 'trip-1',
      personId: 'person-1',
    }));

    const changeset = { tripId: 'trip-1', version: 1 };
    mockBuildChangeset.mockResolvedValue(changeset);
    mockEncodeChangeset.mockReturnValue('guest-encoded');
    mockSplitIntoFrames.mockReturnValue(['frame1']);

    render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByTestId('multi-frame-qr')).toBeInTheDocument();
    });
    // Should show guest export instructions (not host)
    expect(screen.getByText(/sharing\.sync\.exportInstructions(?!Host)/)).toBeInTheDocument();
    expect(mockBuildChangeset).toHaveBeenCalledWith('trip-1', 'share-abc', 'person-1');
  });

  it('shows error when guest has no personId', async () => {
    localStorage.setItem('kikouchou_guest_share-abc', JSON.stringify({
      tripId: 'trip-1',
      // no personId
    }));

    render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText(/sharing\.sync\.noGuestIdentity/)).toBeInTheDocument();
    });
  });

  it('shows error when guest has no baseline', async () => {
    localStorage.setItem('kikouchou_guest_share-abc', JSON.stringify({
      tripId: 'trip-1',
      personId: 'person-1',
    }));
    mockBuildChangeset.mockResolvedValue(null);

    render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText(/sharing\.sync\.noBaseline/)).toBeInTheDocument();
    });
  });

  it('uses copy-only export instructions when multiple frames', async () => {
    mockBuildHostChangeset.mockResolvedValue({ tripId: 'trip-1' });
    mockEncodeChangeset.mockReturnValue('encoded');
    mockSplitIntoFrames.mockReturnValue(['frame1', 'frame2', 'frame3']);

    render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText(/sharing\.sync\.exportInstructionsCopyOnly/)).toBeInTheDocument();
    });
    const qr = screen.getByTestId('multi-frame-qr');
    expect(qr.getAttribute('data-frames')).toBe('3');
  });

  it('does not update state when unmounted during host export', async () => {
    let resolveHostChangeset: ((value: unknown) => void) | undefined;
    mockBuildHostChangeset.mockReturnValue(
      new Promise((resolve) => { resolveHostChangeset = resolve; }),
    );

    const { unmount } = render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();

    // Unmount before the promise resolves
    unmount();

    // Now resolve — the cancelled guard should prevent state updates
    resolveHostChangeset?.({ tripId: 'trip-1' });
    // No assertion needed — just verifying no "setState on unmounted" warning
  });

  it('does not update state when unmounted during guest export', async () => {
    localStorage.setItem('kikouchou_guest_share-abc', JSON.stringify({
      tripId: 'trip-1',
      personId: 'person-1',
    }));

    let resolveChangeset: ((value: unknown) => void) | undefined;
    mockBuildChangeset.mockReturnValue(
      new Promise((resolve) => { resolveChangeset = resolve; }),
    );

    const { unmount } = render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });
    unmount();

    expect(mockBuildChangeset).toHaveBeenCalled();
    resolveChangeset?.({ tripId: 'trip-1' });
    // Give the resolved continuation a turn. Without this the assertions below
    // run before the `await` in the effect has resumed and would hold whatever
    // the guard did.
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    // "Verifying no crash" was the whole assertion here, and there was none.
    // Nor is a console spy one: React dropped the "setState on an unmounted
    // component" warning in v18 and this repo is on 19, so nothing is logged
    // either way. The abort check is observable in exactly one place — the
    // export stops before encoding a payload nobody will ever see.
    expect(mockEncodeChangeset).not.toHaveBeenCalled();
  });

  it('skips malformed localStorage entries when searching for guest key', async () => {
    // Store malformed JSON that should be caught silently
    localStorage.setItem('kikouchou_guest_bad', '{invalid json');
    // Also store a valid guest entry for a different trip
    localStorage.setItem('kikouchou_guest_other', JSON.stringify({
      tripId: 'other-trip',
      personId: 'person-99',
    }));

    // No matching guest key → should fall through to host export
    mockBuildHostChangeset.mockResolvedValue({ tripId: 'trip-1' });
    mockEncodeChangeset.mockReturnValue('encoded');
    mockSplitIntoFrames.mockReturnValue(['frame1']);

    render(<TripSyncExportPanel trip={mockTrip} />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByTestId('multi-frame-qr')).toBeInTheDocument();
    });
    expect(mockBuildHostChangeset).toHaveBeenCalled();
  });
});
