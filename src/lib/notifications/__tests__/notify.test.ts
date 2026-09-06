/**
 * @fileoverview Tests for posting a ride notice to the operating system.
 *
 * jsdom provides neither `Notification` nor `navigator.serviceWorker`, so each
 * test installs exactly the pieces it needs — and their absence is itself under
 * test, because a desktop browser with no worker and an iPhone outside a
 * Home Screen install are normal states rather than errors.
 *
 * Dexie is real (fake-indexeddb), so the dedupe assertions run against the same
 * `rideNotices` rows the app writes.
 *
 * @module lib/notifications/__tests__/notify.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import {
  markNoticeFired,
  markTransportSeen,
  rideNoticeKey,
} from '@/lib/db/repositories/ride-notice-repository';
import type { RideId, TransportId, TripId } from '@/types';

import { notify } from '../notify';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip_notify' as TripId,
  RIDE_ID = 'ride_airport' as RideId,
  TRANSPORT_ID = 'transport_alice' as TransportId,
  LEAVE_KEY = rideNoticeKey('leave', RIDE_ID);

/** The one ride notice every test posts unless it says otherwise. */
const LEAVE_NOTICE = {
  tripId: TRIP_ID,
  kind: 'leave',
  subjectId: RIDE_ID,
  title: 'rides.leaveAt',
  body: 'rides.meetAt',
} as const;

// ============================================================================
// Helpers
// ============================================================================

type ShowNotification = (
  title: string,
  options?: NotificationOptions,
) => Promise<void>;

function setPermission(permission: string | undefined): void {
  if (permission === undefined) {
    Reflect.deleteProperty(globalThis, 'Notification');
    return;
  }

  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: { permission },
  });
}

/**
 * Installs a service worker container.
 *
 * Passing `undefined` for the registration models the load before the worker
 * has installed; omitting the container entirely models a browser without one.
 */
function setServiceWorker(
  registration: { showNotification: ShowNotification } | undefined,
): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: { getRegistration: () => Promise.resolve(registration) },
  });
}

function removeServiceWorker(): void {
  Reflect.deleteProperty(navigator, 'serviceWorker');
}

function createRegistration(
  showNotification: ShowNotification = () => Promise.resolve(),
) {
  return { showNotification: vi.fn<ShowNotification>(showNotification) };
}

// ============================================================================
// Tests
// ============================================================================

