/**
 * @fileoverview Tests for share QR / link parsing.
 *
 * @module features/sharing/utils/__tests__/share-qr-parse
 */

import { describe, expect, it, vi } from 'vitest';

import {
  extractP2pTripInviteFromScannedPayload,
  extractShareIdFromScannedPayload,
} from '../share-qr-parse';

describe('extractP2pTripInviteFromScannedPayload', () => {
  it('extracts room id and key from full https URL', () => {
    expect(
      extractP2pTripInviteFromScannedPayload(
        'https://localhost:5173/trip/myRoomId#myEncryptionKey',
      ),
    ).toEqual({ roomId: 'myRoomId', encryptionKey: 'myEncryptionKey' });
  });

  it('returns null without hash', () => {
    expect(
      extractP2pTripInviteFromScannedPayload('https://example.com/trip/only-room'),
    ).toBeNull();
  });

  it('returns null for /share/ guest URLs', () => {
    expect(
      extractP2pTripInviteFromScannedPayload('https://example.com/share/abc123defgh'),
    ).toBeNull();
  });
});

describe('extractShareIdFromScannedPayload', () => {
  it('extracts share id from full https URL with /share/:id path', () => {
    expect(
      extractShareIdFromScannedPayload('https://example.com/share/abc123def'),
    ).toBe('abc123def');
  });

  it('extracts from path without scheme (relative to origin)', () => {
    expect(extractShareIdFromScannedPayload('share/rel-code')).toBe('rel-code');
  });

  it('extracts from absolute path string', () => {
    expect(extractShareIdFromScannedPayload('/share/my-code_99')).toBe('my-code_99');
  });

  it('extracts bare 10-char share code (nanoid)', () => {
    expect(extractShareIdFromScannedPayload('aB3dEf9hJk')).toBe('aB3dEf9hJk');
  });

  it('returns null for empty or invalid strings', () => {
    expect(extractShareIdFromScannedPayload('')).toBeNull();
    expect(extractShareIdFromScannedPayload('   ')).toBeNull();
    expect(extractShareIdFromScannedPayload('not-a-share-url')).toBeNull();
    expect(extractShareIdFromScannedPayload('ab')).toBeNull();
  });

  it('extracts share id from URL with BASE_URL subpath prefix', async () => {
    // Mock import.meta.env.BASE_URL to simulate a deployed subpath
    const original = import.meta.env.BASE_URL;
    vi.stubEnv('BASE_URL', '/app/');

    // Re-import the module to pick up the new BASE_URL
    const { extractShareIdFromScannedPayload: extract } = await import(
      '../share-qr-parse?bust=' + Date.now()
    );

    const result = extract('https://example.com/app/share/abc123def');
    // The function should strip the /app prefix and extract the share id
    expect(result).toBe('abc123def');

    // Restore
    vi.stubEnv('BASE_URL', original);
  });

  it('extracts from URL-encoded share path', () => {
    expect(
      extractShareIdFromScannedPayload('https://example.com/share/abc%20def'),
    ).toBe('abc def');
  });

  it('extracts from URL with trailing slash', () => {
    expect(
      extractShareIdFromScannedPayload('https://example.com/share/my-code/'),
    ).toBe('my-code');
  });
});
