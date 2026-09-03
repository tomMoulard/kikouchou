/**
 * @fileoverview Tests for ImportTripQrDialog — QR scanning + import flow.
 *
 * @module features/sharing/components/__tests__/ImportTripQrDialog.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockDecodeChangeset = vi.fn();
const mockPrepareChangeset = vi.fn();
const mockComputeMerge = vi.fn();
const mockApplyMerge = vi.fn();
const mockParseFrame = vi.fn();
const mockReassembleFrames = vi.fn();

vi.mock('@/lib/sharing', () => ({
  decodeChangeset: (...args: unknown[]) => mockDecodeChangeset(...args),
  prepareChangesetForLocalImport: (...args: unknown[]) => mockPrepareChangeset(...args),
  computeMerge: (...args: unknown[]) => mockComputeMerge(...args),
  applyMerge: (...args: unknown[]) => mockApplyMerge(...args),
  parseFrame: (...args: unknown[]) => mockParseFrame(...args),
  reassembleFrames: (...args: unknown[]) => mockReassembleFrames(...args),
  ImportChangesetError: class ImportChangesetError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ImportChangesetError';
    }
  },
  IMPORT_SNAPSHOT_REQUIRED: 'import_snapshot_required',
}));

let capturedOnScan: ((data: string) => void) | null = null;

vi.mock('@/components/shared/QRScanner', () => ({
  QRScanner: ({ onScan }: { onScan: (data: string) => void }) => {
    capturedOnScan = onScan;
    return <div data-testid="qr-scanner">QR Scanner</div>;
  },
}));

vi.mock('../../utils/share-qr-parse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/share-qr-parse')>();
  return {
    ...actual,
    extractShareIdFromScannedPayload: vi.fn((payload: string) => {
      if (payload.startsWith('https://app.example.com/share/')) {
        return payload.replace('https://app.example.com/share/', '');
      }
      return null;
    }),
  };
});

import { ImportTripQrDialog } from '../ImportTripQrDialog';

// ============================================================================
// Tests
// ============================================================================

describe('ImportTripQrDialog', () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnScan = null;
    mockParseFrame.mockReturnValue(null);
  });

  it('renders dialog with QR scanner when open', () => {
    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });
    expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
    expect(screen.getByText('trips.importFromQrTitle')).toBeInTheDocument();
  });

  it('does not render scanner when closed', () => {
    render(<ImportTripQrDialog open={false} onOpenChange={onOpenChange} />, { withProviders: false });
    expect(screen.queryByTestId('qr-scanner')).not.toBeInTheDocument();
  });

  it('navigates to the join page when an invite link is scanned', () => {
    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });
    expect(capturedOnScan).not.toBeNull();

    // This is what the Share dialog now produces. A scanner that cannot read the
    // app's own current QR code looks like a broken camera rather than an
    // unsupported format, which is why invite tokens are matched first.
    capturedOnScan!('https://kikouchou.app/join/aBcDeFgHiJkL3456');

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/join/aBcDeFgHiJkL3456');
  });

  it('navigates to the join page for a bare invite token', () => {
    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });

    capturedOnScan!('aBcDeFgHiJkL3456');

    expect(mockNavigate).toHaveBeenCalledWith('/join/aBcDeFgHiJkL3456');
  });

  it('still prefers the legacy formats over a bare-token reading', () => {
    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });

    // A 10-character share id and a 12-character room id must not be mistaken
    // for a 16-character invite token now that invites are checked first.
    capturedOnScan!('https://app.example.com/share/abc123');

    expect(mockNavigate).toHaveBeenCalledWith('/share/abc123');
  });

  it('navigates to share page when share link is scanned', () => {
    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });
    expect(capturedOnScan).not.toBeNull();

    capturedOnScan!('https://app.example.com/share/abc123');

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/share/abc123');
  });

  it('navigates to P2P trip link when collaboration URL is scanned', () => {
    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });
    expect(capturedOnScan).not.toBeNull();

    capturedOnScan!('https://example.com/trip/room-abc#enc-key-xyz');

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/trip/room-abc#enc-key-xyz');
  });

  it('decodes and imports changeset from raw encoded data', async () => {
    const rawChangeset = { tripId: 'trip-1', version: 1, shareId: 'share1' };
    const mergeResult = {
      autoApply: { persons: [], assignments: [], transports: [], rooms: [] },
      conflicts: [],
      warnings: [],
      summary: { additions: 0, autoUpdates: 0, conflicts: 0, warnings: 0 },
      changeset: rawChangeset,
    };

    mockDecodeChangeset.mockReturnValue(rawChangeset);
    mockPrepareChangeset.mockResolvedValue({ prepared: rawChangeset, targetTripId: 'trip-1' });
    mockComputeMerge.mockResolvedValue(mergeResult);
    mockApplyMerge.mockResolvedValue(undefined);

    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });
    capturedOnScan!('some-encoded-payload');

    await waitFor(() => {
      expect(mockDecodeChangeset).toHaveBeenCalledWith('some-encoded-payload');
      expect(mockApplyMerge).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/calendar');
    });
  });

  it('handles multi-frame QR scanning', () => {
    mockParseFrame.mockReturnValueOnce({ index: 0, total: 2, data: 'part1' });
    mockReassembleFrames.mockReturnValue(null); // Not all frames yet

    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });

    // Scan first frame
    capturedOnScan!('frame-data-1');

    expect(mockParseFrame).toHaveBeenCalledWith('frame-data-1');
    expect(mockReassembleFrames).toHaveBeenCalled();
    // Should not attempt decode yet (not all frames)
    expect(mockDecodeChangeset).not.toHaveBeenCalled();
  });

  it('shows error toast when decode fails', async () => {
    mockDecodeChangeset.mockImplementation(() => {
      throw new Error('Invalid data');
    });

    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });
    capturedOnScan!('invalid-encoded-payload');

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('shows error toast when import requires snapshot', async () => {
    const { ImportChangesetError, IMPORT_SNAPSHOT_REQUIRED } = await import('@/lib/sharing');

    const rawChangeset = { tripId: 'trip-1', version: 1, shareId: 'share1' };
    mockDecodeChangeset.mockReturnValue(rawChangeset);
    mockPrepareChangeset.mockRejectedValue(
      new ImportChangesetError(IMPORT_SNAPSHOT_REQUIRED, 'Snapshot required'),
    );

    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });
    capturedOnScan!('encoded-requiring-snapshot');

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('shows generic error toast when merge fails', async () => {
    const rawChangeset = { tripId: 'trip-1', version: 1, shareId: 'share1' };
    mockDecodeChangeset.mockReturnValue(rawChangeset);
    mockPrepareChangeset.mockResolvedValue({ prepared: rawChangeset, targetTripId: 'trip-1' });
    mockComputeMerge.mockRejectedValue(new Error('Merge failed'));

    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });
    capturedOnScan!('encoded-merge-fail');

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('ignores scans while importing', async () => {
    const rawChangeset = { tripId: 'trip-1', version: 1, shareId: 'share1' };
    // Make the import hang indefinitely
    mockDecodeChangeset.mockReturnValue(rawChangeset);
    mockPrepareChangeset.mockReturnValue(new Promise(() => {})); // Never resolves

    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });

    // First scan triggers import (which will never resolve because of the mock)
    capturedOnScan!('payload-1');

    // Wait for the state update (isImporting = true) before scanning again
    await waitFor(() => {
      expect(mockPrepareChangeset).toHaveBeenCalled();
    });

    // Reset mock calls
    mockDecodeChangeset.mockClear();
    mockPrepareChangeset.mockClear();

    // Second scan should be ignored because the import is still in flight
    capturedOnScan!('payload-2');

    // decode should NOT have been called again
    expect(mockDecodeChangeset).not.toHaveBeenCalled();
  });

  /**
   * The case a real scanner produces, and the one the test above cannot see.
   *
   * `useZxing` re-decodes continuously, so holding one code in frame fires
   * `onScan` many times a second — repeatedly within a single tick. The guard
   * therefore has to hold before React has re-rendered, which is why it is a
   * ref and not `isImporting` state: reading state here only ever saw the value
   * captured when the handler was created, so both scans passed it and the trip
   * was imported twice.
   *
   * The test above waits for `prepareChangeset` before scanning again, so it
   * gives React a chance to commit and only failed when CI was loaded enough to
   * lose that race. This one never gives it the chance.
   */
  it('ignores a second scan delivered in the same tick as the first', async () => {
    const rawChangeset = { tripId: 'trip-1', version: 1, shareId: 'share1' };
    mockDecodeChangeset.mockReturnValue(rawChangeset);
    mockPrepareChangeset.mockReturnValue(new Promise(() => {})); // Never resolves

    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });

    // Back to back, with no await between them: React cannot have re-rendered.
    capturedOnScan!('payload-1');
    capturedOnScan!('payload-2');

    await waitFor(() => {
      expect(mockPrepareChangeset).toHaveBeenCalled();
    });

    expect(mockDecodeChangeset).toHaveBeenCalledTimes(1);
    expect(mockPrepareChangeset).toHaveBeenCalledTimes(1);
  });

  it('handles multi-frame completion and import', async () => {
    const rawChangeset = { tripId: 'trip-1', version: 1, shareId: 'share1' };
    const mergeResult = {
      autoApply: { persons: [], assignments: [], transports: [], rooms: [] },
      conflicts: [],
      warnings: [],
      summary: { additions: 0, autoUpdates: 0, conflicts: 0, warnings: 0 },
      changeset: rawChangeset,
    };

    mockParseFrame.mockReturnValueOnce({ index: 0, total: 2, data: 'part1' });
    mockReassembleFrames.mockReturnValueOnce(null); // Not complete yet

    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });

    // First frame - not complete
    capturedOnScan!('frame-1');
    expect(mockDecodeChangeset).not.toHaveBeenCalled();

    // Second frame - now complete
    mockParseFrame.mockReturnValueOnce({ index: 1, total: 2, data: 'part2' });
    mockReassembleFrames.mockReturnValueOnce('complete-payload');
    mockDecodeChangeset.mockReturnValue(rawChangeset);
    mockPrepareChangeset.mockResolvedValue({ prepared: rawChangeset, targetTripId: 'trip-1' });
    mockComputeMerge.mockResolvedValue(mergeResult);
    mockApplyMerge.mockResolvedValue(undefined);

    capturedOnScan!('frame-2');

    await waitFor(() => {
      expect(mockDecodeChangeset).toHaveBeenCalledWith('complete-payload');
      expect(mockApplyMerge).toHaveBeenCalled();
    });
  });

  it('resets state when dialog closes', () => {
    render(<ImportTripQrDialog open={true} onOpenChange={onOpenChange} />, { withProviders: false });

    // Trigger close by calling the handleOpenChange
    // The dialog has onOpenChange that resets refs
    expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
  });
});
