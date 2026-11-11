/**
 * Tests for loadSamplePhotos.
 *
 * The loader runs before the first paint of a first open, so the rules it is
 * held to are about failure: it never throws, it never waits past its
 * timeout, and it never hands over something that is not a picture.
 *
 * @module features/trips/utils/__tests__/sample-trip-photos.test
 */
import { describe, expect, it, vi } from 'vitest';

import {
  SAMPLE_PHOTO_SUBJECTS,
  SAMPLE_PHOTO_URLS,
  loadSamplePhotos,
} from '../sample-trip-photos';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The two members of a Response the loader reads. A real `Response` built
 * from a jsdom Blob loses the blob's type, so the fake is the honest one here.
 */
function answer(blob: Blob, ok = true): Response {
  return { ok, blob: async () => blob } as unknown as Response;
}

function imageResponse(body = 'bytes'): Response {
  return answer(new Blob([body], { type: 'image/webp' }));
}

// ============================================================================
// Tests
// ============================================================================

describe('loadSamplePhotos', () => {
  it('has one picture for the trip and one for each of its five rooms', () => {
    expect([...SAMPLE_PHOTO_SUBJECTS].sort()).toEqual(
      ['bunk', 'house', 'master', 'sofa', 'tent', 'twin'],
    );
    expect(new Set(Object.values(SAMPLE_PHOTO_URLS)).size).toBe(SAMPLE_PHOTO_SUBJECTS.length);
  });

  it('fetches every picture from the address the build gave it', async () => {
    const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => imageResponse());

    const photos = await loadSamplePhotos(fetcher as unknown as typeof fetch);

    expect(Object.keys(photos).sort()).toEqual([...SAMPLE_PHOTO_SUBJECTS].sort());
    expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual(
      Object.values(SAMPLE_PHOTO_URLS).sort(),
    );
    expect(photos.house?.type).toBe('image/webp');
  });

  it('leaves out a picture that fails, and keeps the others', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === SAMPLE_PHOTO_URLS.house) {
        throw new TypeError('Failed to fetch');
      }
      if (url === SAMPLE_PHOTO_URLS.tent) {
        return answer(new Blob(['gone'], { type: 'image/webp' }), false);
      }
      return imageResponse();
    });

    const photos = await loadSamplePhotos(fetcher as unknown as typeof fetch);

    expect(photos.house).toBeUndefined();
    expect(photos.tent).toBeUndefined();
    expect(Object.keys(photos).sort()).toEqual(['bunk', 'master', 'sofa', 'twin']);
  });

  it('refuses an answer that is not a picture, or is empty', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === SAMPLE_PHOTO_URLS.house) {
        // A host that serves its HTML shell for an unknown path.
        return answer(new Blob(['<html>'], { type: 'text/html' }));
      }
      if (url === SAMPLE_PHOTO_URLS.tent) {
        return answer(new Blob([], { type: 'image/webp' }));
      }
      return imageResponse();
    });

    const photos = await loadSamplePhotos(fetcher as unknown as typeof fetch);

    expect(photos.house).toBeUndefined();
    expect(photos.tent).toBeUndefined();
    expect(photos.master).toBeDefined();
  });

  it('gives up at the timeout and goes on without the pictures', async () => {
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    await expect(loadSamplePhotos(fetcher as unknown as typeof fetch, 5)).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(SAMPLE_PHOTO_SUBJECTS.length);
  });

  it('answers with nothing where there is no fetch at all', async () => {
    await expect(loadSamplePhotos(null as unknown as undefined)).resolves.toEqual({});
  });
});
