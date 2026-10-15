/**
 * @fileoverview Unit tests for the OpenRouter sign-in flow.
 * @module features/assistant/openrouter/__tests__/auth.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageDouble } from '@/test/local-storage';

import {
  OPENROUTER_KEY_EXCHANGE_URL,
  OPENROUTER_KEY_STORAGE_KEY,
  OPENROUTER_PENDING_STORAGE_KEY,
  PENDING_CONNECT_TTL_MS,
  completeOpenRouterConnect,
  disconnectOpenRouter,
  getOpenRouterKey,
  isOpenRouterConnected,
  prepareOpenRouterConnect,
  readPendingConnect,
  subscribeOpenRouterConnection,
} from '../auth';
import { createCodeChallenge } from '../pkce';

const storage = installLocalStorageDouble();

const CALLBACK_URL = 'https://app.example/assistant';
const NOW = 1_800_000_000_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Starts a sign-in and returns the state the callback has to carry. */
async function startConnect(): Promise<string> {
  const url = new URL(await prepareOpenRouterConnect(CALLBACK_URL, NOW));
  return url.searchParams.get('state')!;
}

describe('OpenRouter sign-in', () => {
  beforeEach(() => {
    storage.clear();
    storage.setThrowing(false);
  });

  it('sends the user to OpenRouter with an S256 challenge of the stored verifier', async () => {
    const url = new URL(await prepareOpenRouterConnect(CALLBACK_URL, NOW));
    const pending = readPendingConnect();

    expect(`${url.origin}${url.pathname}`).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe(CALLBACK_URL);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(pending).not.toBeNull();
    expect(url.searchParams.get('code_challenge')).toBe(
      await createCodeChallenge(pending!.verifier),
    );
    expect(url.searchParams.get('state')).toBe(pending!.state);
    // The verifier is the secret half: it must never travel in the URL.
    expect(url.toString()).not.toContain(pending!.verifier);
  });

  it('exchanges the code with the stored verifier and keeps the key', async () => {
    const state = await startConnect();
    const verifier = readPendingConnect()!.verifier;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ key: 'sk-or-v1-abc' }),
    );
    const listener = vi.fn();
    const unsubscribe = subscribeOpenRouterConnection(listener);

    const result = await completeOpenRouterConnect(
      { code: 'the-code', state },
      fetchImpl,
      NOW + 1000,
    );
    unsubscribe();

    expect(result).toEqual({ ok: true });
    expect(getOpenRouterKey()).toBe('sk-or-v1-abc');
    expect(isOpenRouterConnected()).toBe(true);
    expect(listener).toHaveBeenCalled();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(OPENROUTER_KEY_EXCHANGE_URL);
    expect(JSON.parse(init!.body as string)).toEqual({
      code: 'the-code',
      code_verifier: verifier,
      code_challenge_method: 'S256',
    });
  });

  it('spends the pending request, so a replayed callback completes nothing', async () => {
    const state = await startConnect();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ key: 'sk-or-v1-abc' }),
    );

    await completeOpenRouterConnect({ code: 'c', state }, fetchImpl, NOW);
    const replay = await completeOpenRouterConnect({ code: 'c', state }, fetchImpl, NOW);

    expect(replay).toEqual({ ok: false, reason: 'no-pending-request' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(storage.entries.has(OPENROUTER_PENDING_STORAGE_KEY)).toBe(false);
  });

  it('refuses a callback whose state does not match, without calling OpenRouter', async () => {
    await startConnect();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await completeOpenRouterConnect(
      { code: 'c', state: 'forged' },
      fetchImpl,
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: 'state-mismatch' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getOpenRouterKey()).toBeNull();
  });

  it('refuses a callback with no state at all', async () => {
    await startConnect();

    const result = await completeOpenRouterConnect(
      { code: 'c', state: null },
      vi.fn<typeof fetch>(),
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: 'state-mismatch' });
  });

  it('refuses a callback that arrives after the request expired', async () => {
    const state = await startConnect();

    const result = await completeOpenRouterConnect(
      { code: 'c', state },
      vi.fn<typeof fetch>(),
      NOW + PENDING_CONNECT_TTL_MS + 1,
    );

    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('reports a refused exchange and keeps no key', async () => {
    const state = await startConnect();

    const result = await completeOpenRouterConnect(
      { code: 'c', state },
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: 'bad' }, 400)),
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: 'exchange-failed' });
    expect(getOpenRouterKey()).toBeNull();
  });

  it('refuses an answer whose key is not a string', async () => {
    const state = await startConnect();

    const result = await completeOpenRouterConnect(
      { code: 'c', state },
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ key: 42 })),
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: 'exchange-failed' });
  });

  it('reports a network failure separately from a refusal', async () => {
    const state = await startConnect();

    const result = await completeOpenRouterConnect(
      { code: 'c', state },
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: 'network' });
  });

  it('does not claim a connection it could not store', async () => {
    const state = await startConnect();
    storage.setThrowing(true);

    const result = await completeOpenRouterConnect(
      { code: 'c', state },
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ key: 'sk-or-v1-abc' })),
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: 'storage-unavailable' });
    expect(isOpenRouterConnected()).toBe(false);
  });

  it('forgets the key on disconnect and tells subscribers', () => {
    storage.entries.set(OPENROUTER_KEY_STORAGE_KEY, 'sk-or-v1-abc');
    const listener = vi.fn();
    const unsubscribe = subscribeOpenRouterConnection(listener);

    disconnectOpenRouter();
    unsubscribe();

    expect(isOpenRouterConnected()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reads a corrupt pending entry as no request', () => {
    storage.entries.set(OPENROUTER_PENDING_STORAGE_KEY, '{not json');

    expect(readPendingConnect()).toBeNull();
  });
});
