/**
 * @fileoverview Handing a link to the system share sheet.
 *
 * @module lib/native/__tests__/share-link.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ value: 'web' as string, plugin: true }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform.value,
    isPluginAvailable: () => platform.plugin,
  },
}));

const native = vi.hoisted(() => ({ share: vi.fn(async () => ({})) }));
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }));

import { canShareLink, shareLink } from '@/lib/native/share-link';

const INPUT = {
  url: 'https://kikouchou.app/join/abc',
  title: 'Lake house',
  text: 'Join Lake house on Kikouchou',
};

const webShare = vi.fn(async () => undefined);
let originalShare: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  platform.value = 'web';
  platform.plugin = true;
  originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
  Reflect.deleteProperty(navigator, 'share');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  if (originalShare) {
    Object.defineProperty(navigator, 'share', originalShare);
  } else {
    Reflect.deleteProperty(navigator, 'share');
  }
});

function giveBrowserShare(): void {
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: webShare });
}

describe('canShareLink', () => {
  it('is false in a browser with no Web Share', () => {
    expect(canShareLink()).toBe(false);
  });

  it('is true in a browser with Web Share', () => {
    giveBrowserShare();

    expect(canShareLink()).toBe(true);
  });

  it('is true in a store app that carries the plugin', () => {
    platform.value = 'android';

    expect(canShareLink()).toBe(true);
  });

  it('is false in a store app without the plugin and without Web Share', () => {
    platform.value = 'android';
    platform.plugin = false;

    expect(canShareLink()).toBe(false);
  });
});

describe('shareLink', () => {
  it('opens the native sheet in a store app', async () => {
    platform.value = 'ios';
    giveBrowserShare();

    await expect(shareLink(INPUT)).resolves.toBe('shared');

    expect(native.share).toHaveBeenCalledWith(INPUT);
    expect(webShare).not.toHaveBeenCalled();
  });

  it('opens the browser sheet on the web', async () => {
    giveBrowserShare();

    await expect(shareLink(INPUT)).resolves.toBe('shared');

    expect(webShare).toHaveBeenCalledWith(INPUT);
    expect(native.share).not.toHaveBeenCalled();
  });

  it('fails where there is no sheet at all', async () => {
    await expect(shareLink(INPUT)).resolves.toBe('failed');
  });

  it('tells a dismissed browser sheet from a failure', async () => {
    giveBrowserShare();
    const abort = new Error('The user aborted a request.');
    abort.name = 'AbortError';
    webShare.mockRejectedValueOnce(abort);

    await expect(shareLink(INPUT)).resolves.toBe('cancelled');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('tells a dismissed native sheet from a failure', async () => {
    platform.value = 'android';
    native.share.mockRejectedValueOnce(new Error('Share canceled'));

    await expect(shareLink(INPUT)).resolves.toBe('cancelled');
  });

  it('reports any other rejection as a failure', async () => {
    giveBrowserShare();
    webShare.mockRejectedValueOnce(new Error('NotAllowedError'));

    await expect(shareLink(INPUT)).resolves.toBe('failed');
    expect(console.error).toHaveBeenCalledWith(
      'Failed to open the share sheet:',
      expect.any(Error),
    );
  });

  it('reports a rejection that is not an Error as a failure', async () => {
    giveBrowserShare();
    webShare.mockRejectedValueOnce('nope' as never);

    await expect(shareLink(INPUT)).resolves.toBe('failed');
  });
});
