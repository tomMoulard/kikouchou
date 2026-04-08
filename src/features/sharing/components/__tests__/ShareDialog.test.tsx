/**
 * @fileoverview Tests for ShareDialog — P2P full-trip export (same as Sync).
 * @module features/sharing/components/__tests__/ShareDialog.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ShareDialog } from '../ShareDialog';
import type { Trip } from '@/types';

// ShareDialog delegates export UI to TripSyncExportPanel — stub it to avoid loading the full sharing stack in this dialog test.
vi.mock('../TripSyncExportPanel', () => ({
  TripSyncExportPanel: () => (
    <div
      data-testid="multi-frame-qr"
      data-payload-length={String('ENCODED_PAYLOAD_FOR_QR'.length)}
    />
  ),
}));

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      return key;
    },
  }),
}));

const mockTrip: Trip = {
  id: 'trip-1',
  name: 'Test Trip',
  shareId: 'abc123',
  startDate: '2026-01-05',
  endDate: '2026-01-10',
  createdAt: 1,
  updatedAt: 1,
};

// Mock TripContext
vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(() => ({
    currentTrip: mockTrip,
  })),
}));

describe('ShareDialog', () => {
  beforeEach(async () => {
    const { useTripContext } = await import('@/contexts/TripContext');
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: mockTrip,
    } as ReturnType<typeof useTripContext>);
  });

  afterEach(async () => {
    const { useTripContext } = await import('@/contexts/TripContext');
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: mockTrip,
    } as ReturnType<typeof useTripContext>);
  });

  it('renders P2P description and loads full-trip QR when open', async () => {
    render(<ShareDialog open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText('sharing.p2pDescription')).toBeInTheDocument();
    expect(screen.getByText('sharing.p2pNotice')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('multi-frame-qr')).toBeInTheDocument();
    });

    const qr = screen.getByTestId('multi-frame-qr');
    expect(qr.getAttribute('data-payload-length')).toBe(
      String('ENCODED_PAYLOAD_FOR_QR'.length),
    );
  });

  it('renders empty state when no trip in context and no trip prop', async () => {
    const { useTripContext } = await import('@/contexts/TripContext');
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
    } as ReturnType<typeof useTripContext>);

    render(<ShareDialog open={true} onOpenChange={vi.fn()} />);

    expect(
      screen.getByText('No trip selected. Please select a trip first.'),
    ).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    const { container } = render(<ShareDialog open={false} onOpenChange={vi.fn()} />);
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  it('uses trip prop when context has no current trip', async () => {
    const { useTripContext } = await import('@/contexts/TripContext');
    vi.mocked(useTripContext).mockReturnValueOnce({
      currentTrip: null,
      trips: [],
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    } as unknown as ReturnType<typeof useTripContext>);

    render(
      <ShareDialog
        open={true}
        onOpenChange={vi.fn()}
        trip={mockTrip}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('multi-frame-qr')).toBeInTheDocument();
    });
  });
});
