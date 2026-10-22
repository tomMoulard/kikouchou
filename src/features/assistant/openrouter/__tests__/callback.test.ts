/**
 * @fileoverview Unit tests for the import-time OpenRouter callback capture.
 * @module features/assistant/openrouter/__tests__/callback.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageDouble } from '@/test/local-storage';

import { OPENROUTER_PENDING_STORAGE_KEY } from '../auth';
import {
  captureOpenRouterCallback,
  deliverOpenRouterCallbackUrl,
  onOpenRouterCallback,
} from '../callback';

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

describe('deliverOpenRouterCallbackUrl', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('hands a store app\'s code to the assistant page', () => {
    storePending();
    const listener = vi.fn();
    const unsubscribe = onOpenRouterCallback(listener);

    expect(
      deliverOpenRouterCallbackUrl('app.kikouchou://openrouter/callback?code=sheet-1&state=s'),
    ).toBe(true);

    expect(listener).toHaveBeenCalledWith({ code: 'sheet-1', state: 's' });
    unsubscribe();
  });

  it('keeps a code that arrives before the page subscribed', () => {
    storePending();

    deliverOpenRouterCallbackUrl('app.kikouchou://openrouter/callback?code=sheet-2&state=s');
    const listener = vi.fn();
    const unsubscribe = onOpenRouterCallback(listener);

    expect(listener).toHaveBeenCalledWith({ code: 'sheet-2', state: 's' });
    unsubscribe();
  });

  it('hands a code out once, however often the link arrives', () => {
    storePending();
    const listener = vi.fn();
    const unsubscribe = onOpenRouterCallback(listener);

    deliverOpenRouterCallbackUrl('app.kikouchou://openrouter/callback?code=sheet-3&state=s');
    deliverOpenRouterCallbackUrl('app.kikouchou://openrouter/callback?code=sheet-3&state=s');

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('refuses a code this device never asked for, and a link with none', () => {
    const listener = vi.fn();
    const unsubscribe = onOpenRouterCallback(listener);

    expect(
      deliverOpenRouterCallbackUrl('app.kikouchou://openrouter/callback?code=nobody-asked'),
    ).toBe(false);
    storePending();
    expect(deliverOpenRouterCallbackUrl('app.kikouchou://openrouter/callback')).toBe(false);
    expect(deliverOpenRouterCallbackUrl('not a url')).toBe(false);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
