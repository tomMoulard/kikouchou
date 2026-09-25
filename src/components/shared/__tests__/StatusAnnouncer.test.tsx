/**
 * @fileoverview Tests for StatusAnnouncer.
 *
 * @module components/shared/__tests__/StatusAnnouncer.test
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import { StatusAnnouncer } from '../StatusAnnouncer';
import { announceStatus } from '@/lib/notifications';

// ============================================================================
// Tests
// ============================================================================

describe('StatusAnnouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Announces, then lets the blank-frame reset elapse. */
  function announce(message: string): void {
    act(() => {
      announceStatus(message);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
  }

  it('exposes a polite live region', () => {
    render(<StatusAnnouncer />, { withProviders: false });

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('is invisible: the message is already on screen as a notification', () => {
    render(<StatusAnnouncer />, { withProviders: false });

    expect(screen.getByRole('status')).toHaveClass('sr-only');
  });

  it('carries the announced confirmation', () => {
    render(<StatusAnnouncer />, { withProviders: false });

    announce('Room created successfully');

    expect(screen.getByRole('status')).toHaveTextContent(
      'Room created successfully',
    );
  });

  it('blanks the region before repeating an identical message', () => {
    // Two rooms created in a row send the same string twice. A live region
    // only speaks text that changed, so the blank frame is what makes the
    // second one audible at all.
    render(<StatusAnnouncer />, { withProviders: false });

    announce('Room created successfully');

    act(() => {
      announceStatus('Room created successfully');
    });
    expect(screen.getByRole('status')).toHaveTextContent('');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Room created successfully',
    );
  });

  it('keeps only the latest of two confirmations in flight', () => {
    render(<StatusAnnouncer />, { withProviders: false });

    act(() => {
      announceStatus('Room created successfully');
      announceStatus('Assignment created');
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Assignment created');
  });

  it('stops listening once unmounted', () => {
    const { unmount } = render(<StatusAnnouncer />, { withProviders: false });

    unmount();

    // An announcement with no region mounted is a no-op, not a crash: `notify`
    // is called from plain functions that cannot know what is rendered.
    expect(() => announceStatus('Room created successfully')).not.toThrow();
  });
});
