/**
 * @fileoverview Tests for the "tell the others" queue.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  flushTripNotifications,
  requestTripNotification,
  TRIP_NOTIFY_QUEUE_KEY,
} from '../trip-notify';

const TRIP = { remoteTripId: '0b9e8c1a-3f2d-4c5b-9a8e-7d6c5b4a3f2e', viewerToken: undefined };
const ORIGIN = 'https://share.example.test';

function queued(): { kind: string; subjectId: string; attempts: number }[] {
  return JSON.parse(localStorage.getItem(TRIP_NOTIFY_QUEUE_KEY) ?? '[]');
}

function answer(status: number): typeof fetch {
  return vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch;
}

const flush = (fetchImpl: typeof fetch, token: string | null = 'token-1') =>
  flushTripNotifications({ origin: ORIGIN, fetch: fetchImpl, readToken: async () => token });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_SHARE_ORIGIN', ORIGIN);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('requestTripNotification', () => {
  it('queues an ask for a shared trip', () => {
    requestTripNotification(TRIP, { kind: 'money_line', subjectId: 'line-1' });

    expect(queued()).toMatchObject([{ kind: 'money_line', subjectId: 'line-1', attempts: 0 }]);
  });

  it('asks nothing for a trip nobody else is on, a viewer trip, or a build without the server', () => {
    requestTripNotification({ remoteTripId: undefined, viewerToken: undefined }, { kind: 'money_line', subjectId: 'a' });
    requestTripNotification({ ...TRIP, viewerToken: 'invite-token' }, { kind: 'money_line', subjectId: 'b' });
    vi.stubEnv('VITE_SHARE_ORIGIN', '');
    requestTripNotification(TRIP, { kind: 'money_line', subjectId: 'c' });

    expect(queued()).toEqual([]);
  });

  it('makes one ask of the same change asked twice', () => {
    requestTripNotification(TRIP, { kind: 'money_line', subjectId: 'line-1' });
    requestTripNotification(TRIP, { kind: 'money_line', subjectId: 'line-1' });
    requestTripNotification(TRIP, { kind: 'activity_invite', subjectId: 'line-1' });

    expect(queued()).toHaveLength(2);
  });
});

describe('flushTripNotifications', () => {
  it('asks the server with the member token, and forgets the ask once told', async () => {
    requestTripNotification(TRIP, { kind: 'activity_invite', subjectId: 'act-1' });
    const send = answer(200);

    await flush(send);

    expect(send).toHaveBeenCalledWith(`${ORIGIN}/push/notify`, {
      method: 'POST',
      headers: { authorization: 'Bearer token-1', 'content-type': 'application/json' },
      body: JSON.stringify({ trip_id: TRIP.remoteTripId, kind: 'activity_invite', subject_id: 'act-1' }),
    });
    expect(queued()).toEqual([]);
  });

  it('keeps an ask the server cannot answer yet, and gives up after a while', async () => {
    requestTripNotification(TRIP, { kind: 'money_line', subjectId: 'line-1' });

    await flush(answer(409));
    expect(queued()).toMatchObject([{ attempts: 1 }]);

    for (let attempt = 0; attempt < 10; attempt++) {
      await flush(answer(409));
    }
    expect(queued()).toEqual([]);
  });

  it('forgets an ask the server refuses', async () => {
    requestTripNotification(TRIP, { kind: 'money_line', subjectId: 'line-1' });

    await flush(answer(403));

    expect(queued()).toEqual([]);
  });

  it('keeps every ask, unchanged, while offline or with the server down', async () => {
    requestTripNotification(TRIP, { kind: 'money_line', subjectId: 'line-1' });

    await flush(vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    await flush(answer(502));

    expect(queued()).toMatchObject([{ attempts: 0 }]);
  });

  it('waits for somebody to sign in', async () => {
    requestTripNotification(TRIP, { kind: 'money_line', subjectId: 'line-1' });
    const send = answer(200);

    await flush(send, null);

    expect(send).not.toHaveBeenCalled();
    expect(queued()).toHaveLength(1);
  });
});
