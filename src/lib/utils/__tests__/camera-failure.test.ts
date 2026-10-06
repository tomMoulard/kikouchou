/**
 * @fileoverview What the scanner is allowed to conclude from a camera refusal.
 *
 * The names arrive inside a sentence html5-qrcode wrote, not on `error.name`,
 * so the classifier reads the text. The last case is the one that matters most:
 * an unrecognised failure must stay `unknown`, because every other answer sends
 * the visitor to a setting that was never the problem.
 *
 * @module lib/utils/__tests__/camera-failure.test
 */

import { describe, expect, it } from 'vitest';

import { classifyCameraFailure } from '../camera-failure';

describe('classifyCameraFailure', () => {
  it.each([
    ['Error getting userMedia, error = NotAllowedError: denied', 'blocked'],
    ['Error getting userMedia, error = NotFoundError: no device', 'missing'],
    ['OverconstrainedError', 'missing'],
    ['Error getting userMedia, error = NotReadableError: busy', 'busy'],
    ['AbortError', 'busy'],
    ['something else entirely', 'unknown'],
  ])('reads %s as %s', (message, expected) => {
    expect(classifyCameraFailure(new Error(message))).toBe(expected);
  });

  it('reads a DOMException that kept its name', () => {
    const error = new Error('denied');
    error.name = 'NotAllowedError';
    expect(classifyCameraFailure(error)).toBe('blocked');
  });

  it('does not guess at a thrown string with nothing in it', () => {
    expect(classifyCameraFailure('nope')).toBe('unknown');
  });
});
