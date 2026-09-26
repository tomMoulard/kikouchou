/**
 * @fileoverview The store app's way to hand over a file and to leave the app.
 *
 * @module lib/native/__tests__/files-and-links.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ value: 'ios' as string }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platform.value, isPluginAvailable: () => true },
}));

const native = vi.hoisted(() => ({
  writeFile: vi.fn(async () => ({ uri: 'file:///cache/runs.ics' })),
  share: vi.fn(async () => ({})),
  openUrl: vi.fn(async () => ({ completed: true })),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: native.writeFile },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }));
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: native.openUrl } }));

import { openExternalUrl } from '@/lib/native/external-links';
import { shareTextFile } from '@/lib/native/files';
import { saveTextFile } from '@/lib/utils/download';

const FILE = { filename: 'runs.ics', text: 'BEGIN:VCALENDAR', mimeType: 'text/calendar' };

beforeEach(() => {
  vi.clearAllMocks();
  platform.value = 'ios';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('shareTextFile', () => {
  it('writes the file to the cache and opens the share sheet on it', async () => {
    await expect(shareTextFile('runs.ics', 'BEGIN:VCALENDAR', 'Add your runs')).resolves.toBe(
      'saved',
    );

    expect(native.writeFile).toHaveBeenCalledWith({
      path: 'runs.ics',
      data: 'BEGIN:VCALENDAR',
      directory: 'CACHE',
      encoding: 'utf8',
    });
    expect(native.share).toHaveBeenCalledWith({
      title: 'Add your runs',
      files: ['file:///cache/runs.ics'],
    });
  });

  it('tells a dismissed sheet from a failure', async () => {
    native.share.mockRejectedValueOnce(new Error('Share canceled'));
    await expect(shareTextFile('a', 'b', 'c')).resolves.toBe('cancelled');

    native.share.mockRejectedValueOnce(new Error('No activity'));
    await expect(shareTextFile('a', 'b', 'c')).resolves.toBe('failed');

    native.writeFile.mockRejectedValueOnce(new Error('disk full'));
    await expect(shareTextFile('a', 'b', 'c')).resolves.toBe('failed');
  });
});

describe('saveTextFile', () => {
  it('shares in a store app', async () => {
    await expect(saveTextFile(FILE, 'Add your runs')).resolves.toBe('saved');

    expect(native.share).toHaveBeenCalled();
  });

  it('downloads on the website', async () => {
    platform.value = 'web';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await expect(saveTextFile(FILE, 'Add your runs')).resolves.toBe('saved');

    expect(click).toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
  });
});

describe('openExternalUrl', () => {
  it('hands the link to the operating system in a store app', () => {
    openExternalUrl('https://maps.apple.com/?q=Home');

    expect(native.openUrl).toHaveBeenCalledWith({ url: 'https://maps.apple.com/?q=Home' });
  });

  it('opens a new tab on the website', () => {
    platform.value = 'web';
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    openExternalUrl('https://www.google.com/maps');

    expect(open).toHaveBeenCalledWith('https://www.google.com/maps', '_blank', 'noopener,noreferrer');
    expect(native.openUrl).not.toHaveBeenCalled();
  });

  it('logs a link the operating system refused', async () => {
    native.openUrl.mockRejectedValueOnce(new Error('no handler'));

    openExternalUrl('https://example.test');
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
  });
});
