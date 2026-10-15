/**
 * Provider discovery: what the project says, and what happens when it says
 * nothing usable.
 *
 * The payload in `LIVE_PAYLOAD` is a real response, captured from the project
 * this app deploys against. It is the fixture worth having because it pins the
 * two facts the feature is built on: `external` mixes OAuth ids with `email` and
 * `phone`, and there is **no web3 key at all** — which is why wallet sign-in is
 * configured locally instead.
 *
 * The failure cases matter as much as the happy one. Sign-in is offered on a
 * screen that must render offline, so every one of them has to end as "keep
 * showing the list you already have", never as a throw or an empty list.
 *
 * @module lib/supabase/__tests__/auth-settings.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FALLBACK_AUTH_SETTINGS,
  fetchAuthSettings,
  parseAuthSettings,
  readCachedAuthSettings,
} from '@/lib/supabase/auth-settings';

// ============================================================================
// Fixtures
// ============================================================================

const URL = 'https://example-ref.supabase.co';
const KEY = 'sb_publishable_test_key_value';

/** Captured from `GET /auth/v1/settings`, trimmed to the interesting keys. */
const LIVE_PAYLOAD = {
  external: {
    anonymous_users: false,
    apple: false,
    azure: false,
    github: false,
    google: true,
    spotify: true,
    email: true,
    phone: false,
    zoom: false,
  },
  disable_signup: false,
  mailer_autoconfirm: false,
  sms_provider: 'twilio',
  saml_enabled: false,
  passkeys_enabled: true,
};

/**
 * jsdom in this suite exposes no `localStorage` at all — see the comment in
 * `lib/__tests__/theme.test.ts`, which found the same thing. That absence is one
 * of the states this module has to survive, so it is tested directly below and
 * a working store is installed only where the cache is the subject.
 *
 * @returns The installed store, for direct inspection
 */
function installLocalStorage(): Storage {
  const entries = new Map<string, string>(),
    store: Storage = {
      get length(): number {
        return entries.size;
      },
      clear: () => entries.clear(),
      getItem: (key) => entries.get(key) ?? null,
      key: (index) => [...entries.keys()][index] ?? null,
      removeItem: (key) => {
        entries.delete(key);
      },
      setItem: (key, value) => {
        entries.set(key, value);
      },
    };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: store,
  });

  return store;
}

function configure(): void {
  vi.stubEnv('VITE_SUPABASE_URL', URL);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', KEY);
}

function mockFetchOnce(body: unknown, init: { ok?: boolean } = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: init.ok ?? true,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  installLocalStorage();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'localStorage');
});

// ============================================================================
// parseAuthSettings
// ============================================================================

describe('parseAuthSettings', () => {
  it('reads the enabled providers out of a real response', () => {
    const settings = parseAuthSettings(LIVE_PAYLOAD);

    expect(settings).toEqual({
      oauth: ['google', 'spotify'],
      email: true,
      phone: false,
      passkeys: true,
      signupDisabled: false,
    });
  });

  it('keeps email and phone out of the OAuth list', () => {
    // They live in the same map but are not providers you can redirect to, and
    // "Continue with anonymous_users" is not a button anyone should see.
    const settings = parseAuthSettings({
      external: { email: true, phone: true, anonymous_users: true, google: true },
    });

    expect(settings?.oauth).toEqual(['google']);
    expect(settings?.email).toBe(true);
    expect(settings?.phone).toBe(true);
  });

  it('treats anything that is not exactly true as disabled', () => {
    const settings = parseAuthSettings({
      external: { google: 'true', spotify: 1, github: null, discord: true },
    });

    expect(settings?.oauth).toEqual(['discord']);
  });

  it('picks up a provider it has never heard of', () => {
    // The whole point: enabling one in the dashboard must not need a release.
    const settings = parseAuthSettings({ external: { some_new_idp: true } });

    expect(settings?.oauth).toEqual(['some_new_idp']);
  });

  it('drops ids that are not shaped like provider ids', () => {
    // About to be interpolated into a translation key and a DOM attribute.
    const settings = parseAuthSettings({
      external: {
        'Google': true,
        '../../etc': true,
        'a': true,
        '<script>': true,
        google: true,
      },
    });

    expect(settings?.oauth).toEqual(['google']);
  });

  it('caps the list so a malformed response cannot render hundreds of buttons', () => {
    const external: Record<string, boolean> = {};
    for (let index = 0; index < 100; index += 1) {
      external[`provider_${index}`] = true;
    }

    expect(parseAuthSettings({ external })?.oauth).toHaveLength(24);
  });

  it('reads absent flags as off rather than as an error', () => {
    // GoTrue adds keys between releases; a missing `passkeys_enabled` means
    // this version does not have them, which is exactly "off".
    expect(parseAuthSettings({ external: {} })).toEqual({
      oauth: [],
      email: false,
      phone: false,
      passkeys: false,
      signupDisabled: false,
    });
  });

  it('reports a payload that is not a settings response', () => {
    // An HTML error page that happened to parse, or a URL pointing elsewhere.
    expect(parseAuthSettings({ message: 'not found' })).toBeNull();
    expect(parseAuthSettings('<!doctype html>')).toBeNull();
    expect(parseAuthSettings(null)).toBeNull();
    expect(parseAuthSettings([{ external: { google: true } }])).toBeNull();
  });
});

