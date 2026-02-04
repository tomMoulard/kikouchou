/**
 * @fileoverview Map tile caching utilities for offline map support.
 * Provides functions to pre-cache OSM tiles around a location and manage tile cache.
 *
 * @module lib/map/tile-cache
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * OpenStreetMap tile server URL template.
 * Uses {s} for subdomain (a, b, c), {z} for zoom, {x} and {y} for tile coordinates.
 */
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * Available subdomains for load balancing.
 */
const TILE_SUBDOMAINS = ['a', 'b', 'c'] as const;

/**
 * Cache name used by the service worker for OSM tiles.
 * Must match the cacheName in vite.config.ts runtimeCaching.
 */
export const OSM_CACHE_NAME = 'osm-tiles';

/**
 * Default zoom levels to cache for offline use.
 * - 10-12: Regional view (city/area level)
 * - 13-14: Neighborhood level
 * - 15-16: Street level detail
 */
export const DEFAULT_ZOOM_LEVELS = [10, 11, 12, 13, 14, 15, 16] as const;

/**
 * Maximum number of tiles to cache in a single pre-cache operation.
 * This prevents excessive network requests and storage usage.
 */
export const MAX_TILES_PER_OPERATION = 200;

/**
 * Approximate size of a single OSM tile in bytes (for estimation).
 */
const APPROX_TILE_SIZE_BYTES = 20 * 1024; // ~20KB average

// ============================================================================
// Types
// ============================================================================

/**
 * Coordinates for a location.
 */
export interface Coordinates {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Tile coordinates in the OSM tile system.
 */
export interface TileCoordinates {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Options for pre-caching tiles.
 */
export interface PreCacheOptions {
  /** Zoom levels to cache (default: 10-16) */
  readonly zoomLevels?: readonly number[];
  /** Radius in tiles around the center to cache at each zoom level */
  readonly radiusTiles?: number;
  /** Maximum total tiles to cache */
  readonly maxTiles?: number;
  /** Callback for progress updates */
  readonly onProgress?: (cached: number, total: number) => void;
  /** AbortSignal to cancel the operation */
  readonly signal?: AbortSignal;
}

/**
 * Result of a pre-cache operation.
 */
export interface PreCacheResult {
  /** Number of tiles successfully cached */
  readonly cached: number;
  /** Number of tiles that failed to cache */
  readonly failed: number;
  /** Total tiles attempted */
  readonly total: number;
  /** Whether the operation was cancelled */
  readonly cancelled: boolean;
  /** Estimated storage used in bytes */
  readonly estimatedBytes: number;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  /** Number of cached tiles */
  readonly tileCount: number;
  /** Estimated total size in bytes */
  readonly estimatedBytes: number;
  /** Whether the cache API is available */
  readonly cacheAvailable: boolean;
}

// ============================================================================
// Tile Coordinate Calculations
// ============================================================================

/**
 * Converts latitude/longitude to tile coordinates at a given zoom level.
 * Uses the Web Mercator projection formula.
 *
 * @param lat - Latitude in degrees
 * @param lon - Longitude in degrees
 * @param zoom - Zoom level (0-19)
 * @returns Tile coordinates
 *
 * @see https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */
export function latLonToTile(lat: number, lon: number, zoom: number): TileCoordinates {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );

  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
    z: zoom,
  };
}

/**
 * Generates the URL for a specific tile.
 *
 * @param tile - Tile coordinates
 * @param subdomain - Server subdomain to use (defaults to 'a')
 * @returns The full tile URL
 */
export function getTileUrl(tile: TileCoordinates, subdomain: string = 'a'): string {
  return OSM_TILE_URL.replace('{s}', subdomain)
    .replace('{z}', tile.z.toString())
    .replace('{x}', tile.x.toString())
    .replace('{y}', tile.y.toString());
}

/**
 * Generates a list of tiles to cache around a center point.
 *
 * @param center - Center coordinates
 * @param zoomLevels - Zoom levels to include
 * @param radiusTiles - Radius in tiles around center (default varies by zoom)
 * @param maxTiles - Maximum tiles to return
 * @returns Array of tile coordinates
 */
export function getTilesToCache(
  center: Coordinates,
  zoomLevels: readonly number[] = DEFAULT_ZOOM_LEVELS,
  radiusTiles?: number,
  maxTiles: number = MAX_TILES_PER_OPERATION
): readonly TileCoordinates[] {
  const tiles: TileCoordinates[] = [];

  for (const zoom of zoomLevels) {
    // Radius decreases at higher zoom levels to limit total tiles
    // At zoom 10: 2 tiles radius = 25 tiles
    // At zoom 16: 1 tile radius = 9 tiles
    const radius = radiusTiles ?? Math.max(1, Math.floor(3 - (zoom - 10) / 3));
    const centerTile = latLonToTile(center.lat, center.lon, zoom);
    const n = Math.pow(2, zoom);

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const x = centerTile.x + dx;
        const y = centerTile.y + dy;

        // Skip tiles outside valid range
        if (x >= 0 && x < n && y >= 0 && y < n) {
          tiles.push({ x, y, z: zoom });
        }

        // Stop if we've reached the limit
        if (tiles.length >= maxTiles) {
          return tiles;
        }
      }
    }
  }

  return tiles;
}

