/**
 * Extended tests for tile-cache async operations.
 * Tests preCacheTiles, getCacheStats, clearTileCache, isTileCached using mocked Cache API.
 *
 * @module lib/map/__tests__/tile-cache-async.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  preCacheTiles,
  getCacheStats,
  clearTileCache,
  isTileCached,
} from '@/lib/map/tile-cache';

// ============================================================================
// Cache API Mock
// ============================================================================

interface MockCache {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

let mockCache: MockCache;
let originalCaches: typeof globalThis.caches;

function setupCacheMock(): void {
  mockCache = {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };

  const mockCaches = {
    open: vi.fn().mockResolvedValue(mockCache),
    delete: vi.fn().mockResolvedValue(true),
    has: vi.fn().mockResolvedValue(false),
    keys: vi.fn().mockResolvedValue([]),
    match: vi.fn().mockResolvedValue(undefined),
  };

  Object.defineProperty(globalThis, 'caches', {
    value: mockCaches,
    configurable: true,
  });
}

function removeCacheMock(): void {
  Object.defineProperty(globalThis, 'caches', {
    value: undefined,
    configurable: true,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('tile-cache async operations', () => {
  beforeEach(() => {
    originalCaches = globalThis.caches;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    if (originalCaches) {
      Object.defineProperty(globalThis, 'caches', {
        value: originalCaches,
        configurable: true,
      });
    }
    vi.restoreAllMocks();
  });

  describe('preCacheTiles', () => {
    it('returns zero totals when Cache API is unavailable', async () => {
      removeCacheMock();

      const result = await preCacheTiles({ lat: 48.8566, lon: 2.3522 });

      expect(result.cached).toBe(0);
      expect(result.total).toBe(0);
      expect(result.cancelled).toBe(false);
    });

    it('caches tiles when Cache API is available', async () => {
      setupCacheMock();

      const result = await preCacheTiles(
        { lat: 48.8566, lon: 2.3522 },
        { zoomLevels: [14], radiusTiles: 0, maxTiles: 1 }
      );

      expect(result.total).toBe(1);
      expect(result.cached).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.cancelled).toBe(false);
      expect(result.estimatedBytes).toBeGreaterThan(0);
    });

    it('skips already-cached tiles', async () => {
      setupCacheMock();
      mockCache.match.mockResolvedValue(new Response('cached'));

      const result = await preCacheTiles(
        { lat: 48.8566, lon: 2.3522 },
        { zoomLevels: [14], radiusTiles: 0, maxTiles: 1 }
      );

      expect(result.cached).toBe(1);
      // fetch should not have been called since tile is already cached
      expect(fetch).not.toHaveBeenCalled();
    });

    it('counts failed tiles when fetch fails', async () => {
      setupCacheMock();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

      const result = await preCacheTiles(
        { lat: 48.8566, lon: 2.3522 },
        { zoomLevels: [14], radiusTiles: 0, maxTiles: 1 }
      );

      expect(result.failed).toBe(1);
      expect(result.cached).toBe(0);
    });

    it('counts failed tiles when fetch throws', async () => {
      setupCacheMock();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await preCacheTiles(
        { lat: 48.8566, lon: 2.3522 },
        { zoomLevels: [14], radiusTiles: 0, maxTiles: 1 }
      );

      expect(result.failed).toBe(1);
      expect(result.cached).toBe(0);
    });

    it('calls onProgress callback', async () => {
      setupCacheMock();
      const onProgress = vi.fn();

      await preCacheTiles(
        { lat: 48.8566, lon: 2.3522 },
        { zoomLevels: [14], radiusTiles: 0, maxTiles: 1, onProgress }
      );

      expect(onProgress).toHaveBeenCalled();
    });

    it('supports cancellation via AbortSignal', async () => {
      setupCacheMock();
      const controller = new AbortController();
      controller.abort();

      const result = await preCacheTiles(
        { lat: 48.8566, lon: 2.3522 },
        { zoomLevels: [14], radiusTiles: 0, maxTiles: 1, signal: controller.signal }
      );

      expect(result.cancelled).toBe(true);
    });

    it('handles cache open failure', async () => {
      setupCacheMock();
      (globalThis.caches.open as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Cache open failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await preCacheTiles(
        { lat: 48.8566, lon: 2.3522 },
        { zoomLevels: [14], radiusTiles: 0, maxTiles: 1 }
      );

      expect(result.cached).toBe(0);
      consoleSpy.mockRestore();
    });
  });

  describe('getCacheStats', () => {
    it('returns zero stats when Cache API is unavailable', async () => {
      removeCacheMock();

      const stats = await getCacheStats();

      expect(stats.tileCount).toBe(0);
      expect(stats.cacheAvailable).toBe(false);
    });

    it('returns tile count when cache is available', async () => {
      setupCacheMock();
      mockCache.keys.mockResolvedValue([{}, {}, {}]); // 3 cached tiles

      const stats = await getCacheStats();

      expect(stats.tileCount).toBe(3);
      expect(stats.estimatedBytes).toBe(3 * 20 * 1024);
      expect(stats.cacheAvailable).toBe(true);
    });

    it('handles cache open failure gracefully', async () => {
      setupCacheMock();
      (globalThis.caches.open as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const stats = await getCacheStats();

      expect(stats.tileCount).toBe(0);
      expect(stats.cacheAvailable).toBe(true);
    });
  });

  describe('clearTileCache', () => {
    it('returns false when Cache API is unavailable', async () => {
      removeCacheMock();

      const result = await clearTileCache();

      expect(result).toBe(false);
    });

    it('deletes cache when available', async () => {
      setupCacheMock();

      const result = await clearTileCache();

      expect(result).toBe(true);
      expect(globalThis.caches.delete).toHaveBeenCalledWith('osm-tiles');
    });

    it('handles delete failure gracefully', async () => {
      setupCacheMock();
      (globalThis.caches.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const result = await clearTileCache();

      expect(result).toBe(false);
    });
  });

  describe('isTileCached', () => {
    it('returns false when Cache API is unavailable', async () => {
      removeCacheMock();

      const result = await isTileCached({ x: 0, y: 0, z: 10 });

      expect(result).toBe(false);
    });

    it('returns true when tile is in cache', async () => {
      setupCacheMock();
      mockCache.match.mockResolvedValue(new Response('cached'));

      const result = await isTileCached({ x: 525, y: 358, z: 10 });

      expect(result).toBe(true);
    });

    it('returns false when tile is not in cache', async () => {
      setupCacheMock();
      mockCache.match.mockResolvedValue(undefined);

      const result = await isTileCached({ x: 525, y: 358, z: 10 });

      expect(result).toBe(false);
    });

    it('handles cache open failure gracefully', async () => {
      setupCacheMock();
      (globalThis.caches.open as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const result = await isTileCached({ x: 0, y: 0, z: 10 });

      expect(result).toBe(false);
    });
  });
});
