/**
 * @fileoverview Unit tests for the import-time OpenRouter callback capture.
 * @module features/assistant/openrouter/__tests__/callback.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageDouble } from '@/test/local-storage';

import { OPENROUTER_PENDING_STORAGE_KEY } from '../auth';
import { captureOpenRouterCallback } from '../callback';

const storage = installLocalStorageDouble();

function storePending(): void {
  storage.entries.set(
    OPENROUTER_PENDING_STORAGE_KEY,
    JSON.stringify({ verifier: 'v', state: 's', createdAt: Date.now() }),
  );
}

function fakeHistory() {
  return { state: null, replaceState: vi.fn<History['replaceState']>() };
}

describe('captureOpenRouterCallback', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('claims the code on the assistant page and strips it from the URL', () => {
    storePending();
    const history = fakeHistory();

    const captured = captureOpenRouterCallback(
      { pathname: '/kikouchou/assistant', search: '?code=abc&state=s&keep=1', hash: '' },
      history,
    );

    expect(captured).toEqual({ code: 'abc', state: 's' });
    // Gone before the Supabase capture runs, and before a reload could replay
    // it. Anything else on the URL stays.
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/kikouchou/assistant?keep=1');
  });

  it('leaves a code on any other page to the Supabase capture', () => {
    storePending();
    const history = fakeHistory();

    const captured = captureOpenRouterCallback(
      { pathname: '/', search: '?code=abc', hash: '' },
      history,
    );

    expect(captured).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('leaves the code alone when this browser started no OpenRouter sign-in', () => {
    const history = fakeHistory();

    const captured = captureOpenRouterCallback(
      { pathname: '/assistant', search: '?code=abc&state=s', hash: '' },
      history,
    );

    expect(captured).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('ignores the assistant page when it carries no code', () => {
    storePending();

    expect(
      captureOpenRouterCallback({ pathname: '/assistant', search: '', hash: '' }, fakeHistory()),
    ).toBeNull();
  });
});
