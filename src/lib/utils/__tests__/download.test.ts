/**
 * @fileoverview Guards the file hand-off.
 *
 * Two claims: a name built from a trip name is safe to write to a file system,
 * and a browser that cannot make an object URL is reported rather than left to
 * throw — the button says so instead of looking broken.
 *
 * @module lib/utils/__tests__/download.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadTextFile, toFilenameSegment } from '../download';

// ============================================================================
// Tests
// ============================================================================

describe('toFilenameSegment', () => {
  it('folds a trip name into a safe segment', () => {
    expect(toFilenameSegment('Provence, août 2026', 'kikouchou')).toBe('provence-aout-2026');
  });

  it('drops a path separator rather than passing it on', () => {
    expect(toFilenameSegment('Été / Hiver', 'kikouchou')).toBe('ete-hiver');
  });

  it('falls back when nothing usable survives', () => {
    expect(toFilenameSegment('///', 'kikouchou')).toBe('kikouchou');
    expect(toFilenameSegment('', 'kikouchou')).toBe('kikouchou');
  });

  it('never ends on a dash, however long the name was', () => {
    expect(toFilenameSegment(`${'a'.repeat(59)} b`, 'kikouchou')).toBe('a'.repeat(59));
  });
});

describe('downloadTextFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clicks an anchor carrying the blob, and cleans up after it', () => {
    const createObjectURL = vi.fn(() => 'blob:test'),
      revokeObjectURL = vi.fn();

    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    vi.useFakeTimers();

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const started = downloadTextFile({
      filename: 'runs.ics',
      text: 'BEGIN:VCALENDAR',
      mimeType: 'text/calendar;charset=utf-8',
    });

    expect(started).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    // The anchor is gone from the document, and the URL is released once the
    // browser has had its tick with it.
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');

    vi.useRealTimers();
  });

  it('reports a browser that cannot make an object URL', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: undefined });

    expect(
      downloadTextFile({ filename: 'runs.ics', text: 'x', mimeType: 'text/calendar' }),
    ).toBe(false);
  });
});
