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
  sanitizeVehicleData,
  sanitizeRideData,
  sanitizeExpenseData,
  normalizeLeadTimeMinutes,
  normalizeExpenseAmount,
  normalizeExpenseSplitValue,
  normalizeSeatCount,
  normalizeRoomCapacity,
  isCalendarDayString,
  isInstantString,
  sanitizeGuestGroupData,
  normalizeMaxParticipants,
} from '../sanitize';
import {
  MAX_ACTIVITY_PARTICIPANTS,
  MAX_EXPENSE_AMOUNT,
  MAX_EXPENSE_SPLITS,
  MAX_EXPENSE_SPLIT_VALUE,
} from '@/types';

// ============================================================================
// MAX_LENGTHS Constants Tests
// ============================================================================

describe('MAX_LENGTHS constants', () => {
  it('has expected trip field limits', () => {
    expect(MAX_LENGTHS.tripName).toBe(100);
    expect(MAX_LENGTHS.tripLocation).toBe(200);
    // Matches the textarea's own `maxLength`, so bounding the field on save
    // cannot silently shorten a description the form already accepted.
    expect(MAX_LENGTHS.tripDescription).toBe(1000);
  });

  it('has expected room field limits', () => {
    expect(MAX_LENGTHS.roomName).toBe(100);
    expect(MAX_LENGTHS.roomDescription).toBe(500);
  });

  it('has expected person field limits', () => {
    expect(MAX_LENGTHS.personName).toBe(100);
    expect(MAX_LENGTHS.personPhone).toBe(32);
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
      'tripDescription',
      'roomName',
      'roomDescription',
      'personName',
      'personNotes',
      'personPhone',
      'transportLocation',
      'transportNumber',
      'transportNotes',
      'activityTitle',
      'activityLocation',
      'activityNotes',
      'expenseTitle',
      'expenseDescription',
      'guestGroupName',
      'vehicleName',
      'vehicleLuggageNotes',
      'vehicleNotes',
      'rideLocation',
      'rideNotes',
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

  it('sanitizes description field', () => {
    const result = sanitizeTripData({
      name: 'Trip',
      description: '  Bring hiking boots  ',
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.description).toBe('Bring hiking boots');
  });

  /**
   * The only thing bounding this used to be `maxLength={1000}` on the textarea.
   * That clips typing and pasting alike, but it binds one textarea rather than
   * the field: the assistant's trip actions, a changeset/QR import and the CRDT
   * bridge all write a description without going near the form. The field
   * travels through the shared document, so an unbounded one is a payload every
   * peer downloads, not just a long string on one device.
   */
  it('truncates a description no form could have submitted', () => {
    const pasted = 'A'.repeat(10_000);
    const result = sanitizeTripData({
      name: 'Trip',
      description: pasted,
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.description).toBe('A'.repeat(MAX_LENGTHS.tripDescription));
  });

  it('converts empty description to undefined', () => {
    const result = sanitizeTripData({
      name: 'Trip',
      description: '   ',
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.description).toBeUndefined();
  });

  it('preserves undefined description', () => {
    const result = sanitizeTripData({
      name: 'Trip',
      description: undefined,
      startDate: '2024-07-01',
      endDate: '2024-07-15',
    });
    expect(result.description).toBeUndefined();
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

  it('trims an optional phone and drops a blank one', () => {
    expect(
      sanitizePersonData({ name: 'Marie', color: '#ef4444', phone: '  +33 6 12 34 56 78 ' })
        .phone,
    ).toBe('+33 6 12 34 56 78');
    expect(
      sanitizePersonData({ name: 'Marie', color: '#ef4444', phone: '   ' }).phone,
    ).toBeUndefined();
  });

  it('truncates a long phone', () => {
    const result = sanitizePersonData({
      name: 'Marie',
      color: '#ef4444',
      phone: '0'.repeat(50),
    });
    expect(result.phone).toBe('0'.repeat(32));
  });

  it('leaves the phone formatting alone', () => {
    // Numbers arrive in a dozen national conventions; rewriting one is how a
    // working number stops working.
    const result = sanitizePersonData({
      name: 'Marie',
      color: '#ef4444',
      phone: '+33 (0)6 12-34-56-78',
    });
    expect(result.phone).toBe('+33 (0)6 12-34-56-78');
  });

  it('trims and truncates optional notes', () => {
    const result = sanitizePersonData({
      name: 'Marie',
      color: '#ef4444',
      notes: `  ${'n'.repeat(2500)}  `,
    });
    expect(result.notes).toBe('n'.repeat(2000));
  });

  it('drops empty notes', () => {
    const result = sanitizePersonData({
      name: 'Marie',
      color: '#ef4444',
      notes: '   ',
    });
    expect(result.notes).toBeUndefined();
  });

  it('keeps a known child seat kind', () => {
    expect(
      sanitizePersonData({ name: 'Lila', color: '#ef4444', childSeat: 'booster' }).childSeat,
    ).toBe('booster');
  });

  it('drops a child seat kind it does not know', () => {
    // A guest also arrives from a QR changeset, from a peer's document and from
    // the assistant's own JSON, none of which has ever seen a `<select>`.
    expect(
      sanitizePersonData({ name: 'Lila', color: '#ef4444', childSeat: 'hammock' }).childSeat,
    ).toBeUndefined();
  });

  it('leaves an adult with no child seat', () => {
    expect(
      sanitizePersonData({ name: 'Tom', color: '#ef4444', childSeat: undefined }).childSeat,
    ).toBeUndefined();
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

// ============================================================================
// Car, ride and money sanitisers at their edges
// ============================================================================

describe('sanitizers given a record with its text missing', () => {
  it('reads a missing car name as empty', () => {
    expect(sanitizeVehicleData({ name: undefined as never }).name).toBe('');
  });

  it('reads a missing meeting point as empty', () => {
    expect(sanitizeRideData({ location: undefined as never }).location).toBe('');
  });
});

describe('normalizeLeadTimeMinutes', () => {
  it('clamps a negative lead time to leaving now', () => {
    expect(normalizeLeadTimeMinutes(-5)).toBe(0);
  });
});

describe('sanitizeExpenseData shares', () => {
  it('drops a share with no guest and reads a negative share as nothing', () => {
    const { splits } = sanitizeExpenseData({
      title: 'Lunch',
      amount: 12,
      splits: [
        { personId: '', value: 1 },
        { personId: 'p1', value: -3 },
      ],
    });

    expect(splits).toEqual([{ personId: 'p1', value: 0 }]);
  });
});

// ============================================================================
// Normalisers at every edge
// ============================================================================

describe('sanitizePersonData headcount', () => {
  it('leaves a headcount the guest never gave absent', () => {
    expect(sanitizePersonData<{ name: string; headcount?: number }>({ name: 'Alice' }).headcount).toBeUndefined();
  });
});

describe('sanitizeGuestGroupData', () => {
  it('trims the group name and each member', () => {
    expect(
      sanitizeGuestGroupData({ name: '  Family  ', members: [{ name: '  Alice  ' }] }),
    ).toEqual({ name: 'Family', members: [expect.objectContaining({ name: 'Alice' })] });
  });
});

describe('normalizeExpenseAmount', () => {
  it.each([
    ['missing', undefined],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['negative', -5],
  ])('reads a %s amount as zero', (_label, value) => {
    expect(normalizeExpenseAmount(value)).toBe(0);
  });

  it('keeps an amount inside the bounds and clamps one past them', () => {
    expect(normalizeExpenseAmount(12.5)).toBe(12.5);
    expect(normalizeExpenseAmount(MAX_EXPENSE_AMOUNT * 2)).toBe(MAX_EXPENSE_AMOUNT);
  });
});

describe('normalizeExpenseSplitValue', () => {
  it.each([
    ['missing', undefined],
    ['not a number', Number.NaN],
    ['negative', -1],
  ])('reads a %s share as zero', (_label, value) => {
    expect(normalizeExpenseSplitValue(value)).toBe(0);
  });

  it('keeps a share inside the bounds and clamps one past them', () => {
    expect(normalizeExpenseSplitValue(3)).toBe(3);
    expect(normalizeExpenseSplitValue(MAX_EXPENSE_SPLIT_VALUE * 2)).toBe(MAX_EXPENSE_SPLIT_VALUE);
  });
});

describe('sanitizeExpenseData splits, entry by entry', () => {
  it('drops an empty slot, a blank guest and a guest id that is not a string', () => {
    const { splits } = sanitizeExpenseData({
      title: 'Lunch',
      amount: 12,
      splits: [
        null as never,
        { personId: '', value: 1 },
        { personId: 7 as never, value: 1 },
        { personId: 'p1', value: 2 },
      ],
    });

    expect(splits).toEqual([{ personId: 'p1', value: 2 }]);
  });

  it('keeps one share per guest, the last one written', () => {
    const { splits } = sanitizeExpenseData({
      title: 'Lunch',
      amount: 12,
      splits: [
        { personId: 'p1', value: 1 },
        { personId: 'p1', value: 4 },
      ],
    });

    expect(splits).toEqual([{ personId: 'p1', value: 4 }]);
  });

  it('keeps at most the share limit', () => {
    const { splits } = sanitizeExpenseData({
      title: 'Lunch',
      amount: 12,
      splits: Array.from({ length: MAX_EXPENSE_SPLITS + 1 }, (_, index) => ({
        personId: `p${index}`,
        value: 1,
      })),
    });

    expect(splits).toHaveLength(MAX_EXPENSE_SPLITS);
  });
});

describe('normalizeSeatCount', () => {
  it.each([
    ['missing', undefined],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['zero', 0],
  ])('reads a %s seat count as not measured', (_label, value) => {
    expect(normalizeSeatCount(value)).toBeUndefined();
  });

  it('keeps one seat, rounds, and clamps past the largest car', () => {
    expect(normalizeSeatCount(1)).toBe(1);
    expect(normalizeSeatCount(4.6)).toBe(5);
    expect(normalizeSeatCount(1_000)).toBe(99);
  });
});

describe('normalizeRoomCapacity', () => {
  it.each([
    ['a string', '3'],
    ['not a number', Number.NaN],
    ['zero', 0],
  ])('reads a capacity that is %s as one bed', (_label, value) => {
    expect(normalizeRoomCapacity(value)).toBe(1);
  });

  it('rounds and clamps a number of beds', () => {
    expect(normalizeRoomCapacity(2.4)).toBe(2);
    expect(normalizeRoomCapacity(1e9)).toBe(50);
  });
});

describe('isCalendarDayString', () => {
  it.each(['2026-01-01', '2026-12-31', '2026-01-31'])('accepts %s', (value) => {
    expect(isCalendarDayString(value)).toBe(true);
  });

  it.each([
    ['a number', 20_260_801],
    ['a month past December', '2026-13-01'],
    ['month zero', '2026-00-10'],
    ['day zero', '2026-01-00'],
    ['a day past 31', '2026-01-32'],
    ['text before the day', 'aaaa-01-01 2026-08-01'],
    ['a time after the day', '2026-08-01T10:00'],
  ])('refuses %s', (_label, value) => {
    expect(isCalendarDayString(value)).toBe(false);
  });
});

describe('isInstantString', () => {
  it('accepts an instant with an offset', () => {
    expect(isInstantString('2026-08-02T09:00:00+02:00')).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['text', 'tomorrow'],
    ['a list holding an instant', ['2026-08-02T09:00:00.000Z']],
    ['a number', 1_754_000_000_000],
  ])('refuses %s', (_label, value) => {
    expect(isInstantString(value)).toBe(false);
  });
});

describe('normalizeLeadTimeMinutes, the rest of it', () => {
  it.each([
    ['missing', undefined],
    ['not a number', Number.NaN],
  ])('leaves a %s lead time unset', (_label, value) => {
    expect(normalizeLeadTimeMinutes(value)).toBeUndefined();
  });

  it('keeps zero, rounds, and clamps a day-long wait', () => {
    expect(normalizeLeadTimeMinutes(0)).toBe(0);
    expect(normalizeLeadTimeMinutes(29.6)).toBe(30);
    expect(normalizeLeadTimeMinutes(10_000)).toBe(24 * 60);
  });
});

describe('normalizeMaxParticipants', () => {
  it.each([
    ['missing', undefined],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['below one', 0.4],
  ])('reads a %s cap as unlimited', (_label, value) => {
    expect(normalizeMaxParticipants(value)).toBeUndefined();
  });

  it('rounds a cap and clamps one past the largest group', () => {
    expect(normalizeMaxParticipants(3.6)).toBe(4);
    expect(normalizeMaxParticipants(1e9)).toBe(MAX_ACTIVITY_PARTICIPANTS);
  });
});
