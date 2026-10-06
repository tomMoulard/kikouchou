/**
 * @fileoverview Tests for the one call a handled failure makes.
 *
 * The regression these guard is the reason the helper exists: a failure that
 * reached the user as a headline with no reason, and reached error tracking not
 * at all.
 *
 * @module lib/errors/__tests__/report-failure.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/notifications', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/posthog', () => ({
  default: undefined,
  reportError: vi.fn(),
}));

import { notify } from '@/lib/notifications';
import { reportError } from '@/lib/posthog';
import { reportFailure } from '@/lib/errors/report-failure';

describe('reportFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('tells the user the reason under the translated headline', () => {
    reportFailure(
      'RoomListPage.assignGuestToRoom',
      new DOMException('key exists', 'ConstraintError'),
      'Echec de l\'enregistrement',
    );

    expect(notify.error).toHaveBeenCalledWith('Echec de l\'enregistrement', {
      description: 'ConstraintError: key exists',
    });
  });

  it('reports the error, which catching it used to prevent', () => {
    const error = new Error('boom');

    reportFailure('RoomListPage.assignGuestToRoom', error, 'Failed to save', {
      room_id: 'r1',
    });

    expect(reportError).toHaveBeenCalledWith(error, {
      source: 'RoomListPage.assignGuestToRoom',
      reason: 'Error: boom',
      room_id: 'r1',
    });
  });

  it('still logs to the console for anyone with a devtools open', () => {
    const error = new Error('boom');

    reportFailure('Somewhere.doThing', error, 'Failed');

    expect(console.error).toHaveBeenCalledWith('Somewhere.doThing:', error);
  });

  it('describes a message-less error rather than showing an empty reason', () => {
    const silent = new Error('');
    silent.name = 'DatabaseClosedError';

    reportFailure('RoomListPage.assignGuestToRoom', silent, 'Failed to save');

    expect(notify.error).toHaveBeenCalledWith('Failed to save', {
      description: 'DatabaseClosedError',
    });
  });

  it('handles a thrown non-error', () => {
    reportFailure('Somewhere.doThing', 'plain string', 'Failed');

    expect(notify.error).toHaveBeenCalledWith('Failed', { description: 'plain string' });
  });
});
