/**
 * Tests for Zod validation schemas.
 *
 * @module lib/validation/__tests__/schemas.test
 */

import { describe, expect, it } from 'vitest';
import {
  TripFormDataSchema,
  RoomFormDataSchema,
  PersonFormDataSchema,
  RoomAssignmentFormDataSchema,
  TransportFormDataSchema,
  isoDateStringSchema,
  isoDateTimeStringSchema,
  hexColorSchema,
  roomIconSchema,
  transportTypeSchema,
  transportModeSchema,
} from '../schemas';
import {
  validateTripForm,
  validateRoomForm,
  validatePersonForm,
  validateRoomAssignmentForm,
  validateTransportForm,
  validateTripFormOrThrow,
  isValidationError,
  isValidationSuccess,
  getFieldError,
  errorsToMap,
  FormValidationError,
} from '../index';
import type { PersonId, RoomId } from '@/types';

// ============================================================================
// Primitive Schema Tests
// ============================================================================

describe('Primitive Schemas', () => {
  describe('isoDateStringSchema', () => {
    it('accepts valid ISO date strings', () => {
      expect(isoDateStringSchema.safeParse('2024-07-15').success).toBe(true);
      expect(isoDateStringSchema.safeParse('2024-01-01').success).toBe(true);
      expect(isoDateStringSchema.safeParse('2024-12-31').success).toBe(true);
      expect(isoDateStringSchema.safeParse('2000-02-29').success).toBe(true); // Leap year
    });

    it('rejects invalid date formats', () => {
      expect(isoDateStringSchema.safeParse('2024/07/15').success).toBe(false);
      expect(isoDateStringSchema.safeParse('07-15-2024').success).toBe(false);
      expect(isoDateStringSchema.safeParse('2024-7-15').success).toBe(false);
      expect(isoDateStringSchema.safeParse('2024-07-5').success).toBe(false);
      expect(isoDateStringSchema.safeParse('invalid').success).toBe(false);
      expect(isoDateStringSchema.safeParse('').success).toBe(false);
    });

    it('rejects invalid dates (e.g., Feb 30)', () => {
      expect(isoDateStringSchema.safeParse('2024-02-30').success).toBe(false);
      expect(isoDateStringSchema.safeParse('2024-04-31').success).toBe(false);
      expect(isoDateStringSchema.safeParse('2024-13-01').success).toBe(false);
      expect(isoDateStringSchema.safeParse('2023-02-29').success).toBe(false); // Not a leap year
    });
  });

  describe('isoDateTimeStringSchema', () => {
    it('accepts valid ISO datetime strings', () => {
      expect(
        isoDateTimeStringSchema.safeParse('2024-07-15T14:30:00.000Z').success,
      ).toBe(true);
      expect(
        isoDateTimeStringSchema.safeParse('2024-07-15T14:30:00Z').success,
      ).toBe(true);
      expect(
        isoDateTimeStringSchema.safeParse('2024-07-15T00:00:00+02:00').success,
      ).toBe(true);
    });

    it('rejects invalid datetime formats', () => {
      expect(isoDateTimeStringSchema.safeParse('2024-07-15').success).toBe(
        false,
      );
      expect(isoDateTimeStringSchema.safeParse('2024-07-15 14:30:00').success).toBe(
        false,
      );
      expect(isoDateTimeStringSchema.safeParse('invalid').success).toBe(false);
    });
  });

  describe('hexColorSchema', () => {
    it('accepts valid hex colors', () => {
      expect(hexColorSchema.safeParse('#ef4444').success).toBe(true);
      expect(hexColorSchema.safeParse('#FFFFFF').success).toBe(true);
      expect(hexColorSchema.safeParse('#000000').success).toBe(true);
      expect(hexColorSchema.safeParse('#abcdef').success).toBe(true);
    });

    it('rejects invalid hex colors', () => {
      expect(hexColorSchema.safeParse('ef4444').success).toBe(false); // Missing #
      expect(hexColorSchema.safeParse('#fff').success).toBe(false); // Too short
      expect(hexColorSchema.safeParse('#gggggg').success).toBe(false); // Invalid chars
      expect(hexColorSchema.safeParse('#ef444').success).toBe(false); // 5 chars
      expect(hexColorSchema.safeParse('#ef44444').success).toBe(false); // 7 chars
    });
  });

  describe('roomIconSchema', () => {
    it('accepts valid room icons', () => {
      expect(roomIconSchema.safeParse('bed-double').success).toBe(true);
      expect(roomIconSchema.safeParse('bed-single').success).toBe(true);
      expect(roomIconSchema.safeParse('tent').success).toBe(true);
    });

    it('rejects invalid room icons', () => {
      expect(roomIconSchema.safeParse('invalid-icon').success).toBe(false);
      expect(roomIconSchema.safeParse('').success).toBe(false);
    });
  });

  describe('transportTypeSchema', () => {
    it('accepts valid transport types', () => {
      expect(transportTypeSchema.safeParse('arrival').success).toBe(true);
      expect(transportTypeSchema.safeParse('departure').success).toBe(true);
    });

    it('rejects invalid transport types', () => {
      expect(transportTypeSchema.safeParse('invalid').success).toBe(false);
      expect(transportTypeSchema.safeParse('').success).toBe(false);
    });
  });

  describe('transportModeSchema', () => {
    it('accepts valid transport modes', () => {
      expect(transportModeSchema.safeParse('train').success).toBe(true);
      expect(transportModeSchema.safeParse('plane').success).toBe(true);
      expect(transportModeSchema.safeParse('car').success).toBe(true);
      expect(transportModeSchema.safeParse('bus').success).toBe(true);
      expect(transportModeSchema.safeParse('other').success).toBe(true);
    });

    it('rejects invalid transport modes', () => {
      expect(transportModeSchema.safeParse('bike').success).toBe(false);
      expect(transportModeSchema.safeParse('').success).toBe(false);
    });
  });
});