describe('notify', () => {
  beforeEach(() => {
    setPermission('granted');
  });

  afterEach(() => {
    setPermission(undefined);
    removeServiceWorker();
    vi.restoreAllMocks();
  });

  describe('when it must stay silent', () => {
    it('no-ops instead of throwing when the browser has no Notification API', async () => {
      setPermission(undefined);
      const registration = createRegistration();
      setServiceWorker(registration);

      await expect(notify(LEAVE_NOTICE)).resolves.toBe(false);
      expect(registration.showNotification).not.toHaveBeenCalled();
    });

    it('no-ops when nobody has opted in yet', async () => {
      setPermission('default');
      const registration = createRegistration();
      setServiceWorker(registration);

      await expect(notify(LEAVE_NOTICE)).resolves.toBe(false);
      expect(registration.showNotification).not.toHaveBeenCalled();
    });

    it('no-ops when permission was denied', async () => {
      setPermission('denied');
      const registration = createRegistration();
      setServiceWorker(registration);

      await expect(notify(LEAVE_NOTICE)).resolves.toBe(false);
      expect(registration.showNotification).not.toHaveBeenCalled();
    });

    it('no-ops when the browser registers no service worker at all', async () => {
      removeServiceWorker();

      await expect(notify(LEAVE_NOTICE)).resolves.toBe(false);
    });

    it('no-ops when no worker has installed yet', async () => {
      setServiceWorker(undefined);

      await expect(notify(LEAVE_NOTICE)).resolves.toBe(false);
    });

    it('records nothing when it stayed silent', async () => {
      setPermission('denied');
      setServiceWorker(createRegistration());

      await notify(LEAVE_NOTICE);

      await expect(db.rideNotices.get(LEAVE_KEY)).resolves.toBeUndefined();
    });
  });

  describe('when it posts', () => {
    it('shows the notice through the registration and records the fire', async () => {
      const registration = createRegistration();
      setServiceWorker(registration);

      await expect(notify(LEAVE_NOTICE)).resolves.toBe(true);

      expect(registration.showNotification).toHaveBeenCalledTimes(1);
      const [title, options] = registration.showNotification.mock.calls[0] ?? [];
      expect(title).toBe('rides.leaveAt');
      expect(options?.body).toBe('rides.meetAt');

      const row = await db.rideNotices.get(LEAVE_KEY);
      expect(row?.tripId).toBe(TRIP_ID);
      expect(typeof row?.firedAtMs).toBe('number');
    });

    it('tags with the notice key so a re-fire replaces rather than stacks', async () => {
      const registration = createRegistration();
      setServiceWorker(registration);

      await notify(LEAVE_NOTICE);

      const [, options] = registration.showNotification.mock.calls[0] ?? [];
      expect(options?.tag).toBe(LEAVE_KEY);
    });

    it('defaults the click target to the trip transports page', async () => {
      const registration = createRegistration();
      setServiceWorker(registration);

      await notify(LEAVE_NOTICE);

      const [, options] = registration.showNotification.mock.calls[0] ?? [];
      expect(options?.data).toEqual({ url: `trips/${TRIP_ID}/transports` });
    });

    it('strips a leading slash so a click resolves under the app base', async () => {
      // A '/'-prefixed path resolved against the worker's scope escapes to the
      // host root, which is the wrong page on a sub-path deploy. The click
      // handler resolves relative, so the slash must not survive to it.
      const registration = createRegistration();
      setServiceWorker(registration);

      await notify({ ...LEAVE_NOTICE, path: '/trips/abc/transports' });

      const [, options] = registration.showNotification.mock.calls[0] ?? [];
      expect(options?.data).toEqual({ url: 'trips/abc/transports' });
    });
  });

  describe('dedupe', () => {
    it('does not fire a notice markNoticeFired already recorded', async () => {
      await markNoticeFired(TRIP_ID, 'leave', RIDE_ID, 1_700_000_000_000);

      const registration = createRegistration();
      setServiceWorker(registration);

      await expect(notify(LEAVE_NOTICE)).resolves.toBe(false);
      expect(registration.showNotification).not.toHaveBeenCalled();
    });

    it('announces one due ride exactly once however often it is asked', async () => {
      const registration = createRegistration();
      setServiceWorker(registration);

      const results = [
        await notify(LEAVE_NOTICE),
        await notify(LEAVE_NOTICE),
        await notify(LEAVE_NOTICE),
      ];

      expect(results).toEqual([true, false, false]);
      expect(registration.showNotification).toHaveBeenCalledTimes(1);
    });

    it('speaks again about a leg the user has since acknowledged', async () => {
      // `markTransportSeen` writes a fresh watermark row and so drops
      // `firedAtMs`. That is what lets a passenger who moves their time twice
      // be announced twice, without every clock tick re-announcing the first
      // move in between.
      const registration = createRegistration();
      setServiceWorker(registration);

      const moved = {
        tripId: TRIP_ID,
        kind: 'moved',
        subjectId: TRANSPORT_ID,
        title: 'rides.legMismatch.after',
        body: 'rides.meetAt',
      } as const;

      await expect(notify(moved)).resolves.toBe(true);
      await expect(notify(moved)).resolves.toBe(false);

      await markTransportSeen(TRIP_ID, TRANSPORT_ID, '2026-09-06T17:00');

      await expect(notify(moved)).resolves.toBe(true);
      expect(registration.showNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('failure', () => {
    it('reports a rejected showNotification rather than throwing into the app', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setServiceWorker(
        createRegistration(() => Promise.reject(new Error('no permission'))),
      );

      await expect(notify(LEAVE_NOTICE)).resolves.toBe(false);
      expect(warn).toHaveBeenCalled();
    });

    it('leaves the notice unrecorded so a later attempt can retry', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      setServiceWorker(
        createRegistration(() => Promise.reject(new Error('no permission'))),
      );

      await notify(LEAVE_NOTICE);

      await expect(db.rideNotices.get(LEAVE_KEY)).resolves.toBeUndefined();
    });
  });
});
