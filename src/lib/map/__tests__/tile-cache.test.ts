/**
 * Tests for map tile caching utilities.
 *
 * @module lib/map/__tests__/tile-cache.test
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  latLonToTile,
  getTileUrl,
  getTilesToCache,
  estimateCacheSize,
  formatBytes,
  isCacheAvailable,
  OSM_CACHE_NAME,
  DEFAULT_ZOOM_LEVELS,
  MAX_TILES_PER_OPERATION,
} from '@/lib/map/tile-cache';

// ============================================================================
// Constants Tests
// ============================================================================

describe('tile-cache constants', () => {
  it('exports OSM_CACHE_NAME', () => {
    expect(OSM_CACHE_NAME).toBe('osm-tiles');
  });

  it('exports DEFAULT_ZOOM_LEVELS', () => {
    expect(DEFAULT_ZOOM_LEVELS).toEqual([10, 11, 12, 13, 14, 15, 16]);
  });

  it('exports MAX_TILES_PER_OPERATION', () => {
    expect(MAX_TILES_PER_OPERATION).toBe(200);
  });
});

// ============================================================================
// latLonToTile Tests
// ============================================================================

describe('latLonToTile', () => {
  it('converts Paris coordinates at zoom 10', () => {
    const tile = latLonToTile(48.8566, 2.3522, 10);
    
    expect(tile.z).toBe(10);
    // Paris is roughly at x=525, y=358 at zoom 10
    expect(tile.x).toBeGreaterThan(500);
    expect(tile.x).toBeLessThan(550);
    expect(tile.y).toBeGreaterThan(350);
    expect(tile.y).toBeLessThan(400);
  });

  it('converts Paris coordinates at zoom 16', () => {
    const tile = latLonToTile(48.8566, 2.3522, 16);
    
    expect(tile.z).toBe(16);
    // Higher zoom = more tiles
    expect(tile.x).toBeGreaterThan(33000);
    expect(tile.y).toBeGreaterThan(22000);
  });

  it('handles equator and prime meridian (0, 0)', () => {
    const tile = latLonToTile(0, 0, 10);
    
    expect(tile.z).toBe(10);
    // Center of the world at zoom 10 = 512 tiles per axis, center is 512
    expect(tile.x).toBe(512);
    expect(tile.y).toBe(512);
  });

  it('handles negative coordinates (Buenos Aires)', () => {
    const tile = latLonToTile(-34.6037, -58.3816, 10);
    
    expect(tile.z).toBe(10);
    expect(tile.x).toBeGreaterThan(0);
    expect(tile.y).toBeGreaterThan(0);
  });

  it('clamps coordinates to valid range', () => {
    // Extreme latitude
    const tileNorth = latLonToTile(89.9, 0, 5);
    expect(tileNorth.y).toBeGreaterThanOrEqual(0);
    expect(tileNorth.y).toBeLessThan(32); // 2^5 = 32

    const tileSouth = latLonToTile(-89.9, 0, 5);
    expect(tileSouth.y).toBeGreaterThanOrEqual(0);
    expect(tileSouth.y).toBeLessThan(32);
  });

  it('handles longitude at -180 and 180', () => {
    const tileWest = latLonToTile(0, -180, 5);
    expect(tileWest.x).toBe(0);

    const tileEast = latLonToTile(0, 179.9, 5);
    expect(tileEast.x).toBe(31); // 2^5 - 1
  });

  it('returns correct zoom level', () => {
    for (let z = 0; z <= 19; z++) {
      const tile = latLonToTile(48.8566, 2.3522, z);
      expect(tile.z).toBe(z);
    }
  });
});

// ============================================================================
// getTileUrl Tests
// ============================================================================

describe('getTileUrl', () => {
  it('generates correct URL with default subdomain', () => {
    const url = getTileUrl({ x: 525, y: 358, z: 10 });
    
    expect(url).toBe('https://a.tile.openstreetmap.org/10/525/358.png');
  });

  it('generates correct URL with specified subdomain', () => {
    const url = getTileUrl({ x: 525, y: 358, z: 10 }, 'b');
    
    expect(url).toBe('https://b.tile.openstreetmap.org/10/525/358.png');
  });

  it('generates correct URL for zoom 0', () => {
    const url = getTileUrl({ x: 0, y: 0, z: 0 });
    
    expect(url).toBe('https://a.tile.openstreetmap.org/0/0/0.png');
  });

  it('generates correct URL for high zoom', () => {
    const url = getTileUrl({ x: 67890, y: 45678, z: 17 }, 'c');
    
    expect(url).toBe('https://c.tile.openstreetmap.org/17/67890/45678.png');
  });
});

// ============================================================================
// getTilesToCache Tests
// ============================================================================

describe('getTilesToCache', () => {
  it('returns tiles for default zoom levels', () => {
    const tiles = getTilesToCache({ lat: 48.8566, lon: 2.3522 });
    
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_OPERATION);
    
    // Should have tiles from multiple zoom levels
    const zoomLevels = new Set(tiles.map(t => t.z));
    expect(zoomLevels.size).toBeGreaterThan(1);
  });

  it('returns tiles for specified zoom levels', () => {
    const tiles = getTilesToCache(
      { lat: 48.8566, lon: 2.3522 },
      [12, 13],
      1
    );
    
    // All tiles should be at zoom 12 or 13
    tiles.forEach(tile => {
      expect([12, 13]).toContain(tile.z);
    });
  });

  it('respects maxTiles limit', () => {
    const maxTiles = 10;
    const tiles = getTilesToCache(
      { lat: 48.8566, lon: 2.3522 },
      [10, 11, 12, 13, 14, 15, 16],
      5,
      maxTiles
    );
    
    expect(tiles.length).toBeLessThanOrEqual(maxTiles);
  });

  it('generates tiles around center point', () => {
    const center = { lat: 48.8566, lon: 2.3522 };
    const tiles = getTilesToCache(center, [14], 2, 100);
    
    // Get center tile
    const centerTile = latLonToTile(center.lat, center.lon, 14);
    
    // All tiles should be within radius of center
    tiles.forEach(tile => {
      expect(Math.abs(tile.x - centerTile.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(tile.y - centerTile.y)).toBeLessThanOrEqual(2);
    });
  });

  it('returns unique tiles', () => {
    const tiles = getTilesToCache({ lat: 48.8566, lon: 2.3522 }, [12], 2);
    
    const uniqueKeys = new Set(
      tiles.map(t => `${t.z}/${t.x}/${t.y}`)
    );
    
    expect(uniqueKeys.size).toBe(tiles.length);
  });

  it('handles edge case at world boundary', () => {
    // Near date line
    const tiles = getTilesToCache({ lat: 0, lon: 179 }, [10], 1);
    
    // Should not include invalid tiles
    tiles.forEach(tile => {
      const maxCoord = Math.pow(2, tile.z);
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(maxCoord);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(maxCoord);
    });
  });
});

// ============================================================================
// estimateCacheSize Tests
// ============================================================================

describe('estimateCacheSize', () => {
  it('returns tile count and estimated bytes', () => {
    const result = estimateCacheSize({ lat: 48.8566, lon: 2.3522 }, [12], 1);
    
    expect(result.tileCount).toBeGreaterThan(0);
    expect(result.estimatedBytes).toBeGreaterThan(0);
    // Each tile is approximately 20KB
    expect(result.estimatedBytes).toBe(result.tileCount * 20 * 1024);
  });

  it('increases with more zoom levels', () => {
    const result1 = estimateCacheSize({ lat: 48.8566, lon: 2.3522 }, [12], 1);
    const result2 = estimateCacheSize({ lat: 48.8566, lon: 2.3522 }, [12, 13], 1);
    
    expect(result2.tileCount).toBeGreaterThan(result1.tileCount);
  });

  it('increases with larger radius', () => {
    const result1 = estimateCacheSize({ lat: 48.8566, lon: 2.3522 }, [12], 1);
    const result2 = estimateCacheSize({ lat: 48.8566, lon: 2.3522 }, [12], 3);
    
    expect(result2.tileCount).toBeGreaterThan(result1.tileCount);
  });
});

// ============================================================================
// formatBytes Tests
// ============================================================================

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500.0 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
});

// ============================================================================
// isCacheAvailable Tests
// ============================================================================

describe('isCacheAvailable', () => {
  const originalCaches = globalThis.caches;

  afterEach(() => {
    // Restore original
    if (originalCaches) {
      Object.defineProperty(globalThis, 'caches', {
        value: originalCaches,
        configurable: true,
      });
    }
  });

  it('returns true when Cache API is available', () => {
    // In test environment, caches might be mocked
    if (typeof caches !== 'undefined') {
      expect(isCacheAvailable()).toBe(true);
    }
  });

  it('returns false when Cache API is not available', () => {
    Object.defineProperty(globalThis, 'caches', {
      value: undefined,
      configurable: true,
    });

    expect(isCacheAvailable()).toBe(false);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('tile-cache integration', () => {
  it('can generate cacheable URLs from coordinates', () => {
    const center = { lat: 48.8566, lon: 2.3522 };
    const tiles = getTilesToCache(center, [14], 1, 10);
    
    tiles.forEach(tile => {
      const url = getTileUrl(tile);
      
      expect(url).toMatch(/^https:\/\/[abc]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
    });
  });

  it('provides consistent tile coordinates', () => {
    const center = { lat: 48.8566, lon: 2.3522 };
    const zoom = 14;
    
    // Get center tile
    const centerTile = latLonToTile(center.lat, center.lon, zoom);
    
    // Get tiles to cache
    const tiles = getTilesToCache(center, [zoom], 0, 1);
    
    // Single tile at radius 0 should be the center tile
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toEqual(centerTile);
  });
});
