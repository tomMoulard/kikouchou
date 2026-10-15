/**
 * @fileoverview Unit tests for the sharing codec (encode/decode/frames).
 *
 * @module lib/sharing/__tests__/codec.test
 */

import { describe, expect, it } from 'vitest';

import {
  encodeChangeset,
  decodeChangeset,
  splitIntoFrames,
  parseFrame,
  reassembleFrames,
} from '@/lib/sharing/codec';
import type { AppChangeset } from '@/lib/sharing/types';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Test Fixtures
// ============================================================================

function makeMinimalChangeset(): AppChangeset {
  return {
    version: 1,
    tripId: 'trip-123' as TripId,
    shareId: 'share-abc',
    exportedBy: 'person-1' as PersonId,
    exportedAt: 1775649600000, // 2026-04-07T12:00:00Z as Unix ms
    baseSnapshotAt: 1775563200000,
    added: { persons: [], assignments: [], transports: [], rooms: [] },
    modified: { persons: [], assignments: [], transports: [], rooms: [] },
  };
}

function makeFullChangeset(): AppChangeset {
  const person: Person = {
    id: 'person-1' as PersonId,
    tripId: 'trip-123' as TripId,
    name: 'Alice',
    color: '#ff0000' as HexColor,
    stayStartDate: '2026-07-15' as ISODateString,
    stayEndDate: '2026-07-20' as ISODateString,
  };

  const assignment: RoomAssignment = {
    id: 'assign-1' as RoomAssignmentId,
    tripId: 'trip-123' as TripId,
    roomId: 'room-1' as RoomId,
    personId: 'person-1' as PersonId,
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-20' as ISODateString,
  };

  const transport: Transport = {
    id: 'transport-1' as TransportId,
    tripId: 'trip-123' as TripId,
    personId: 'person-1' as PersonId,
    type: 'arrival' as const,
    datetime: '2026-07-15T14:30:00Z',
    location: 'Gare de Vannes',
    transportMode: 'train',
    transportNumber: 'TGV 8541',
    needsPickup: true,
    notes: 'Platform 3',
  };

  return {
    version: 1,
    tripId: 'trip-123' as TripId,
    shareId: 'share-abc',
    exportedBy: 'person-1' as PersonId,
    exportedAt: 1775649600000,
    baseSnapshotAt: 1775563200000,
    added: {
      persons: [person],
      assignments: [assignment],
      transports: [transport],
      rooms: [],
    },
    modified: { persons: [], assignments: [], transports: [], rooms: [] },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('encodeChangeset / decodeChangeset', () => {
  it('roundtrips a minimal changeset', () => {
    const original = makeMinimalChangeset();
    const encoded = encodeChangeset(original);
    const decoded = decodeChangeset(encoded);

    expect(decoded.version).toBe(original.version);
    expect(decoded.tripId).toBe(original.tripId);
    expect(decoded.shareId).toBe(original.shareId);
    expect(decoded.exportedBy).toBe(original.exportedBy);
    expect(decoded.added.persons).toHaveLength(0);
    expect(decoded.modified.persons).toHaveLength(0);
  });

  it('roundtrips a full changeset with person, assignment, and transport', () => {
    const original = makeFullChangeset();
    const encoded = encodeChangeset(original);
    const decoded = decodeChangeset(encoded);

    expect(decoded.tripId).toBe(original.tripId);
    expect(decoded.added.persons).toHaveLength(1);
    expect(decoded.added.assignments).toHaveLength(1);
    expect(decoded.added.transports).toHaveLength(1);

    // Check person fields
    const person = decoded.added.persons[0]!;
    expect(person.id).toBe('person-1');
    expect(person.name).toBe('Alice');
    expect(person.color).toBe('#ff0000');

    // Check assignment fields
    const assignment = decoded.added.assignments[0]!;
    expect(assignment.roomId).toBe('room-1');
    expect(assignment.personId).toBe('person-1');
    expect(assignment.startDate).toBe('2026-07-15');

    // Check transport fields
    const transport = decoded.added.transports[0]!;
    expect(transport.type).toBe('arrival');
    expect(transport.location).toBe('Gare de Vannes');
    expect(transport.transportMode).toBe('train');
    expect(transport.needsPickup).toBe(true);
  });

  it('returns a base64url string (no +, /, or =)', () => {
    const changeset = makeFullChangeset();
    const encoded = encodeChangeset(changeset);

    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('throws on empty payload', () => {
    expect(() => decodeChangeset('')).toThrow('Invalid base64url payload');
  });

  it('throws on non-base64url payload', () => {
    expect(() => decodeChangeset('https://example.com')).toThrow('Invalid base64url payload');
    expect(() => decodeChangeset('not valid! data')).toThrow('Invalid base64url payload');
  });

  it('throws on too-short valid base64url payload (< 2 bytes)', () => {
    // 'AQ' decodes to a single byte [0x01] — passes base64url validation but is too short
    expect(() => decodeChangeset('AQ')).toThrow('Invalid changeset payload: too short');
  });

  it('throws on unsupported version', () => {
    // Version byte 99 is unsupported
    const fakePayload = btoa(String.fromCharCode(99, 0, 0)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => decodeChangeset(fakePayload)).toThrow('Unsupported changeset version');
  });
});

describe('splitIntoFrames / parseFrame / reassembleFrames', () => {
  it('returns a single frame for small payloads', () => {
    const small = 'abcdef';
    const frames = splitIntoFrames(small);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe(small);
  });

  it('splits large payloads into multiple frames', () => {
    // Create a payload larger than MAX_QR_BYTES (2500)
    const large = 'x'.repeat(5000);
    const frames = splitIntoFrames(large);

    expect(frames.length).toBeGreaterThan(1);

    // Each frame should start with "F{index}/{total}:"
    for (const frame of frames) {
      expect(frame).toMatch(/^F\d+\/\d+:/);
    }
  });

  it('reassembles split frames back to the original payload', () => {
    const original = 'x'.repeat(5000);
    const frames = splitIntoFrames(original);

    // Parse each frame
    const frameMap = new Map<number, string>();
    let total = 0;
    for (const frame of frames) {
      const parsed = parseFrame(frame);
      expect(parsed).not.toBeNull();
      frameMap.set(parsed!.index, parsed!.data);
      total = parsed!.total;
    }

    // Reassemble
    const reassembled = reassembleFrames(frameMap, total);
    expect(reassembled).toBe(original);
  });

  it('parseFrame returns null for non-frame strings', () => {
    expect(parseFrame('just-a-normal-string')).toBeNull();
    expect(parseFrame('F/')).toBeNull();
    expect(parseFrame('')).toBeNull();
  });

  it('parseFrame parses a valid frame correctly', () => {
    const parsed = parseFrame('F2/5:somedata');
    expect(parsed).toEqual({ index: 2, total: 5, data: 'somedata' });
  });

  it('reassembleFrames returns null if frames are incomplete', () => {
    const frames = new Map<number, string>();
    frames.set(0, 'aaa');
    frames.set(2, 'ccc');
    // Missing frame 1

    expect(reassembleFrames(frames, 3)).toBeNull();
  });

  it('reassembleFrames returns null if count does not match total', () => {
    const frames = new Map<number, string>();
    frames.set(0, 'aaa');

    expect(reassembleFrames(frames, 3)).toBeNull();
  });

  it('reassembleFrames returns null when size matches total but indices have gaps', () => {
    // Map with 2 entries: keys 0 and 2, totalFrames=2
    // frames.size === 2 === totalFrames passes the size check
    // but frames.get(1) === undefined triggers the missing-frame branch
    const frames = new Map<number, string>();
    frames.set(0, 'aaa');
    frames.set(2, 'ccc');

    expect(reassembleFrames(frames, 2)).toBeNull();
  });
});

describe('encode/decode + frame roundtrip', () => {
  it('full roundtrip: changeset → encode → split → parse → reassemble → decode', () => {
    const original = makeFullChangeset();
    const encoded = encodeChangeset(original);
    const frames = splitIntoFrames(encoded);

    // Simulate scanning
    const frameMap = new Map<number, string>();
    let total = 0;

    for (const frame of frames) {
      const parsed = parseFrame(frame);
      if (parsed) {
        frameMap.set(parsed.index, parsed.data);
        total = parsed.total;
      } else {
        // Single-frame: use raw string
        frameMap.set(0, frame);
        total = 1;
      }
    }

    const reassembled = reassembleFrames(frameMap, total);
    expect(reassembled).toBeTruthy();

    const decoded = decodeChangeset(reassembled!);
    expect(decoded.tripId).toBe(original.tripId);
    expect(decoded.added.persons[0]?.name).toBe('Alice');
    expect(decoded.added.transports[0]?.location).toBe('Gare de Vannes');
  });
});
