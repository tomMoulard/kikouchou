/**
 * @fileoverview Tests for useUnsavedChanges hook.
 * Tests blocker activation, beforeunload listener management, and cleanup.
 *
 * @module hooks/__tests__/useUnsavedChanges
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChanges } from '../useUnsavedChanges';

// ============================================================================
// Mocks
// ============================================================================

// Track the blocker callback passed to useBlocker
let blockerCallback: (args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => boolean;

// Mock blocker state
const mockBlocker = {
  state: 'unblocked' as 'unblocked' | 'blocked' | 'proceeding',
  proceed: vi.fn(),
  reset: vi.fn(),
  location: undefined as { pathname: string } | undefined,
};

vi.mock('react-router-dom', () => ({
  useBlocker: (callback: typeof blockerCallback) => {
    blockerCallback = callback;
    return mockBlocker;
  },
}));

// ============================================================================
// Tests
// ============================================================================

describe('useUnsavedChanges', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBlocker.state = 'unblocked';
    mockBlocker.proceed.mockClear();
    mockBlocker.reset.mockClear();
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Blocker Activation
  // --------------------------------------------------------------------------

  describe('blocker activation', () => {
    it('passes a blocker callback that blocks when isDirty=true and paths differ', () => {
      renderHook(() => useUnsavedChanges(true));

      const shouldBlock = blockerCallback({
        currentLocation: { pathname: '/form' },
        nextLocation: { pathname: '/other' },
      });

      expect(shouldBlock).toBe(true);
    });

    it('passes a blocker callback that does NOT block when isDirty=false', () => {
      renderHook(() => useUnsavedChanges(false));

      const shouldBlock = blockerCallback({
        currentLocation: { pathname: '/form' },
        nextLocation: { pathname: '/other' },
      });

      expect(shouldBlock).toBe(false);
    });

    it('passes a blocker callback that does NOT block when paths are the same', () => {
      renderHook(() => useUnsavedChanges(true));

      const shouldBlock = blockerCallback({
        currentLocation: { pathname: '/form' },
        nextLocation: { pathname: '/form' },
      });

      expect(shouldBlock).toBe(false);
    });

    it('returns isBlocked=true when blocker state is blocked', () => {
      mockBlocker.state = 'blocked';
      const { result } = renderHook(() => useUnsavedChanges(true));

      expect(result.current.isBlocked).toBe(true);
    });

    it('returns isBlocked=false when blocker state is unblocked', () => {
      mockBlocker.state = 'unblocked';
      const { result } = renderHook(() => useUnsavedChanges(true));

      expect(result.current.isBlocked).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // beforeunload Listener
  // --------------------------------------------------------------------------

  describe('beforeunload listener', () => {
    it('registers beforeunload listener when isDirty=true', () => {
      renderHook(() => useUnsavedChanges(true));

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function),
      );
    });

    it('does NOT register beforeunload listener when isDirty=false', () => {
      renderHook(() => useUnsavedChanges(false));

      const beforeunloadCalls = addEventListenerSpy.mock.calls.filter(
        ([event]: [string, ...unknown[]]) => event === 'beforeunload',
      );
      expect(beforeunloadCalls).toHaveLength(0);
    });

    it('removes beforeunload listener when isDirty changes to false', () => {
      const { rerender } = renderHook(
        ({ isDirty }) => useUnsavedChanges(isDirty),
        { initialProps: { isDirty: true } },
      );

      // The listener was added
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function),
      );

      // Change to not dirty
      rerender({ isDirty: false });

      // The listener should have been removed
      const removedCalls = removeEventListenerSpy.mock.calls.filter(
        ([event]: [string, ...unknown[]]) => event === 'beforeunload',
      );
      expect(removedCalls.length).toBeGreaterThan(0);
    });

    it('calls preventDefault on beforeunload event', () => {
      renderHook(() => useUnsavedChanges(true));

      const handler = addEventListenerSpy.mock.calls.find(
        ([event]: [string, ...unknown[]]) => event === 'beforeunload',
      )?.[1] as EventListener;

      expect(handler).toBeDefined();

      const event = new Event('beforeunload');
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      handler(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Cleanup on Unmount
  // --------------------------------------------------------------------------

  describe('cleanup on unmount', () => {
    it('removes beforeunload listener on unmount when isDirty=true', () => {
      const { unmount } = renderHook(() => useUnsavedChanges(true));

      const addedHandler = addEventListenerSpy.mock.calls.find(
        ([event]: [string, ...unknown[]]) => event === 'beforeunload',
      )?.[1];

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        addedHandler,
      );
    });

    it('does not fail on unmount when isDirty=false', () => {
      const { unmount } = renderHook(() => useUnsavedChanges(false));

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Proceed and Reset
  // --------------------------------------------------------------------------

  describe('proceed and reset', () => {
    it('calls blocker.proceed() when proceed is called in blocked state', () => {
      mockBlocker.state = 'blocked';
      const { result } = renderHook(() => useUnsavedChanges(true));

      act(() => {
        result.current.proceed();
      });

      expect(mockBlocker.proceed).toHaveBeenCalledOnce();
    });

    it('does NOT call blocker.proceed() when not in blocked state', () => {
      mockBlocker.state = 'unblocked';
      const { result } = renderHook(() => useUnsavedChanges(true));

      act(() => {
        result.current.proceed();
      });

      expect(mockBlocker.proceed).not.toHaveBeenCalled();
    });

    it('calls blocker.reset() when reset is called in blocked state', () => {
      mockBlocker.state = 'blocked';
      const { result } = renderHook(() => useUnsavedChanges(true));

      act(() => {
        result.current.reset();
      });

      expect(mockBlocker.reset).toHaveBeenCalledOnce();
    });

    it('does NOT call blocker.reset() when not in blocked state', () => {
      mockBlocker.state = 'unblocked';
      const { result } = renderHook(() => useUnsavedChanges(true));

      act(() => {
        result.current.reset();
      });

      expect(mockBlocker.reset).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // skipNextBlock
  // --------------------------------------------------------------------------

  describe('skipNextBlock', () => {
    it('causes the next blocker evaluation to return false even when isDirty=true', () => {
      const { result } = renderHook(() => useUnsavedChanges(true));

      // Before skipNextBlock, blocker should block
      expect(
        blockerCallback({
          currentLocation: { pathname: '/form' },
          nextLocation: { pathname: '/other' },
        }),
      ).toBe(true);

      // Call skipNextBlock
      act(() => {
        result.current.skipNextBlock();
      });

      // Next evaluation should NOT block
      expect(
        blockerCallback({
          currentLocation: { pathname: '/form' },
          nextLocation: { pathname: '/other' },
        }),
      ).toBe(false);
    });

    it('resets after one use (only skips a single navigation)', () => {
      const { result } = renderHook(() => useUnsavedChanges(true));

      act(() => {
        result.current.skipNextBlock();
      });

      // First evaluation: skipped
      expect(
        blockerCallback({
          currentLocation: { pathname: '/form' },
          nextLocation: { pathname: '/other' },
        }),
      ).toBe(false);

      // Second evaluation: should block again
      expect(
        blockerCallback({
          currentLocation: { pathname: '/form' },
          nextLocation: { pathname: '/other' },
        }),
      ).toBe(true);
    });

    it('returns a stable function reference across re-renders', () => {
      const { result, rerender } = renderHook(
        ({ isDirty }) => useUnsavedChanges(isDirty),
        { initialProps: { isDirty: true } },
      );

      const firstRef = result.current.skipNextBlock;
      rerender({ isDirty: false });
      const secondRef = result.current.skipNextBlock;

      expect(firstRef).toBe(secondRef);
    });
  });
});
