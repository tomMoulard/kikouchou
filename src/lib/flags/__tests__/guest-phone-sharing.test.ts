/**
 * Tests for the guest-phone-sharing flag read.
 *
 * @module lib/flags/__tests__/guest-phone-sharing.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// The real export is `undefined` without VITE_POSTHOG_KEY, which is every unit
// test — so a client has to be mocked in to exercise anything but the default.
const isFeatureEnabled = vi.fn();
vi.mock('@/lib/posthog', () => ({
  get default() {
    return mockClient;
  },
}));

let mockClient: { isFeatureEnabled: typeof isFeatureEnabled } | undefined;

import { GUEST_PHONE_SHARING_FLAG, isGuestPhoneSharingEnabled } from '../guest-phone-sharing';

afterEach(() => {
  mockClient = undefined;
  vi.clearAllMocks();
});

describe('isGuestPhoneSharingEnabled', () => {
  it('is false with no PostHog client at all', () => {
    // A fresh clone, a fork's CI, every unit test. Not knowing that sharing was
    // allowed has to read as "do not share".
    expect(isGuestPhoneSharingEnabled()).toBe(false);
  });

  it('is true on an explicit enable', () => {
    mockClient = { isFeatureEnabled };
    isFeatureEnabled.mockReturnValue(true);

    expect(isGuestPhoneSharingEnabled()).toBe(true);
    expect(isFeatureEnabled).toHaveBeenCalledWith(GUEST_PHONE_SHARING_FLAG);
  });

  it('is false on an explicit disable', () => {
    mockClient = { isFeatureEnabled };
    isFeatureEnabled.mockReturnValue(false);

    expect(isGuestPhoneSharingEnabled()).toBe(false);
  });

  it('is false while the flags are still downloading', () => {
    // `isFeatureEnabled` answers undefined for the first moments of a page's
    // life. Undefined is not a yes.
    mockClient = { isFeatureEnabled };
    isFeatureEnabled.mockReturnValue(undefined);

    expect(isGuestPhoneSharingEnabled()).toBe(false);
  });

  it('is false, rather than throwing, when the client throws', () => {
    // Analytics is never allowed to take the app down, and this one sits in the
    // sync loop.
    mockClient = { isFeatureEnabled };
    isFeatureEnabled.mockImplementation(() => {
      throw new Error('not initialized');
    });

    expect(() => isGuestPhoneSharingEnabled()).not.toThrow();
    expect(isGuestPhoneSharingEnabled()).toBe(false);
  });
});
