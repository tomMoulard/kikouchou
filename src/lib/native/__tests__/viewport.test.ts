/**
 * @fileoverview The Android app's viewport tag.
 *
 * @module lib/native/__tests__/viewport.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ value: 'android' as 'android' | 'ios' | 'web' }));

vi.mock('@/lib/platform', () => ({ getAppPlatform: () => platform.value }));

import { fitAndroidViewport, withoutViewportCover } from '../viewport';

const CONTENT = 'width=device-width, initial-scale=1.0, viewport-fit=cover';

function viewportTag(): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.name = 'viewport';
  meta.content = CONTENT;
  document.head.appendChild(meta);
  return meta;
}

describe('withoutViewportCover', () => {
  it('drops viewport-fit=cover and keeps the rest', () => {
    expect(withoutViewportCover(CONTENT)).toBe('width=device-width, initial-scale=1.0');
  });

  it('reads the key however it is spaced', () => {
    expect(withoutViewportCover('width=device-width,viewport-fit = cover')).toBe('width=device-width');
  });

  it('leaves a tag without it alone', () => {
    expect(withoutViewportCover('width=device-width, initial-scale=1.0')).toBe(
      'width=device-width, initial-scale=1.0',
    );
  });
});

describe('fitAndroidViewport', () => {
  afterEach(() => {
    document.head.querySelectorAll('meta[name="viewport"]').forEach((meta) => meta.remove());
    platform.value = 'android';
  });

  it('drops cover in the Android app', () => {
    const meta = viewportTag();

    fitAndroidViewport();

    expect(meta.content).toBe('width=device-width, initial-scale=1.0');
  });

  it.each(['web', 'ios'] as const)('keeps cover on %s', (target) => {
    platform.value = target;
    const meta = viewportTag();

    fitAndroidViewport();

    expect(meta.content).toBe(CONTENT);
  });
});
