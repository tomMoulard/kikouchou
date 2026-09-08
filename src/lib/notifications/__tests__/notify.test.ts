/**
 * @fileoverview Tests for the notification facade — where a message lands.
 *
 * The whole point of the module is one rule: a confirmation goes to the
 * operating system, a problem stays in the page. These tests assert that rule
 * in both directions, because getting it backwards is silent — an error
 * routed to a denied OS notification is an error nobody ever sees.
 *
 * @module lib/notifications/__tests__/notify.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notify } from '../notify';

// ============================================================================
// Mocks
// ============================================================================

const mockShowOsNotification = vi.fn(async () => true);
vi.mock('@/lib/notifications/os-notification', () => ({
  showOsNotification: (...args: unknown[]) => mockShowOsNotification(...(args as [])),
}));

const mockAnnounceStatus = vi.fn();
vi.mock('@/lib/notifications/announcer', () => ({
  announceStatus: (...args: unknown[]) => mockAnnounceStatus(...args),
}));

const mockToastError = vi.fn();
const mockToastWarning = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

// ============================================================================
// Tests
// ============================================================================

describe('notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowOsNotification.mockResolvedValue(true);
  });

  // --------------------------------------------------------------------------
  // Confirmations leave the page
  // --------------------------------------------------------------------------

  describe('success', () => {
    it('sends the confirmation to the operating system', () => {
      notify.success('Room created successfully');

      expect(mockShowOsNotification).toHaveBeenCalledWith(
        'Room created successfully',
      );
    });

    it('never renders a toast', () => {
      // The regression this module exists for: three room creations left three
      // stacked cards over the content.
      notify.success('Room created successfully');

      expect(mockToastSuccess).not.toHaveBeenCalled();
      expect(mockToastError).not.toHaveBeenCalled();
      expect(mockToastWarning).not.toHaveBeenCalled();
    });

    it('announces the confirmation for a screen reader', () => {
      notify.success('Room created successfully');

      expect(mockAnnounceStatus).toHaveBeenCalledWith(
        'Room created successfully',
      );
    });

    it('announces it even when the OS refuses delivery', async () => {
      // A denied permission costs the visible confirmation. It must not also
      // cost the spoken one.
      mockShowOsNotification.mockResolvedValue(false);

      notify.success('Room created successfully');
      await vi.waitFor(() => expect(mockShowOsNotification).toHaveBeenCalled());

      expect(mockAnnounceStatus).toHaveBeenCalledWith(
        'Room created successfully',
      );
    });

    it('does not make the caller wait on the permission prompt', () => {
      // `showOsNotification` may open a dialog. A save returning only after
      // the user answers it would freeze the form.
      let settle: (value: boolean) => void = () => undefined;
      mockShowOsNotification.mockReturnValue(
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
      );

      expect(() => notify.success('Room created successfully')).not.toThrow();
      settle(true);
    });
  });

  describe('info', () => {
    it('takes the same route as a confirmation', () => {
      notify.info('Trip switched to Chamonix');

      expect(mockShowOsNotification).toHaveBeenCalledWith(
        'Trip switched to Chamonix',
      );
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Problems stay in the page
  // --------------------------------------------------------------------------

  describe('error', () => {
    it('stays in the page as a toast', () => {
      notify.error('Failed to save');

      expect(mockToastError).toHaveBeenCalledWith('Failed to save');
    });

    it('never depends on notification permission', () => {
      notify.error('Failed to save');

      expect(mockShowOsNotification).not.toHaveBeenCalled();
    });

    it('passes sonner options through', () => {
      notify.error('Failed to save', { duration: 8_000 });

      expect(mockToastError).toHaveBeenCalledWith('Failed to save', {
        duration: 8_000,
      });
    });
  });

  describe('warning', () => {
    it('stays in the page as a toast', () => {
      // "2 people were no longer in the group" is news the user has to read,
      // not a confirmation of something they asked for.
      notify.warning('2 people were no longer in the group');

      expect(mockToastWarning).toHaveBeenCalledWith(
        '2 people were no longer in the group',
      );
      expect(mockShowOsNotification).not.toHaveBeenCalled();
    });
  });
});
