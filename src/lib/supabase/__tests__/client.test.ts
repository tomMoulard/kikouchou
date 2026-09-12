/**
 * The Supabase client's absence contract.
 *
 * The app must boot and stay fully usable with no backend configured — that is
 * the local-only mode a first launch runs in. These pin that a missing or
 * partial configuration produces `null` rather than a throw, because a throw
 * here would take the whole app down on a cold offline launch.
 *
 * `getSupabaseClient` is async because `supabase-js` is imported dynamically to
 * keep ~218 kB off the cold-launch critical path. `isSupabaseConfigured` stays
 * synchronous: it reads the environment and must not trigger that import.
 *
 * @module lib/supabase/__tests__/client.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getSupabaseClient,
  isSupabaseConfigured,
  resetSupabaseClientForTests,
} from '@/lib/supabase/client';

const URL = 'https://example-ref.supabase.co';
const KEY = 'sb_publishable_test_key_value';

beforeEach(() => {
  resetSupabaseClientForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetSupabaseClientForTests();
});

describe('getSupabaseClient', () => {
  it('returns null when nothing is configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');

    await expect(getSupabaseClient()).resolves.toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('returns null when only the URL is set', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL);
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');

    // Half a configuration is not a configuration: creating a client with an
    // empty key would fail later, at a point far from the cause.
    await expect(getSupabaseClient()).resolves.toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('returns null when only the key is set', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', KEY);

    await expect(getSupabaseClient()).resolves.toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('creates a client when both values are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL);
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', KEY);

    await expect(getSupabaseClient()).resolves.not.toBeNull();
    expect(isSupabaseConfigured()).toBe(true);
  });

  it('returns the same instance on repeated calls', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL);
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', KEY);

    // Two clients would mean two auth listeners and two token refresh loops
    // racing over one storage key. Concurrent callers must share the in-flight
    // import too, not each start their own.
    const [first, second] = await Promise.all([
      getSupabaseClient(),
      getSupabaseClient(),
    ]);
    expect(first).toBe(second);
    await expect(getSupabaseClient()).resolves.toBe(first);
  });

  it('does not throw when the environment is absent entirely', async () => {
    // Not merely empty — genuinely undefined, as in a bare `vite build`.
    vi.stubEnv('VITE_SUPABASE_URL', undefined as unknown as string);
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', undefined as unknown as string);

    expect(() => getSupabaseClient()).not.toThrow();
    await expect(getSupabaseClient()).resolves.toBeNull();
  });
});
