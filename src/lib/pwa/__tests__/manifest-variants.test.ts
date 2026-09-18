/**
 * @fileoverview The manifest variant an iPhone installs the invite from.
 *
 * @module lib/pwa/__tests__/manifest-variants.test
 */

import { describe, expect, it } from 'vitest';

import { HERE_MANIFEST_FILENAME, withoutStartUrl } from '@/lib/pwa/manifest-variants';

describe('withoutStartUrl', () => {
  const manifest = {
    name: 'Kikouchou',
    short_name: 'Kikouchou',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    icons: [{ src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };

  it('drops start_url and nothing else', () => {
    const variant = withoutStartUrl(manifest);

    // No `start_url` is what makes Safari open the Home Screen app on the page
    // it was added from — the invite — instead of the app root.
    expect(variant).not.toHaveProperty('start_url');
    expect(variant).toEqual({
      name: 'Kikouchou',
      short_name: 'Kikouchou',
      id: '/',
      scope: '/',
      display: 'standalone',
      icons: manifest.icons,
    });
  });

  it('keeps the scope, so the installed app is not scoped to the invite page', () => {
    // With no `start_url` and no `scope`, a browser scopes the app to the
    // directory of the page it was added from — `/join/` — and every trip
    // page would open outside the app.
    expect(withoutStartUrl(manifest).scope).toBe('/');
  });

  it('keeps the id, so both manifests install one app', () => {
    // Without `id` the identity would fall back to `start_url`, and an install
    // from the join page would be a second app rather than this one.
    expect(withoutStartUrl(manifest).id).toBe('/');
  });

  it('does not touch the manifest it was given', () => {
    withoutStartUrl(manifest);

    expect(manifest.start_url).toBe('/');
  });

  it('names the file the join page points at', () => {
    expect(HERE_MANIFEST_FILENAME).toBe('manifest-here.webmanifest');
  });
});
