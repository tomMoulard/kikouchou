/**
 * @fileoverview Tests for the repository error wrapper.
 *
 * The point of the wrapper is that the reason survives into the message, so
 * these tests are mostly about the shapes a database layer throws that are not
 * a plain `Error` with a useful `message` — which is exactly the case that cost
 * an investigation: an assignment write failed, and the console held the
 * wrapper's own text and a bare stack, with the real fault only on `cause`,
 * where nothing in the app ever looked.
 *
 * @module lib/db/__tests__/repository-error.test
 */

import { describe, it, expect } from 'vitest';
import { describeCause, repositoryError } from '@/lib/db/repository-error';

describe('describeCause', () => {
  it('names the error and its message', () => {
    expect(describeCause(new TypeError('bad key'))).toBe('TypeError: bad key');
  });

  it('falls back to the name when the message is empty', () => {
    // The case behind the original bug report: IndexedDB rejects with a
    // DOMException that often carries no message at all, so reading `.message`
    // alone produced an error that said nothing.
    const empty = new Error('');
    empty.name = 'DatabaseClosedError';

    expect(describeCause(empty)).toBe('DatabaseClosedError');
  });

  it('falls back to the name when the message is only whitespace', () => {
    const blank = new Error('   ');
    blank.name = 'AbortError';

    expect(describeCause(blank)).toBe('AbortError');
  });

  it('describes a DOMException', () => {
    const quota = new DOMException('disk is full', 'QuotaExceededError');

    expect(describeCause(quota)).toBe('QuotaExceededError: disk is full');
  });

  it('passes a thrown string through, trimmed', () => {
    expect(describeCause('  transaction aborted  ')).toBe('transaction aborted');
  });

  it('never returns an empty description for a non-error value', () => {
    expect(describeCause(undefined)).toBe('undefined');
    expect(describeCause(null)).toBe('null');
    expect(describeCause('')).toBe('');
  });
});

describe('repositoryError', () => {
  it('puts the reason in the message, where a toast and PostHog can see it', () => {
    const cause = new DOMException('key exists', 'ConstraintError'),
     error = repositoryError('Failed to create assignment p1 in room r2', cause);

    expect(error.message).toBe(
      'Failed to create assignment p1 in room r2: ConstraintError: key exists',
    );
  });

  it('keeps the original on cause for anything that does look', () => {
    const cause = new Error('underlying'),
     error = repositoryError('Failed to delete room r9', cause);

    expect(error.cause).toBe(cause);
  });

  it('still says something useful when the cause says nothing', () => {
    const silent = new Error('');
    silent.name = 'DatabaseClosedError';

    expect(repositoryError('Failed to create assignment a1', silent).message).toBe(
      'Failed to create assignment a1: DatabaseClosedError',
    );
  });

  it('returns a real Error, so every existing catch still matches', () => {
    expect(repositoryError('Failed', 'nope')).toBeInstanceOf(Error);
  });
});
