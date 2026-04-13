/**
 * @fileoverview Tests for ensureTripP2pCredentials.
 * @module lib/yjs/__tests__/ensure-trip-p2p-credentials.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/db/database', () => ({
  db: {
    trips: {
      get: (...args: unknown[]) => mockGet(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

vi.mock('nanoid', () => ({
  nanoid: vi
    .fn()
    .mockImplementationOnce(() => 'room-id-fixed12')
    .mockImplementationOnce(() => 'encryption-key-24chars-long12'),
}));

describe('ensureTripP2pCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
  });

  it('returns null when trip is missing', async () => {
    mockGet.mockResolvedValue(undefined);
    const { ensureTripP2pCredentials } = await import('../ensure-trip-p2p-credentials');
    expect(await ensureTripP2pCredentials('t1' as import('@/types').TripId)).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns existing credentials without updating', async () => {
    mockGet.mockResolvedValue({
      id: 't1',
      p2pRoomId: 'r1',
      p2pEncryptionKey: 'k1',
    });
    const { ensureTripP2pCredentials } = await import('../ensure-trip-p2p-credentials');
    const result = await ensureTripP2pCredentials('t1' as import('@/types').TripId);
    expect(result).toEqual({ roomId: 'r1', encryptionKey: 'k1' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('generates and persists when missing', async () => {
    mockGet.mockResolvedValue({ id: 't1' });
    const { ensureTripP2pCredentials } = await import('../ensure-trip-p2p-credentials');
    const result = await ensureTripP2pCredentials('t1' as import('@/types').TripId);
    expect(result?.roomId).toBe('room-id-fixed12');
    expect(mockUpdate).toHaveBeenCalledWith('t1', {
      p2pRoomId: 'room-id-fixed12',
      p2pEncryptionKey: 'encryption-key-24chars-long12',
    });
  });
});
