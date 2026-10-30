/**
 * @fileoverview Tests for the photos a trip template carries.
 *
 * A template's photos are read by strangers through the template token, so
 * three things are under test: the ids travel in the payload and are bounded
 * on the way back in, the copy into `templates/<token>/` happens only for a
 * published template, and a photo already there is not sent again.
 *
 * @module lib/sync/__tests__/templates-photos.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPhoto } from '@/lib/db/repositories/photo-repository';
import { fetchTripPhoto } from '@/lib/photos/photo-sync';
import { uploadPhoto } from '@/lib/photos/storage';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type { PhotoId, Trip, TripId } from '@/types';

import {
  buildTemplatePayload,
  publishTemplate,
  readTripTemplate,
  templatePhotoIds,
  uploadTemplatePhotos,
  type TripTemplatePayload,
} from '../templates';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/db', () => ({
  getRoomsByTripId: vi.fn(async () => [
    { id: 'r1', name: 'Red room', capacity: 2, icon: 'bed-double', photoId: 'roomPhoto0001' },
    { id: 'r2', name: 'Plain room', capacity: 1 },
  ]),
}));

vi.mock('@/lib/db/repositories/photo-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/repositories/photo-repository')>()),
  getPhoto: vi.fn(),
}));

vi.mock('@/lib/photos/photo-sync', () => ({ fetchTripPhoto: vi.fn() }));

vi.mock('@/lib/photos/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/photos/storage')>()),
  uploadPhoto: vi.fn(async () => undefined),
}));

const COVER = 'coverPhoto0001' as PhotoId;
const ROOM = 'roomPhoto0001' as PhotoId;
const TOKEN = 'tokentokentoken1';
const TRIP = { id: 'local-trip' as TripId, remoteTripId: 'remote-1' };

const PAYLOAD: TripTemplatePayload = {
  name: 'Chalet',
  description: null,
  location: null,
  coordinates: null,
  currency: null,
  photoId: COVER,
  rooms: [
    { name: 'Red room', capacity: 2, icon: 'bed-double', photoId: ROOM },
    { name: 'Same photo', capacity: 2, icon: 'bed-double', photoId: COVER },
  ],
};

interface ClientOptions {
  readonly tripRow?: unknown;
  readonly listed?: readonly string[];
}

function stubClient({ tripRow, listed = [] }: ClientOptions) {
  const list = vi.fn(async () => ({ data: listed.map((name) => ({ name })), error: null }));
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: tripRow ?? null, error: null }) }),
      }),
    }),
    storage: { from: () => ({ list }) },
  } as unknown as TypedSupabaseClient;
  return { client, list };
}

const PUBLISHED = { is_template: true, template_token: TOKEN, owner_id: 'owner' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPhoto).mockImplementation(async (tripId, photoId) => ({
    tripId,
    id: photoId,
    blob: new Blob([photoId], { type: 'image/webp' }),
    pending: 0,
    createdAt: 1,
  }));
});

// ============================================================================
// Tests
// ============================================================================

describe('the payload carries the photo ids', () => {
  it('reads the cover and each room photo off the trip', async () => {
    const payload = await buildTemplatePayload({
      id: 'local-trip',
      name: 'Chalet',
      photoId: COVER,
    } as Trip);

    expect(payload.photoId).toBe(COVER);
    expect(payload.rooms).toEqual([
      { name: 'Red room', capacity: 2, icon: 'bed-double', photoId: ROOM },
      { name: 'Plain room', capacity: 1, icon: 'bed-double' },
    ]);
  });

  it('writes them to the row the server checks', async () => {
    const upserts: unknown[] = [];
    const client = {
      from: () => ({
        upsert: async (row: unknown) => {
          upserts.push(row);
          return { error: null };
        },
        update: () => ({
          eq: () => ({ select: async () => ({ data: [{ template_token: TOKEN }], error: null }) }),
        }),
      }),
    } as unknown as TypedSupabaseClient;

    await publishTemplate(client, 'remote-1', PAYLOAD, TOKEN);

    expect(upserts[0]).toMatchObject({
      photo_id: COVER,
      rooms: [
        { name: 'Red room', photoId: ROOM },
        { name: 'Same photo', photoId: COVER },
      ],
    });
  });

  it('lists every photo once, cover first', () => {
    expect(templatePhotoIds(PAYLOAD)).toEqual([COVER, ROOM]);
    expect(templatePhotoIds({ ...PAYLOAD, photoId: null, rooms: [] })).toEqual([]);
  });

  it('drops a photo id from the server that is not shaped like one', async () => {
    const client = {
      rpc: async () => ({
        data: {
          name: 'Chalet',
          photoId: '../../trips/other/photo',
          rooms: [{ name: 'Attic', capacity: 2, photoId: 'roomPhoto0001' }, { name: 'Loft', capacity: 1, photoId: 7 }],
        },
        error: null,
      }),
    } as unknown as TypedSupabaseClient;

    const result = await readTripTemplate(client, TOKEN);

    expect(result.status === 'ok' && result.template.photoId).toBeNull();
    expect(result.status === 'ok' && result.template.rooms).toEqual([
      { name: 'Attic', capacity: 2, icon: 'bed-double', photoId: ROOM },
      { name: 'Loft', capacity: 1, icon: 'bed-double' },
    ]);
  });
});

describe('uploadTemplatePhotos', () => {
  it('copies each photo into the template prefix', async () => {
    const { client, list } = stubClient({ tripRow: PUBLISHED });

    const failed = await uploadTemplatePhotos(client, TRIP, PAYLOAD);

    expect(failed).toBe(0);
    expect(list).toHaveBeenCalledWith(`templates/${TOKEN}`, { limit: 100 });
    expect(vi.mocked(uploadPhoto).mock.calls.map((call) => call[1])).toEqual([
      `templates/${TOKEN}/${COVER}`,
      `templates/${TOKEN}/${ROOM}`,
    ]);
  });

  it('does not send a photo the prefix already holds', async () => {
    const { client } = stubClient({ tripRow: PUBLISHED, listed: [COVER] });

    await uploadTemplatePhotos(client, TRIP, PAYLOAD);

    expect(vi.mocked(uploadPhoto).mock.calls.map((call) => call[1])).toEqual([
      `templates/${TOKEN}/${ROOM}`,
    ]);
  });

  it('does nothing for a template that is not published', async () => {
    const { client } = stubClient({ tripRow: { ...PUBLISHED, is_template: false } });

    await uploadTemplatePhotos(client, TRIP, PAYLOAD);

    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('counts every photo as failed when the template could not be read', async () => {
    const list = vi.fn();
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'Failed to fetch' } }),
          }),
        }),
      }),
      storage: { from: () => ({ list }) },
    } as unknown as TypedSupabaseClient;

    const failed = await uploadTemplatePhotos(client, TRIP, PAYLOAD);

    expect(failed).toBe(2);
    expect(list).not.toHaveBeenCalled();
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('does nothing without a photo or without a server trip', async () => {
    const { client, list } = stubClient({ tripRow: PUBLISHED });

    await uploadTemplatePhotos(client, TRIP, { ...PAYLOAD, photoId: null, rooms: [] });
    await uploadTemplatePhotos(client, { id: TRIP.id }, PAYLOAD);

    expect(list).not.toHaveBeenCalled();
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('fetches a photo this device does not hold before copying it', async () => {
    const { client } = stubClient({ tripRow: PUBLISHED });
    let fetched = false;
    vi.mocked(getPhoto).mockImplementation(async (tripId, photoId) =>
      photoId === ROOM && !fetched
        ? undefined
        : { tripId, id: photoId, blob: new Blob(['x']), pending: 0, createdAt: 1 },
    );
    vi.mocked(fetchTripPhoto).mockImplementation(async () => {
      fetched = true;
      return true;
    });

    const failed = await uploadTemplatePhotos(client, TRIP, PAYLOAD);

    expect(failed).toBe(0);
    expect(fetchTripPhoto).toHaveBeenCalledWith(client, TRIP.id, 'remote-1', ROOM);
    expect(uploadPhoto).toHaveBeenCalledTimes(2);
  });

  it('counts a photo it could not find or not send, and goes on', async () => {
    const { client } = stubClient({ tripRow: PUBLISHED });
    vi.mocked(getPhoto).mockImplementation(async (tripId, photoId) =>
      photoId === ROOM
        ? undefined
        : { tripId, id: photoId, blob: new Blob(['x']), pending: 0, createdAt: 1 },
    );
    vi.mocked(fetchTripPhoto).mockResolvedValue(false);
    vi.mocked(uploadPhoto).mockRejectedValueOnce(new Error('denied'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const failed = await uploadTemplatePhotos(client, TRIP, PAYLOAD);

    expect(failed).toBe(2);
  });
});
