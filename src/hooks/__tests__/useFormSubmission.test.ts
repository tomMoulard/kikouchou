/**
 * @fileoverview Tests for useFormSubmission hook.
 * Tests the canonical form submission pattern: double-submit guard, unmount safety,
 * error handling, and state management.
 *
 * @module hooks/__tests__/useFormSubmission
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFormSubmission } from '../useFormSubmission';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a deferred promise that can be resolved/rejected externally.
 */
function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ============================================================================
// Mocks
// ============================================================================

// Mock react-i18next - t() returns the key always (simulating translation lookup)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('useFormSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Initial State
  // --------------------------------------------------------------------------

  describe('initial state', () => {
    it('returns correct initial values', () => {
      const onSubmit = vi.fn();
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.submitError).toBeUndefined();
      expect(typeof result.current.handleSubmit).toBe('function');
      expect(typeof result.current.clearError).toBe('function');
    });
  });

  // --------------------------------------------------------------------------
  // Successful Submission
  // --------------------------------------------------------------------------

  describe('successful submission', () => {
    it('sets isSubmitting to true during submission', async () => {
      const deferred = createDeferred();
      const onSubmit = vi.fn().mockReturnValue(deferred.promise);
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      // Start submission
      let submitPromise: Promise<void>;
      act(() => {
        submitPromise = result.current.handleSubmit({ name: 'test' });
      });

      // Should be submitting
      expect(result.current.isSubmitting).toBe(true);
      expect(result.current.submitError).toBeUndefined();

      // Resolve
      await act(async () => {
        deferred.resolve();
        await submitPromise!;
      });

      // Should be done
      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.submitError).toBeUndefined();
    });

    it('calls onSubmit with the provided data', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      const testData = { name: 'test', value: 42 };

      await act(async () => {
        await result.current.handleSubmit(testData);
      });

      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith(testData);
    });

    it('clears previous error on new submission', async () => {
      const onSubmit = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      // First submission fails
      await act(async () => {
        try {
          await result.current.handleSubmit('data1');
        } catch {
          // expected
        }
      });

      expect(result.current.submitError).toBeDefined();

      // Second submission succeeds - error should be cleared
      await act(async () => {
        await result.current.handleSubmit('data2');
      });

      expect(result.current.submitError).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('sets submitError on failure', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error('Save failed'));
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      await act(async () => {
        try {
          await result.current.handleSubmit('data');
        } catch {
          // expected - hook re-throws
        }
      });

      expect(result.current.isSubmitting).toBe(false);
      // Default error key is 'errors.saveFailed', and mock t() returns the key
      expect(result.current.submitError).toBe('errors.saveFailed');
    });

    it('uses custom error key when provided', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() =>
        useFormSubmission(onSubmit, { errorKey: 'errors.customError' }),
      );

      await act(async () => {
        try {
          await result.current.handleSubmit('data');
        } catch {
          // expected
        }
      });

      // The mock t() returns the key when no default value
      expect(result.current.submitError).toBe('errors.customError');
    });

    it('re-throws the error so callers can handle it', async () => {
      const error = new Error('Original error');
      const onSubmit = vi.fn().mockRejectedValue(error);
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      let caughtError: unknown;
      await act(async () => {
        try {
          await result.current.handleSubmit('data');
        } catch (e) {
          caughtError = e;
        }
      });

      expect(caughtError).toBe(error);
    });
  });

  // --------------------------------------------------------------------------
  // Double-Submission Guard
  // --------------------------------------------------------------------------

  describe('double-submission prevention', () => {
    it('prevents concurrent submissions via synchronous ref guard', async () => {
      const deferred = createDeferred();
      const onSubmit = vi.fn().mockReturnValue(deferred.promise);
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      // Start first submission
      let firstPromise: Promise<void>;
      act(() => {
        firstPromise = result.current.handleSubmit('data1');
      });

      // Attempt second submission while first is in progress
      act(() => {
        result.current.handleSubmit('data2');
      });

      // Only first submission should have been called
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith('data1');

      // Resolve first submission
      await act(async () => {
        deferred.resolve();
        await firstPromise!;
      });
    });

    it('allows new submission after previous one completes', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      // First submission
      await act(async () => {
        await result.current.handleSubmit('data1');
      });

      // Second submission should work
      await act(async () => {
        await result.current.handleSubmit('data2');
      });

      expect(onSubmit).toHaveBeenCalledTimes(2);
      expect(onSubmit).toHaveBeenNthCalledWith(1, 'data1');
      expect(onSubmit).toHaveBeenNthCalledWith(2, 'data2');
    });

    it('allows new submission after previous one fails', async () => {
      const onSubmit = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      // First submission fails
      await act(async () => {
        try {
          await result.current.handleSubmit('data1');
        } catch {
          // expected
        }
      });

      // Second submission should work
      await act(async () => {
        await result.current.handleSubmit('data2');
      });

      expect(onSubmit).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // Unmount Safety
  // --------------------------------------------------------------------------

  describe('unmount safety', () => {
    it('does not update state after unmount', async () => {
      const deferred = createDeferred();
      const onSubmit = vi.fn().mockReturnValue(deferred.promise);
      const { result, unmount } = renderHook(() => useFormSubmission(onSubmit));

      // Start submission
      let submitPromise: Promise<void>;
      act(() => {
        submitPromise = result.current.handleSubmit('data');
      });

      expect(result.current.isSubmitting).toBe(true);

      // Unmount while submission is in progress
      unmount();

      // Resolve - should not throw (no state updates after unmount)
      await act(async () => {
        deferred.resolve();
        await submitPromise!;
      });

      // No errors thrown = test passes
    });

    it('does not set error state after unmount on failure', async () => {
      const deferred = createDeferred();
      const onSubmit = vi.fn().mockReturnValue(deferred.promise);
      const { result, unmount } = renderHook(() => useFormSubmission(onSubmit));

      // Start submission
      let submitPromise: Promise<void>;
      act(() => {
        submitPromise = result.current.handleSubmit('data');
      });

      // Unmount
      unmount();

      // Reject - should not throw
      await act(async () => {
        deferred.reject(new Error('fail'));
        try {
          await submitPromise!;
        } catch {
          // expected re-throw
        }
      });

      // No errors thrown = test passes
    });
  });

  // --------------------------------------------------------------------------
  // clearError
  // --------------------------------------------------------------------------

  describe('clearError', () => {
    it('clears the submitError', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useFormSubmission(onSubmit));

      // Create an error
      await act(async () => {
        try {
          await result.current.handleSubmit('data');
        } catch {
          // expected
        }
      });

      expect(result.current.submitError).toBeDefined();

      // Clear it
      act(() => {
        result.current.clearError();
      });

      expect(result.current.submitError).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // onSubmit callback stability
  // --------------------------------------------------------------------------

  describe('callback stability', () => {
    it('uses latest onSubmit callback without stale closure', async () => {
      const onSubmit1 = vi.fn().mockResolvedValue(undefined);
      const onSubmit2 = vi.fn().mockResolvedValue(undefined);

      const { result, rerender } = renderHook(
        ({ onSubmit }) => useFormSubmission(onSubmit),
        { initialProps: { onSubmit: onSubmit1 } },
      );

      // Re-render with new callback
      rerender({ onSubmit: onSubmit2 });

      // Submit should use the latest callback
      await act(async () => {
        await result.current.handleSubmit('data');
      });

      expect(onSubmit1).not.toHaveBeenCalled();
      expect(onSubmit2).toHaveBeenCalledWith('data');
    });
  });
});
