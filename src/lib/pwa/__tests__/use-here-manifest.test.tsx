/**
 * @fileoverview The manifest swap the invite page performs.
 *
 * @module lib/pwa/__tests__/use-here-manifest.test
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useHereManifest } from '@/lib/pwa/use-here-manifest';

function addManifestLink(href: string): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = href;
  document.head.append(link);
  return link;
}

afterEach(() => {
  document.head.querySelectorAll('link[rel="manifest"]').forEach((node) => node.remove());
});

describe('useHereManifest', () => {
  it('points the document at the manifest without a start_url', () => {
    const link = addManifestLink('/manifest.webmanifest');

    renderHook(() => useHereManifest());

    // An iPhone installing from this page must open the installed app *here*,
    // on the invite, and only a manifest with no start_url does that.
    expect(link.getAttribute('href')).toBe('/manifest-here.webmanifest');
  });

  it('puts the ordinary manifest back when the page is left', () => {
    const link = addManifestLink('/manifest.webmanifest');

    const { unmount } = renderHook(() => useHereManifest());
    unmount();

    expect(link.getAttribute('href')).toBe('/manifest.webmanifest');
  });

  it('touches nothing when disabled', () => {
    const link = addManifestLink('/manifest.webmanifest');

    renderHook(() => useHereManifest(false));

    expect(link.getAttribute('href')).toBe('/manifest.webmanifest');
  });

  it('adds no manifest where the document declared none', () => {
    renderHook(() => useHereManifest());

    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull();
  });
});