// ============================================================================
// TripFormData Schema Tests
// ============================================================================

describe('TripFormDataSchema', () => {
  const validTrip = {
    name: 'Summer vacation 2024',
    location: 'Beach house, Brittany',
    startDate: '2024-07-15',
    endDate: '2024-07-22',
    description: 'A relaxing vacation',
  };

  it('accepts valid trip data', () => {
    const result = TripFormDataSchema.safeParse(validTrip);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Summer vacation 2024');
      expect(result.data.startDate).toBe('2024-07-15');
    }
  });

  it('accepts trip with minimal required fields', () => {
    const result = TripFormDataSchema.safeParse({
      name: 'Trip',
      startDate: '2024-07-15',
      endDate: '2024-07-15',
    });
    expect(result.success).toBe(true);
  });

  it('accepts trip with coordinates', () => {
    const result = TripFormDataSchema.safeParse({
      ...validTrip,
      coordinates: { lat: 48.8566, lon: 2.3522 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.coordinates).toEqual({ lat: 48.8566, lon: 2.3522 });
    }
  });

  it('rejects empty name', () => {
    const result = TripFormDataSchema.safeParse({
      ...validTrip,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name over 100 characters', () => {
    const result = TripFormDataSchema.safeParse({
      ...validTrip,
      name: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('rejects end date before start date', () => {
    const result = TripFormDataSchema.safeParse({
      ...validTrip,
      startDate: '2024-07-22',
      endDate: '2024-07-15',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const endDateError = result.error.issues.find(
        (i) => i.path.includes('endDate'),
      );
      expect(endDateError?.message).toContain('End date must be on or after start date');
    }
  });

  it('accepts same start and end date', () => {
    const result = TripFormDataSchema.safeParse({
      ...validTrip,
      startDate: '2024-07-15',
      endDate: '2024-07-15',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid coordinates', () => {
    const result = TripFormDataSchema.safeParse({
      ...validTrip,
      coordinates: { lat: 91, lon: 0 }, // lat out of range
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// RoomFormData Schema Tests
// ============================================================================

describe('RoomFormDataSchema', () => {
  const validRoom = {
    name: 'Master bedroom',
    capacity: 2,
    description: 'King bed with ensuite',
    icon: 'bed-double' as const,
  };

  it('accepts valid room data', () => {
    const result = RoomFormDataSchema.safeParse(validRoom);
    expect(result.success).toBe(true);
  });

  it('accepts room with minimal required fields', () => {
    const result = RoomFormDataSchema.safeParse({
      name: 'Room',
      capacity: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = RoomFormDataSchema.safeParse({
      ...validRoom,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects capacity less than 1', () => {
    const result = RoomFormDataSchema.safeParse({
      ...validRoom,
      capacity: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer capacity', () => {
    const result = RoomFormDataSchema.safeParse({
      ...validRoom,
      capacity: 2.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid icon', () => {
    const result = RoomFormDataSchema.safeParse({
      ...validRoom,
      icon: 'invalid-icon',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// PersonFormData Schema Tests
// ============================================================================

describe('PersonFormDataSchema', () => {
  const validPerson = {
    name: 'Marie',
    color: '#ef4444',
    stayStartDate: '2024-07-15',
    stayEndDate: '2024-07-22',
  };

  it('accepts valid person data', () => {
    const result = PersonFormDataSchema.safeParse(validPerson);
    expect(result.success).toBe(true);
  });

  it('accepts person without stay dates', () => {
    const result = PersonFormDataSchema.safeParse({
      name: 'Marie',
      color: '#ef4444',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = PersonFormDataSchema.safeParse({
      ...validPerson,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid hex color', () => {
    const result = PersonFormDataSchema.safeParse({
      ...validPerson,
      color: 'red',
    });
    expect(result.success).toBe(false);
  });

  it('rejects stay end date before stay start date', () => {
    const result = PersonFormDataSchema.safeParse({
      ...validPerson,
      stayStartDate: '2024-07-22',
      stayEndDate: '2024-07-15',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// RoomAssignmentFormData Schema Tests
// ============================================================================

describe('RoomAssignmentFormDataSchema', () => {
  const validAssignment = {
    roomId: 'room123' as RoomId,
    personId: 'person456' as PersonId,
    startDate: '2024-07-15',
    endDate: '2024-07-19',
  };

  it('accepts valid assignment data', () => {
    const result = RoomAssignmentFormDataSchema.safeParse(validAssignment);
    expect(result.success).toBe(true);
  });

  it('rejects missing roomId', () => {
    const result = RoomAssignmentFormDataSchema.safeParse({
      ...validAssignment,
      roomId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing personId', () => {
    const result = RoomAssignmentFormDataSchema.safeParse({
      ...validAssignment,
      personId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects end date before start date', () => {
    const result = RoomAssignmentFormDataSchema.safeParse({
      ...validAssignment,
      startDate: '2024-07-19',
      endDate: '2024-07-15',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// TransportFormData Schema Tests
// ============================================================================

describe('TransportFormDataSchema', () => {
  const validTransport = {
    personId: 'person123' as PersonId,
    type: 'arrival' as const,
    datetime: '2024-07-15T14:30:00.000Z',
    location: 'Gare Montparnasse',
    transportMode: 'train' as const,
    transportNumber: 'TGV 8541',
    driverId: 'person456' as PersonId,
    needsPickup: true,
    notes: 'Platform 12',
  };

  it('accepts valid transport data', () => {
    const result = TransportFormDataSchema.safeParse(validTransport);
    expect(result.success).toBe(true);
  });

  it('accepts transport with minimal required fields', () => {
    const result = TransportFormDataSchema.safeParse({
      personId: 'person123',
      type: 'departure',
      datetime: '2024-07-22T10:00:00.000Z',
      location: 'Airport',
      needsPickup: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing personId', () => {
    const result = TransportFormDataSchema.safeParse({
      ...validTransport,
      personId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid datetime', () => {
    const result = TransportFormDataSchema.safeParse({
      ...validTransport,
      datetime: '2024-07-15',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty location', () => {
    const result = TransportFormDataSchema.safeParse({
      ...validTransport,
      location: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid transport type', () => {
    const result = TransportFormDataSchema.safeParse({
      ...validTransport,
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Validation Function Tests
// ============================================================================

describe('Validation Functions', () => {
  describe('validateTripForm', () => {
    it('returns success for valid data', () => {
      const result = validateTripForm({
        name: 'Trip',
        startDate: '2024-07-15',
        endDate: '2024-07-22',
      });
      expect(result.success).toBe(true);
      expect(isValidationSuccess(result)).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Trip');
      }
    });

    it('returns errors for invalid data', () => {
      const result = validateTripForm({
        name: '',
        startDate: 'invalid',
        endDate: '2024-07-22',
      });
      expect(result.success).toBe(false);
      expect(isValidationError(result)).toBe(true);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.zodError).toBeDefined();
      }
    });
  });

  describe('validateTripFormOrThrow', () => {
    it('returns data for valid input', () => {
      const data = validateTripFormOrThrow({
        name: 'Trip',
        startDate: '2024-07-15',
        endDate: '2024-07-22',
      });
      expect(data.name).toBe('Trip');
    });

    it('throws FormValidationError for invalid input', () => {
      expect(() =>
        validateTripFormOrThrow({
          name: '',
          startDate: '2024-07-15',
          endDate: '2024-07-22',
        }),
      ).toThrow(FormValidationError);
    });
  });

  describe('validateRoomForm', () => {
    it('returns success for valid data', () => {
      const result = validateRoomForm({
        name: 'Room',
        capacity: 2,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('validatePersonForm', () => {
    it('returns success for valid data', () => {
      const result = validatePersonForm({
        name: 'Marie',
        color: '#ef4444',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('validateRoomAssignmentForm', () => {
    it('returns success for valid data', () => {
      const result = validateRoomAssignmentForm({
        roomId: 'room123',
        personId: 'person456',
        startDate: '2024-07-15',
        endDate: '2024-07-19',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('validateTransportForm', () => {
    it('returns success for valid data', () => {
      const result = validateTransportForm({
        personId: 'person123',
        type: 'arrival',
        datetime: '2024-07-15T14:30:00.000Z',
        location: 'Station',
        needsPickup: false,
      });
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Utility Functions', () => {
  describe('getFieldError', () => {
    it('returns error message for existing field', () => {
      const result = validateTripForm({
        name: '',
        startDate: '2024-07-15',
        endDate: '2024-07-22',
      });
      if (!result.success) {
        const error = getFieldError(result.errors, 'name');
        expect(error).toBe('Name is required');
      }
    });

    it('returns undefined for non-existent field', () => {
      const result = validateTripForm({
        name: '',
        startDate: '2024-07-15',
        endDate: '2024-07-22',
      });
      if (!result.success) {
        const error = getFieldError(result.errors, 'location');
        expect(error).toBeUndefined();
      }
    });
  });

  describe('errorsToMap', () => {
    it('converts errors array to map', () => {
      const result = validateTripForm({
        name: '',
        startDate: 'invalid',
        endDate: '2024-07-22',
      });
      if (!result.success) {
        const map = errorsToMap(result.errors);
        expect(map.name).toBe('Name is required');
        expect(map.startDate).toBeDefined();
      }
    });

    it('keeps only first error per field', () => {
      // Person with both invalid color and empty name - only first error per field kept
      const result = validatePersonForm({
        name: '',
        color: 'invalid',
      });
      if (!result.success) {
        const map = errorsToMap(result.errors);
        expect(typeof map.name).toBe('string');
        expect(typeof map.color).toBe('string');
      }
    });
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  describe('boundary values', () => {
    it('accepts name at exactly 100 characters', () => {
      const result = TripFormDataSchema.safeParse({
        name: 'a'.repeat(100),
        startDate: '2024-07-15',
        endDate: '2024-07-22',
      });
      expect(result.success).toBe(true);
    });

    it('accepts description at exactly 1000 characters', () => {
      const result = TripFormDataSchema.safeParse({
        name: 'Trip',
        startDate: '2024-07-15',
        endDate: '2024-07-22',
        description: 'a'.repeat(1000),
      });
      expect(result.success).toBe(true);
    });

    it('accepts capacity at exactly 1', () => {
      const result = RoomFormDataSchema.safeParse({
        name: 'Room',
        capacity: 1,
      });
      expect(result.success).toBe(true);
    });

    it('accepts coordinates at boundaries', () => {
      // Minimum lat/lon
      expect(
        TripFormDataSchema.safeParse({
          name: 'Trip',
          startDate: '2024-07-15',
          endDate: '2024-07-22',
          coordinates: { lat: -90, lon: -180 },
        }).success,
      ).toBe(true);

      // Maximum lat/lon
      expect(
        TripFormDataSchema.safeParse({
          name: 'Trip',
          startDate: '2024-07-15',
          endDate: '2024-07-22',
          coordinates: { lat: 90, lon: 180 },
        }).success,
      ).toBe(true);
    });
  });

  describe('null and undefined handling', () => {
    it('handles null values', () => {
      const result = TripFormDataSchema.safeParse({
        name: null,
        startDate: '2024-07-15',
        endDate: '2024-07-22',
      });
      expect(result.success).toBe(false);
    });

    it('handles undefined optional fields', () => {
      const result = TripFormDataSchema.safeParse({
        name: 'Trip',
        startDate: '2024-07-15',
        endDate: '2024-07-22',
        location: undefined,
        description: undefined,
        coordinates: undefined,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('type coercion', () => {
    it('does not coerce number to string for name', () => {
      const result = TripFormDataSchema.safeParse({
        name: 123,
        startDate: '2024-07-15',
        endDate: '2024-07-22',
      });
      expect(result.success).toBe(false);
    });

    it('does not coerce string to number for capacity', () => {
      const result = RoomFormDataSchema.safeParse({
        name: 'Room',
        capacity: '2',
      });
      expect(result.success).toBe(false);
    });
  });
});
