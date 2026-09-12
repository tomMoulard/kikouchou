/**
 * Tests for buildMapsUrl.
 *
 * @module lib/utils/__tests__/maps-link.test
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { buildMapsUrl } from '../maps-link';

/**
 * Points `navigator` at a platform for one test.
 *
 * `navigator.platform` is read-only, so it is redefined rather than assigned.
 */
function setPlatform(platform: string, userAgent: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildMapsUrl', () => {
  const coordinates = { lat: 48.8566, lon: 2.3522 };

  it('sends Apple platforms to Apple Maps', () => {
    setPlatform('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');

    const url = buildMapsUrl(coordinates, 'Beach house');

    expect(url).toContain('https://maps.apple.com/');
    expect(url).toContain('ll=48.8566,2.3522');
  });

  it('sends everything else to Google Maps', () => {
    setPlatform('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');

    const url = buildMapsUrl(coordinates, 'Beach house');

    expect(url).toContain('https://www.google.com/maps/search/');
    expect(url).toContain('query=48.8566,2.3522');
  });

  // The coordinate is the authoritative part: a name alone can resolve to a
  // different town entirely, which is the whole reason the pin is dropped by
  // latitude and longitude.
  it('locates by coordinate, not by name', () => {
    setPlatform('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');

    expect(buildMapsUrl(coordinates, 'Somewhere else')).toContain('48.8566,2.3522');
  });

  it('escapes a label rather than pasting it into the query string', () => {
    setPlatform('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');

    // A location name is free text, and on a shared trip a peer typed it.
    const url = buildMapsUrl(coordinates, 'Chez Léa & co?x=1');

    expect(url).toContain('q=Chez%20L%C3%A9a%20%26%20co%3Fx%3D1');
  });

  it('omits the label when there is none', () => {
    setPlatform('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');

    expect(buildMapsUrl(coordinates)).toBe('https://maps.apple.com/?ll=48.8566,2.3522');
  });

  it('handles southern and western hemispheres', () => {
    setPlatform('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');

    expect(buildMapsUrl({ lat: -33.8688, lon: -151.2093 })).toContain(
      'query=-33.8688,-151.2093',
    );
  });
});
