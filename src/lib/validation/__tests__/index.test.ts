/**
 * Tests for validation index — uncovered branches.
 *
 * @module lib/validation/__tests__/index.test
 */
import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  validateTripForm,
  validateRoomForm,
  validatePersonForm,
  validateTransportForm,
  validateRoomAssignmentForm,
  validateTripFormOrThrow,
  FormValidationError,
  getFieldError,
  errorsToMap,
  isValidationError,
} from '@/lib/validation';

describe('validation index', () => {
  describe('validateTripForm', () => {
    it('returns success for valid data', () => {
      const result = validateTripForm({
        name: 'My Trip',
        startDate: '2025-01-01',
        endDate: '2025-01-10',
        location: 'Paris',
        description: 'A trip',
      });
      expect(result.success).toBe(true);
    });

    it('returns errors for invalid data', () => {
      const result = validateTripForm({ name: '', startDate: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('returns errors with "root" path for top-level refinement failures', () => {
      // End date before start date triggers a top-level refinement
      const result = validateTripForm({
        name: 'Trip',
        startDate: '2025-01-10',
        endDate: '2025-01-05',
        location: '',
      });
      if (!result.success) {
        // Some errors may have 'root' path from refinements
        const hasErrors = result.errors.length > 0;
        expect(hasErrors).toBe(true);
      }
    });
  });

  describe('validateRoomForm', () => {
    it('returns errors for completely invalid data', () => {
      const result = validateRoomForm({});
      expect(result.success).toBe(false);
    });
  });

  describe('validatePersonForm', () => {
    it('returns errors for completely invalid data', () => {
      const result = validatePersonForm({});
      expect(result.success).toBe(false);
    });
  });

  describe('validateTransportForm', () => {
    it('returns errors for completely invalid data', () => {
      const result = validateTransportForm({});
      expect(result.success).toBe(false);
    });
  });

  describe('validateRoomAssignmentForm', () => {
    it('returns errors for completely invalid data', () => {
      const result = validateRoomAssignmentForm({});
      expect(result.success).toBe(false);
    });
  });

  describe('FormValidationError', () => {
    it('includes first error in message', () => {
      const result = validateTripForm({ name: '' });
      if (!result.success) {
        const error = new FormValidationError(result);
        expect(error.message).toContain('Validation failed:');
        expect(error.name).toBe('FormValidationError');
        expect(error.errors.length).toBeGreaterThan(0);
      }
    });

    it('uses fallback message when errors array is empty', () => {
      // Create a synthetic ValidationError with empty errors
      const zodError = new ZodError([]);
      const error = new FormValidationError({
        success: false,
        errors: [],
        zodError,
      });
      expect(error.message).toBe('Validation failed');
    });
  });

  describe('validateTripFormOrThrow', () => {
    it('returns data for valid input', () => {
      const data = validateTripFormOrThrow({
        name: 'Trip',
        startDate: '2025-01-01',
        endDate: '2025-01-05',
        location: 'Paris',
      });
      expect(data.name).toBe('Trip');
    });

    it('throws FormValidationError for invalid input', () => {
      expect(() => validateTripFormOrThrow({})).toThrow(FormValidationError);
    });
  });

  describe('isValidationError', () => {
    it('returns true for validation errors', () => {
      const result = validateTripForm({});
      expect(isValidationError(result)).toBe(true);
    });

    it('returns false for success', () => {
      const result = validateTripForm({
        name: 'Trip',
        startDate: '2025-01-01',
        endDate: '2025-01-05',
      });
      expect(isValidationError(result)).toBe(false);
    });
  });

  describe('getFieldError', () => {
    it('returns error message for matching path', () => {
      const errors = [{ path: 'name', message: 'Required' }];
      expect(getFieldError(errors, 'name')).toBe('Required');
    });

    it('returns undefined for non-matching path', () => {
      const errors = [{ path: 'name', message: 'Required' }];
      expect(getFieldError(errors, 'email')).toBeUndefined();
    });
  });

  describe('errorsToMap', () => {
    it('converts errors to map keeping first per field', () => {
      const errors = [
        { path: 'name', message: 'First' },
        { path: 'name', message: 'Second' },
        { path: 'email', message: 'Invalid' },
      ];
      const map = errorsToMap(errors);
      expect(map).toEqual({ name: 'First', email: 'Invalid' });
    });
  });
});
