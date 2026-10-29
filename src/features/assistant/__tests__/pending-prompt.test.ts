/**
 * @fileoverview A question asked before signing in, kept until the account
 * exists.
 * @module features/assistant/__tests__/pending-prompt.test
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { installLocalStorageDouble } from '@/test/local-storage';

import {
  PENDING_PROMPT_STORAGE_KEY,
  PENDING_PROMPT_TTL_MS,
  storePendingPrompt,
  takePendingPrompt,
} from '../pending-prompt';

const storage = installLocalStorageDouble();
const NOW = 1_800_000_000_000;

describe('pending prompt', () => {
  beforeEach(() => {
    storage.clear();
    storage.setThrowing(false);
  });

  it('gives the question back once, then forgets it', () => {
    storePendingPrompt({ text: 'Plan a weekend', kind: 'create' }, NOW);

    expect(takePendingPrompt(NOW + 1000)).toEqual({ text: 'Plan a weekend', kind: 'create' });
    expect(takePendingPrompt(NOW + 2000)).toBeNull();
    expect(storage.entries.has(PENDING_PROMPT_STORAGE_KEY)).toBe(false);
  });

  it('drops a question older than the sign-in could take', () => {
    storePendingPrompt({ text: 'Plan a weekend', kind: 'create' }, NOW);

    expect(takePendingPrompt(NOW + PENDING_PROMPT_TTL_MS + 1)).toBeNull();
    expect(storage.entries.has(PENDING_PROMPT_STORAGE_KEY)).toBe(false);
  });

  it.each([
    ['not JSON', 'nope'],
    ['no text', JSON.stringify({ kind: 'create', at: NOW })],
    ['an unknown kind', JSON.stringify({ text: 'x', kind: 'delete', at: NOW })],
    ['a text past the bound', JSON.stringify({ text: 'x'.repeat(501), kind: 'create', at: NOW })],
    ['a date in the future', JSON.stringify({ text: 'x', kind: 'create', at: NOW + 60_000 })],
  ])('refuses a stored value with %s', (_, raw) => {
    storage.entries.set(PENDING_PROMPT_STORAGE_KEY, raw);

    expect(takePendingPrompt(NOW)).toBeNull();
  });

  it('loses the question quietly when storage refuses it', () => {
    storage.setThrowing(true);

    expect(() => storePendingPrompt({ text: 'x', kind: 'explore' }, NOW)).not.toThrow();
    storage.setThrowing(false);
    expect(takePendingPrompt(NOW)).toBeNull();
  });
});