/**
 * Estimates the number of tiles and storage needed for caching an area.
 *
 * @param center - Center coordinates
 * @param zoomLevels - Zoom levels to include
 * @param radiusTiles - Radius in tiles
 * @returns Estimated tile count and storage size
 */
export function estimateCacheSize(
  center: Coordinates,
  zoomLevels: readonly number[] = DEFAULT_ZOOM_LEVELS,
  radiusTiles?: number
): { tileCount: number; estimatedBytes: number } {
  const tiles = getTilesToCache(center, zoomLevels, radiusTiles, Infinity);
  return {
    tileCount: tiles.length,
    estimatedBytes: tiles.length * APPROX_TILE_SIZE_BYTES,
  };
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Checks if the Cache API is available.
 */
export function isCacheAvailable(): boolean {
  return typeof caches !== 'undefined';
}

/**
 * Pre-caches tiles around a location for offline use.
 *
 * @param center - Center coordinates to cache around
 * @param options - Caching options
 * @returns Result of the pre-cache operation
 *
 * @example
 * ```typescript
 * const result = await preCacheTiles(
 *   { lat: 48.8566, lon: 2.3522 },
 *   {
 *     zoomLevels: [12, 13, 14],
 *     onProgress: (cached, total) => console.log(`${cached}/${total}`),
 *   }
 * );
 * console.log(`Cached ${result.cached} tiles`);
 * ```
 */
export async function preCacheTiles(
  center: Coordinates,
  options: PreCacheOptions = {}
): Promise<PreCacheResult> {
  const {
    zoomLevels = DEFAULT_ZOOM_LEVELS,
    radiusTiles,
    maxTiles = MAX_TILES_PER_OPERATION,
    onProgress,
    signal,
  } = options;

  // Check if Cache API is available
  if (!isCacheAvailable()) {
    return {
      cached: 0,
      failed: 0,
      total: 0,
      cancelled: false,
      estimatedBytes: 0,
    };
  }

  const tiles = getTilesToCache(center, zoomLevels, radiusTiles, maxTiles);
  const total = tiles.length;
  let cached = 0;
  let failed = 0;

  try {
    const cache = await caches.open(OSM_CACHE_NAME);

    for (let i = 0; i < tiles.length; i++) {
      // Check for cancellation
      if (signal?.aborted) {
        return {
          cached,
          failed,
          total,
          cancelled: true,
          estimatedBytes: cached * APPROX_TILE_SIZE_BYTES,
        };
      }

      const tile = tiles[i]!;
      // Distribute requests across subdomains for better performance
      const subdomain = TILE_SUBDOMAINS[i % TILE_SUBDOMAINS.length];
      const url = getTileUrl(tile, subdomain);

      try {
        // Check if already cached
        const existingResponse = await cache.match(url);
        if (existingResponse) {
          cached++;
          onProgress?.(cached + failed, total);
          continue;
        }

        // Fetch and cache the tile
        const response = await fetch(url, {
          signal,
          mode: 'cors',
          credentials: 'omit',
        });

        if (response.ok) {
          await cache.put(url, response);
          cached++;
        } else {
          failed++;
        }
      } catch (error) {
        // Network error or fetch aborted
        if (signal?.aborted) {
          return {
            cached,
            failed,
            total,
            cancelled: true,
            estimatedBytes: cached * APPROX_TILE_SIZE_BYTES,
          };
        }
        failed++;
      }

      onProgress?.(cached + failed, total);

      // Small delay to avoid overwhelming the server
      if (i < tiles.length - 1 && i % 10 === 9) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } catch (error) {
    // Cache open failed
    console.error('Failed to open tile cache:', error);
  }

  return {
    cached,
    failed,
    total,
    cancelled: false,
    estimatedBytes: cached * APPROX_TILE_SIZE_BYTES,
  };
}

/**
 * Gets statistics about the current tile cache.
 *
 * @returns Cache statistics
 */
export async function getCacheStats(): Promise<CacheStats> {
  if (!isCacheAvailable()) {
    return {
      tileCount: 0,
      estimatedBytes: 0,
      cacheAvailable: false,
    };
  }

  try {
    const cache = await caches.open(OSM_CACHE_NAME);
    const keys = await cache.keys();
    const tileCount = keys.length;

    return {
      tileCount,
      estimatedBytes: tileCount * APPROX_TILE_SIZE_BYTES,
      cacheAvailable: true,
    };
  } catch {
    return {
      tileCount: 0,
      estimatedBytes: 0,
      cacheAvailable: true,
    };
  }
}

/**
 * Clears all cached map tiles.
 *
 * @returns True if cache was cleared successfully
 */
export async function clearTileCache(): Promise<boolean> {
  if (!isCacheAvailable()) {
    return false;
  }

  try {
    return await caches.delete(OSM_CACHE_NAME);
  } catch {
    return false;
  }
}

/**
 * Checks if a specific tile is cached.
 *
 * @param tile - Tile coordinates to check
 * @returns True if the tile is cached
 */
export async function isTileCached(tile: TileCoordinates): Promise<boolean> {
  if (!isCacheAvailable()) {
    return false;
  }

  try {
    const cache = await caches.open(OSM_CACHE_NAME);
    const url = getTileUrl(tile);
    const response = await cache.match(url);
    return response !== undefined;
  } catch {
    return false;
  }
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Formats bytes into a human-readable string.
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}