// ============================================================================
// fetchAuthSettings
// ============================================================================

describe('fetchAuthSettings', () => {
  it('never touches the network in a build with no backend', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const fetchMock = mockFetchOnce(LIVE_PAYLOAD);

    await expect(fetchAuthSettings()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the project, with the publishable key and no cookies', async () => {
    configure();
    const fetchMock = mockFetchOnce(LIVE_PAYLOAD);

    await expect(fetchAuthSettings()).resolves.toMatchObject({
      oauth: ['google', 'spotify'],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL}/auth/v1/settings`);
    expect(init.headers).toMatchObject({ apikey: KEY });
    expect(init.credentials).toBe('omit');
    // The point of asking is to notice a dashboard change, so a cached answer
    // is worse than no answer.
    expect(init.cache).toBe('no-store');
  });

  it('resolves null on a failed request rather than throwing', async () => {
    configure();
    mockFetchOnce({ message: 'boom' }, { ok: false });

    await expect(fetchAuthSettings()).resolves.toBeNull();
  });

  it('resolves null when the network is gone', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    // Offline is the normal state for this app, not an exception.
    await expect(fetchAuthSettings()).resolves.toBeNull();
  });

  it('resolves null when the body is not JSON', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      })),
    );

    await expect(fetchAuthSettings()).resolves.toBeNull();
  });
});

// ============================================================================
// Caching
// ============================================================================

describe('the cached answer', () => {
  it('is what the next first frame renders', async () => {
    configure();
    mockFetchOnce(LIVE_PAYLOAD);

    expect(readCachedAuthSettings()).toBeNull();
    await fetchAuthSettings();

    expect(readCachedAuthSettings()).toEqual({
      oauth: ['google', 'spotify'],
      email: true,
      phone: false,
      passkeys: true,
      signupDisabled: false,
    });
  });

  it('is kept per project, so a local stack cannot answer for production', async () => {
    configure();
    mockFetchOnce(LIVE_PAYLOAD);
    await fetchAuthSettings();

    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');

    expect(readCachedAuthSettings()).toBeNull();
  });

  it('is not written by a failed request', async () => {
    configure();
    mockFetchOnce({ message: 'boom' }, { ok: false });

    await fetchAuthSettings();

    expect(readCachedAuthSettings()).toBeNull();
  });

  it('is ignored when it has been corrupted', () => {
    configure();
    window.localStorage.setItem(`kikoushou-auth-settings:${URL}`, '{"oauth":');

    // A truncated write, or an entry from a build with a different shape.
    expect(readCachedAuthSettings()).toBeNull();
  });

  it('is re-validated on the way out, not trusted', () => {
    configure();
    window.localStorage.setItem(
      `kikoushou-auth-settings:${URL}`,
      JSON.stringify({ oauth: ['google', '<script>', 42], email: 'yes' }),
    );

    expect(readCachedAuthSettings()).toEqual({
      oauth: ['google'],
      email: false,
      phone: false,
      passkeys: false,
      signupDisabled: false,
    });
  });

  it('survives a store that refuses to be read', () => {
    configure();
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      // Safari in private mode.
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    expect(readCachedAuthSettings()).toBeNull();
    vi.restoreAllMocks();
  });

  it('survives a browser with no store at all', async () => {
    configure();
    mockFetchOnce(LIVE_PAYLOAD);
    Reflect.deleteProperty(window, 'localStorage');

    // Which is how this very suite runs. Reading falls back to null and the
    // write on the way through must not take the fetch down with it.
    expect(readCachedAuthSettings()).toBeNull();
    await expect(fetchAuthSettings()).resolves.toMatchObject({
      oauth: ['google', 'spotify'],
    });
  });
});

// ============================================================================
// Fallback
// ============================================================================

describe('FALLBACK_AUTH_SETTINGS', () => {
  it('offers something to click, because an empty screen offers nothing', () => {
    // What a first launch shows when it is offline and has never reached the
    // endpoint. A wrong guess is self-correcting — the button reports that the
    // provider is not enabled — while an empty list is a dead end.
    expect(FALLBACK_AUTH_SETTINGS.oauth).toEqual(['google']);
  });
});
