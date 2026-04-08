/**
 * @fileoverview Tests for share QR / link parsing.
 *
 * @module features/sharing/utils/__tests__/share-qr-parse
 */

import { describe, expect, it } from 'vitest';

import { extractShareIdFromScannedPayload } from '../share-qr-parse';

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
});
