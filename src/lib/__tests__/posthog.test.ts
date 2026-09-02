/**
 * `lib/posthog` initialization rules.
 *
 * The module has no functions to call — everything it does happens at import
 * time — so every test here stubs the environment, resets the module registry
 * and imports it fresh.
 *
 * What is being defended: this project accumulated 20 PostHog people against 3
 * Supabase accounts, 19 of them anonymous ids whose events all came from a
 * loopback host. jsdom reports `window.location.hostname` as `localhost`, so
 * these tests run on exactly the hostname that caused it.
 *
 * @module lib/__tests__/posthog.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Test doubles
// ============================================================================

const mockInit = vi.fn();
const mockRegister = vi.fn();
const mockReset = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: (...args: unknown[]) => mockInit(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    reset: (...args: unknown[]) => mockReset(...args),
  },
}));

/** Imports the module fresh, so its import-time branch runs under the current env. */
async function importPosthog(): Promise<typeof import('@/lib/posthog')> {
  vi.resetModules();
  return import('@/lib/posthog');
}

/** The configuration a real deployment has. */
function withCredentials(): void {
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_token');
  vi.stubEnv('VITE_POSTHOG_HOST', 'https://eu.i.posthog.com');
}

beforeEach(() => {
  mockInit.mockClear();
  mockRegister.mockClear();
  mockReset.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ============================================================================
// Tests
// ============================================================================

describe('lib/posthog', () => {
  it('exports undefined and never initializes without both env vars', async () => {
    // The suite's own default, and a fresh clone's: `vitest.config.ts` blanks
    // both. Every call site is `posthog?.capture(...)` because of this.
    const { default: client } = await importPosthog();

    expect(client).toBeUndefined();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('refuses to initialize on localhost even with a key configured', async () => {
    withCredentials();
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const { default: client } = await importPosthog();

    // The guard that makes a stray key in `.env.local` harmless. Without it,
    // every dev-server load, every Vitest run and every Playwright browser
    // context minted a real Person in the real project.
    expect(mockInit).not.toHaveBeenCalled();
    expect(client).toBeUndefined();
    expect(consoleInfo).toHaveBeenCalled();
    consoleInfo.mockRestore();
  });

  it('initializes on localhost when the opt-in is set, so it can be debugged', async () => {
    withCredentials();
    vi.stubEnv('VITE_POSTHOG_ALLOW_LOCALHOST', 'true');

    const { default: client } = await importPosthog();

    expect(client).toBeDefined();
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('only accepts a literal "true" as the opt-in', async () => {
    withCredentials();
    // A truthy-looking value must not open the door: `.env` values are strings,
    // so `VITE_POSTHOG_ALLOW_LOCALHOST=false` would otherwise enable it.
    vi.stubEnv('VITE_POSTHOG_ALLOW_LOCALHOST', 'false');
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await importPosthog();

    expect(mockInit).not.toHaveBeenCalled();
    consoleInfo.mockRestore();
  });

  it.each([
    ['192.168.1.20', 'a phone loading `vite --host` over the LAN'],
    ['10.0.0.5', 'a private network'],
    ['172.20.1.9', 'the other RFC 1918 range'],
    ['169.254.4.4', 'a link-local address'],
    ['kikoushou.local', 'mDNS'],
    ['app.localhost', 'an RFC 6761 loopback subdomain'],
  ])('refuses to initialize on %s — %s', async (hostname) => {
    withCredentials();
    vi.stubGlobal('location', { hostname });
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await importPosthog();

    // Loopback is only half of it: `vite --host` is exactly the session where
    // somebody is poking at the app by hand, and the browser there reports a
    // LAN address rather than `localhost`.
    expect(mockInit).not.toHaveBeenCalled();
    consoleInfo.mockRestore();
    vi.unstubAllGlobals();
  });

  it('does initialize on a real deployment host', async () => {
    withCredentials();
    // The guard must not be so broad that it silences production. This is the
    // failure mode that would cost everything the change is trying to protect.
    vi.stubGlobal('location', { hostname: 'tommoulard.github.io' });

    await importPosthog();

    expect(mockInit).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('leaves anonymous visitors profile-less and disables the test-user hostname', async () => {
    withCredentials();
    vi.stubEnv('VITE_POSTHOG_ALLOW_LOCALHOST', 'true');

    await importPosthog();

    const options = mockInit.mock.calls[0]?.[1] as Record<string, unknown>;
    // Most of this app works signed out; a persisted person per visitor would
    // swamp the handful of real accounts.
    expect(options['person_profiles']).toBe('identified_only');
    // `defaults: '2026-05-30'` sets this to /^(localhost|127\.0\.0\.1)$/, and a
    // match routes through `setPersonProperties()` — which forces a person
    // profile and overrides `identified_only` above. That is the mechanism
    // behind the 19 phantom people; `null` is how the library disables it.
    expect(options['internal_or_test_user_hostname']).toBeNull();
  });

  it('registers the release on every event', async () => {
    withCredentials();
    vi.stubEnv('VITE_POSTHOG_ALLOW_LOCALHOST', 'true');
    vi.stubEnv('VITE_APP_VERSION', 'main@abc1234');

    await importPosthog();

    expect(mockRegister).toHaveBeenCalledWith({ app_version: 'main@abc1234' });
  });
});

// ============================================================================
// resetAnalyticsIdentity
// ============================================================================

describe('resetAnalyticsIdentity', () => {
  it('puts the release back, because reset() wipes super properties', async () => {
    withCredentials();
    vi.stubEnv('VITE_POSTHOG_ALLOW_LOCALHOST', 'true');
    vi.stubEnv('VITE_APP_VERSION', 'main@abc1234');
    const { resetAnalyticsIdentity } = await importPosthog();
    mockRegister.mockClear();

    resetAnalyticsIdentity();

    // posthog-js's `reset()` calls `persistence.clear()`, which drops every
    // persisted property — super properties included. A bare `reset()` would
    // leave the rest of the session with no `app_version`, so every event after
    // a sign-out falls out of the breakdown the project is sliced by.
    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith({ app_version: 'main@abc1234' });
    expect(mockReset.mock.invocationCallOrder[0]!).toBeLessThan(
      mockRegister.mock.invocationCallOrder[0]!,
    );
  });

  it('is a no-op when analytics is off, rather than throwing', async () => {
    // The default in tests, in a fresh clone and in a fork's CI. Nothing in this
    // module may throw: it is imported at module scope by `main.tsx`.
    const { resetAnalyticsIdentity } = await importPosthog();

    expect(() => resetAnalyticsIdentity()).not.toThrow();
    expect(mockReset).not.toHaveBeenCalled();
  });
});
