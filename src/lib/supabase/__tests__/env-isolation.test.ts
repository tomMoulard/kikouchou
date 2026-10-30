/**
 * The unit suite must never see a real backend.
 *
 * Vite loads `.env.local` in tests too, so a developer with a working
 * `.env.local` would otherwise have `AuthProvider` construct a live client
 * against their production project on every test that mounts `AppProviders` —
 * reading localStorage, running `detectSessionInUrl`, and starting a token
 * refresh timer. That produced an intermittent failure in the assistant prompt
 * tests, which is how it was found.
 *
 * This pins the blanking in `vitest.config.ts` so it cannot be removed quietly.
 *
 * @module lib/supabase/__tests__/env-isolation.test
 */

import { describe, expect, it } from 'vitest';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';

describe('test environment isolation', () => {
  it('reports no configured backend', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBeFalsy();
    expect(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY).toBeFalsy();
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('never constructs a client', async () => {
    // Also means `@supabase/supabase-js` is never dynamically imported by the
    // suite, so nothing schedules a token refresh behind the tests.
    await expect(getSupabaseClient()).resolves.toBeNull();
  });
});
