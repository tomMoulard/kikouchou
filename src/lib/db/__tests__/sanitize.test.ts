/**
 * Tests for Input Sanitization Utilities
 *
 * @module lib/db/__tests__/sanitize.test
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_LENGTHS,
  sanitizeOptionalText,
  sanitizePersonData,
  sanitizeRoomData,
  sanitizeText,
  sanitizeTransportData,
  sanitizeTripData,
} from '../sanitize';

// ============================================================================
// MAX_LENGTHS Constants Tests
// ============================================================================

describe('MAX_LENGTHS constants', () => {
  it('has expected trip field limits', () => {
    expect(MAX_LENGTHS.tripName).toBe(100);
    expect(MAX_LENGTHS.tripLocation).toBe(200);
  });

  it('has expected room field limits', () => {
    expect(MAX_LENGTHS.roomName).toBe(100);
    expect(MAX_LENGTHS.roomDescription).toBe(500);
  });

  it('has expected person field limits', () => {
    expect(MAX_LENGTHS.personName).toBe(100);
  });

  it('has expected transport field limits', () => {
    expect(MAX_LENGTHS.transportLocation).toBe(200);
    expect(MAX_LENGTHS.transportNumber).toBe(50);
    expect(MAX_LENGTHS.transportNotes).toBe(1000);
  });

  it('has all expected keys', () => {
    const expectedKeys = [
      'tripName',
      'tripLocation',
      'roomName',
      'roomDescription',
      'personName',
      'transportLocation',
      'transportNumber',
      'transportNotes',
    ];
    expect(Object.keys(MAX_LENGTHS).sort()).toEqual(expectedKeys.sort());
  });
});

// ============================================================================
// sanitizeText Tests
// ============================================================================

describe('sanitizeText', () => {
  describe('whitespace trimming', () => {
    it('trims leading whitespace', () => {
      expect(sanitizeText('  hello', 100)).toBe('hello');
    });

    it('trims trailing whitespace', () => {
      expect(sanitizeText('hello  ', 100)).toBe('hello');
    });

    it('trims both leading and trailing whitespace', () => {
      expect(sanitizeText('  hello world  ', 100)).toBe('hello world');
    });

    it('preserves internal whitespace', () => {
      expect(sanitizeText('hello   world', 100)).toBe('hello   world');
    });

    it('handles tabs and newlines', () => {
      expect(sanitizeText('\t\nhello\t\n', 100)).toBe('hello');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(sanitizeText('   ', 100)).toBe('');
    });

    it('handles empty string', () => {
      expect(sanitizeText('', 100)).toBe('');
    });
  });

  describe('length limiting', () => {
    it('does not truncate string within limit', () => {
      expect(sanitizeText('hello', 10)).toBe('hello');
    });

    it('does not truncate string at exactly limit', () => {
      expect(sanitizeText('hello', 5)).toBe('hello');
    });

    it('truncates string exceeding limit', () => {
      expect(sanitizeText('hello world', 5)).toBe('hello');
    });

    it('truncates after trimming', () => {
      expect(sanitizeText('  hello world  ', 5)).toBe('hello');
    });

    it('handles zero max length', () => {
      expect(sanitizeText('hello', 0)).toBe('');
    });

    it('handles very long string', () => {
      const longString = 'a'.repeat(1000);
      expect(sanitizeText(longString, 100)).toBe('a'.repeat(100));
    });
  });

  describe('Unicode handling', () => {
    it('handles Unicode characters', () => {
      expect(sanitizeText('  héllo wörld  ', 100)).toBe('héllo wörld');
    });

    it('handles emojis', () => {
      expect(sanitizeText('  hello 👋  ', 100)).toBe('hello 👋');
    });

    it('truncates Unicode correctly (character count, not bytes)', () => {
      // JavaScript substring works on UTF-16 code units
      expect(sanitizeText('héllo', 3)).toBe('hél');
    });

    it('handles CJK characters', () => {
      expect(sanitizeText('  你好世界  ', 100)).toBe('你好世界');
    });
  });
});

// ============================================================================
// sanitizeOptionalText Tests
// ============================================================================

describe('sanitizeOptionalText', () => {
  describe('undefined handling', () => {
    it('returns undefined for undefined input', () => {
      expect(sanitizeOptionalText(undefined, 100)).toBeUndefined();
    });
  });

  describe('empty string handling', () => {
    it('returns undefined for empty string', () => {
      expect(sanitizeOptionalText('', 100)).toBeUndefined();
    });

    it('returns undefined for whitespace-only string', () => {
      expect(sanitizeOptionalText('   ', 100)).toBeUndefined();
    });

    it('returns undefined for tabs and newlines only', () => {
      expect(sanitizeOptionalText('\t\n  \t', 100)).toBeUndefined();
    });
  });

  describe('non-empty string handling', () => {
    it('trims and returns non-empty string', () => {
      expect(sanitizeOptionalText('  hello  ', 100)).toBe('hello');
    });

    it('truncates and returns long string', () => {
      expect(sanitizeOptionalText('  hello world  ', 5)).toBe('hello');
    });

    it('returns single character', () => {
      expect(sanitizeOptionalText(' a ', 100)).toBe('a');
    });
  });

  describe('edge cases', () => {
    it('handles string that becomes empty after trimming', () => {
      expect(sanitizeOptionalText('   ', 100)).toBeUndefined();
    });

    it('handles zero max length (returns empty string after truncation)', () => {
      // When truncated to 0 characters, the result is empty string
      // Note: This is the current behavior - truncation happens after
      // the empty check, so non-empty input truncated to 0 returns ''
      expect(sanitizeOptionalText('hello', 0)).toBe('');
    });
  });
});

// ============================================================================
// sanitizeTripData Tests
// ============================================================================

describe('sanitizeTripData', () => {
  it('sanitizes name field', () => {
    const result = sanitizeTripData({
      name: '  Summer Vacation  ',
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.name).toBe('Summer Vacation');
  });

  it('truncates long name', () => {
    const longName = 'A'.repeat(150);
    const result = sanitizeTripData({
      name: longName,
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.name).toBe('A'.repeat(100));
  });

  it('sanitizes location field', () => {
    const result = sanitizeTripData({
      name: 'Trip',
      location: '  Beach House, Brittany  ',
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.location).toBe('Beach House, Brittany');
  });

  it('truncates long location', () => {
    const longLocation = 'A'.repeat(250);
    const result = sanitizeTripData({
      name: 'Trip',
      location: longLocation,
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.location).toBe('A'.repeat(200));
  });

  it('converts empty location to undefined', () => {
    const result = sanitizeTripData({
      name: 'Trip',
      location: '   ',
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.location).toBeUndefined();
  });

  it('preserves undefined location', () => {
    const result = sanitizeTripData({
      name: 'Trip',
      location: undefined,
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.location).toBeUndefined();
  });

  it('preserves other fields unchanged', () => {
    const input = {
      name: 'Trip',
      location: 'Place',
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    };
    const result = sanitizeTripData(input);
    expect(result.startDate).toBe('2024-07-01');
    expect(result.endDate).toBe('2024-07-15');
  });

  it('works with generic type extending required fields', () => {
    interface ExtendedTrip {
      name: string;
      location?: string;
      extraField: number;
    }
    const input: ExtendedTrip = {
      name: '  Trip  ',
      location: '  Place  ',
      extraField: 42,
    };
    const result = sanitizeTripData(input);
    expect(result.name).toBe('Trip');
    expect(result.location).toBe('Place');
    expect(result.extraField).toBe(42);
  });
});

// ============================================================================
// sanitizeRoomData Tests
// ============================================================================

describe('sanitizeRoomData', () => {
  it('sanitizes name field', () => {
    const result = sanitizeRoomData({
      name: '  Master Bedroom  ',
      capacity: 2,
    });
    expect(result.name).toBe('Master Bedroom');
  });

  it('truncates long name', () => {
    const longName = 'A'.repeat(150);
    const result = sanitizeRoomData({
      name: longName,
      capacity: 2,
    });
    expect(result.name).toBe('A'.repeat(100));
  });

  it('sanitizes description field', () => {
    const result = sanitizeRoomData({
      name: 'Room',
      capacity: 2,
      description: '  King bed with ensuite bathroom  ',
    });
    expect(result.description).toBe('King bed with ensuite bathroom');
  });

  it('truncates long description', () => {
    const longDesc = 'A'.repeat(600);
    const result = sanitizeRoomData({
      name: 'Room',
      capacity: 2,
      description: longDesc,
    });
    expect(result.description).toBe('A'.repeat(500));
  });

  it('converts empty description to undefined', () => {
    const result = sanitizeRoomData({
      name: 'Room',
      capacity: 2,
      description: '   ',
    });
    expect(result.description).toBeUndefined();
  });

  it('preserves undefined description', () => {
    const result = sanitizeRoomData({
      name: 'Room',
      capacity: 2,
      description: undefined,
    });
    expect(result.description).toBeUndefined();
  });

  it('preserves other fields unchanged', () => {
    const result = sanitizeRoomData({
      name: 'Room',
      capacity: 4,
      description: 'Desc',
    });
    expect(result.capacity).toBe(4);
  });
});

// ============================================================================
// sanitizePersonData Tests
// ============================================================================

describe('sanitizePersonData', () => {
  it('sanitizes name field', () => {
    const result = sanitizePersonData({
      name: '  Marie Dupont  ',
      color: '#ef4444',
    });
    expect(result.name).toBe('Marie Dupont');
  });

  it('truncates long name', () => {
    const longName = 'A'.repeat(150);
    const result = sanitizePersonData({
      name: longName,
      color: '#ef4444',
    });
    expect(result.name).toBe('A'.repeat(100));
  });

  it('preserves other fields unchanged', () => {
    const result = sanitizePersonData({
      name: 'Marie',
      color: '#ef4444',
    });
    expect(result.color).toBe('#ef4444');
  });

  it('handles Unicode names', () => {
    const result = sanitizePersonData({
      name: '  François  ',
      color: '#ef4444',
    });
    expect(result.name).toBe('François');
  });
});

// ============================================================================
// sanitizeTransportData Tests
// ============================================================================

describe('sanitizeTransportData', () => {
  it('sanitizes location field', () => {
    const result = sanitizeTransportData({
      location: '  Gare Montparnasse  ',
      type: 'arrival',
      personId: 'p1',
      datetime: '2024-07-01T10:00:00Z',
      needsPickup: true,
    });
    expect(result.location).toBe('Gare Montparnasse');
  });

  it('truncates long location', () => {
    const longLocation = 'A'.repeat(250);
    const result = sanitizeTransportData({
      location: longLocation,
      type: 'arrival',
      personId: 'p1',
      datetime: '2024-07-01T10:00:00Z',
      needsPickup: false,
    });
    expect(result.location).toBe('A'.repeat(200));
  });

  it('sanitizes transportNumber field', () => {
    const result = sanitizeTransportData({
      location: 'Station',
      transportNumber: '  TGV 8541  ',
      type: 'arrival',
      personId: 'p1',
      datetime: '2024-07-01T10:00:00Z',
      needsPickup: true,
    });
    expect(result.transportNumber).toBe('TGV 8541');
  });

  it('truncates long transportNumber', () => {
    const longNumber = 'A'.repeat(60);
    const result = sanitizeTransportData({
      location: 'Station',
      transportNumber: longNumber,
      type: 'arrival',
      personId: 'p1',
      datetime: '2024-07-01T10:00:00Z',
      needsPickup: true,
    });
    expect(result.transportNumber).toBe('A'.repeat(50));
  });

  it('converts empty transportNumber to undefined', () => {
    const result = sanitizeTransportData({
      location: 'Station',
      transportNumber: '   ',
      type: 'arrival',
      personId: 'p1',
      datetime: '2024-07-01T10:00:00Z',
      needsPickup: false,
    });
    expect(result.transportNumber).toBeUndefined();
  });

  it('sanitizes notes field', () => {
    const result = sanitizeTransportData({
      location: 'Station',
      notes: '  Please bring ID  ',
      type: 'arrival',
      personId: 'p1',
      datetime: '2024-07-01T10:00:00Z',
      needsPickup: true,
    });
    expect(result.notes).toBe('Please bring ID');
  });

  it('truncates long notes', () => {
    const longNotes = 'A'.repeat(1100);
    const result = sanitizeTransportData({
      location: 'Station',
      notes: longNotes,
      type: 'arrival',
      personId: 'p1',
      datetime: '2024-07-01T10:00:00Z',
      needsPickup: true,
    });
    expect(result.notes).toBe('A'.repeat(1000));
  });

  it('converts empty notes to undefined', () => {
    const result = sanitizeTransportData({
      location: 'Station',
      notes: '   ',
      type: 'arrival',
      personId: 'p1',
      datetime: '2024-07-01T10:00:00Z',
      needsPickup: false,
    });
    expect(result.notes).toBeUndefined();
  });

  it('preserves other fields unchanged', () => {
    const result = sanitizeTransportData({
      location: 'Station',
      type: 'departure',
      personId: 'p1',
      datetime: '2024-07-01T10:00:00Z',
      needsPickup: true,
      transportMode: 'train',
      driverId: 'd1',
    });
    expect(result.type).toBe('departure');
    expect(result.personId).toBe('p1');
    expect(result.datetime).toBe('2024-07-01T10:00:00Z');
    expect(result.needsPickup).toBe(true);
    expect(result.transportMode).toBe('train');
    expect(result.driverId).toBe('d1');
  });
});

// ============================================================================
// Integration / Edge Case Tests
// ============================================================================

describe('sanitization integration', () => {
  it('handles maximum length boundary exactly', () => {
    const exactLength = 'A'.repeat(100);
    expect(sanitizeText(exactLength, 100)).toBe(exactLength);
    expect(sanitizeText(exactLength + 'B', 100)).toBe(exactLength);
  });

  it('handles strings with only special characters', () => {
    expect(sanitizeText('!@#$%^&*()', 100)).toBe('!@#$%^&*()');
  });

  it('handles mixed whitespace and content', () => {
    expect(sanitizeText('\t  hello  \n  world  \t', 100)).toBe(
      'hello  \n  world',
    );
  });

  it('does not modify original object (immutability)', () => {
    const original = {
      name: '  Test  ',
      location: '  Place  ',
    };
    const frozen = Object.freeze({ ...original });
    const result = sanitizeTripData(frozen);

    expect(result.name).toBe('Test');
    expect(frozen.name).toBe('  Test  ');
  });

  it('returns new object, not mutated input', () => {
    const input = { name: '  Test  ', capacity: 2 };
    const result = sanitizeRoomData(input);

    expect(result).not.toBe(input);
    expect(input.name).toBe('  Test  ');
    expect(result.name).toBe('Test');
  });
});
