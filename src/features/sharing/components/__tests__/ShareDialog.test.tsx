/**
 * @fileoverview Tests for ShareDialog.
 * @module features/sharing/components/__tests__/ShareDialog.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { ShareDialog } from '../ShareDialog';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

const mockUpdateTrip = vi.fn();
const mockWriteText = vi.fn();
const originalClipboard = window.navigator.clipboard;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _key,
  }),
}));

vi.mock('nanoid', () => ({
  nanoid: vi
    .fn()
    .mockImplementationOnce(() => 'room-id-1234')
    .mockImplementationOnce(() => 'secret-key-abcdefghijkl'),
}));

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({
    currentTrip: null,
  }),
}));

const mockGetTrip = vi.fn();

vi.mock('@/lib/db/database', () => ({
  db: {
    trips: {
      get: (...args: unknown[]) => mockGetTrip(...args),
      update: (...args: unknown[]) => mockUpdateTrip(...args),
    },
  },
}));

const baseTrip: Trip = {
  id: 'trip-1' as TripId,
  name: 'Shared Trip',
  shareId: 'share-123' as ShareId,
  startDate: '2026-08-10' as ISODateString,
  endDate: '2026-08-20' as ISODateString,
  createdAt: 1,
  updatedAt: 1,
};

describe('ShareDialog', () => {
  const onSyncReady = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTrip.mockResolvedValue(baseTrip);
    mockUpdateTrip.mockResolvedValue(undefined);
    mockWriteText.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockWriteText },
    });
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('generates missing room credentials, persists them, and renders the share URL', async () => {
    render(
      <ShareDialog
        open={true}
        onOpenChange={vi.fn()}
        trip={baseTrip}
        onSyncReady={onSyncReady}
      />,
    );

    await waitFor(() => {
      expect(mockUpdateTrip).toHaveBeenCalledWith(baseTrip.id, {
        p2pRoomId: 'room-id-1234',
        p2pEncryptionKey: 'secret-key-abcdefghijkl',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('share-url')).toHaveTextContent(
        'http://localhost:3000/trip/room-id-1234#secret-key-abcdefghijkl',
      );
    });

    expect(onSyncReady).toHaveBeenCalledWith({
      tripId: baseTrip.id,
      roomId: 'room-id-1234',
      encryptionKey: 'secret-key-abcdefghijkl',
    });
    expect(
      screen.getByText('Anyone with this link can view and edit this trip'),
    ).toBeInTheDocument();
  });

  it('reuses existing credentials without regenerating them', async () => {
    mockGetTrip.mockResolvedValue({
      ...baseTrip,
      p2pRoomId: 'existing-room',
      p2pEncryptionKey: 'existing-secret',
    });

    render(
      <ShareDialog
        open={true}
        onOpenChange={vi.fn()}
        onSyncReady={onSyncReady}
        trip={{
          ...baseTrip,
          p2pRoomId: 'existing-room',
          p2pEncryptionKey: 'existing-secret',
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('share-url')).toHaveTextContent(
        'http://localhost:3000/trip/existing-room#existing-secret',
      );
    });

    expect(mockUpdateTrip).not.toHaveBeenCalled();
    expect(onSyncReady).toHaveBeenCalledWith({
      tripId: baseTrip.id,
      roomId: 'existing-room',
      encryptionKey: 'existing-secret',
    });
  });

  it('renders a copy action for the generated URL', async () => {
    render(
      <ShareDialog
        open={true}
        onOpenChange={vi.fn()}
        trip={{
          ...baseTrip,
          p2pRoomId: 'existing-room',
          p2pEncryptionKey: 'existing-secret',
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('share-url')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: 'Copy link' }),
    ).toBeInTheDocument();
  });
});
