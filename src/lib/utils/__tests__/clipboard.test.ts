/**
 * @fileoverview Tests for the clipboard helper.
 *
 * The fallback is the whole reason this module exists. `navigator.clipboard`
 * rejects outside a secure context, which is where half of this app's manual
 * testing happens: a phone on a LAN address, a webview, a preview build. A copy
 * button that silently did nothing there was the bug this replaces.
 *
 * @module lib/utils/__tests__/clipboard.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from '../clipboard';

function withClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

function withExecCommand(implementation: () => boolean): void {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(implementation),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('uses the clipboard API when it is allowed', async () => {
    const writeText = vi.fn(async () => undefined);
    withClipboard(writeText);

    await expect(copyText('https://example.test')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://example.test');
  });

  it('falls back to a selection when the clipboard is refused', async () => {
    withClipboard(async () => {
      throw new Error('not allowed');
    });
    withExecCommand(() => true);

    await expect(copyText('https://example.test')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('leaves no textarea behind after the fallback', async () => {
    withClipboard(async () => {
      throw new Error('not allowed');
    });
    withExecCommand(() => true);

    await copyText('https://example.test');

    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('says so when the browser refused both routes', async () => {
    withClipboard(async () => {
      throw new Error('not allowed');
    });
    withExecCommand(() => false);

    await expect(copyText('https://example.test')).resolves.toBe(false);
  });

  it('says so when the fallback itself throws', async () => {
    withClipboard(async () => {
      throw new Error('not allowed');
    });
    withExecCommand(() => {
      throw new Error('no selection here');
    });

    await expect(copyText('https://example.test')).resolves.toBe(false);
  });
});
