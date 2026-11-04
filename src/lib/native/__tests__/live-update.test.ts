/**
 * @fileoverview Live updates: which bundle a store app runs next, and why.
 *
 * @module lib/native/__tests__/live-update.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog', () => ({ captureEvent: capture }));
vi.mock('@capawesome/capacitor-live-update', () => ({ LiveUpdate: {} }));

import {
  parseLiveUpdateManifest,
  runLiveUpdate,
  type LiveUpdateApi,
  type LiveUpdateDeps,
} from '../live-update';

// ============================================================================
// Helpers
// ============================================================================

const ORIGIN = 'https://app.kikouchou.app';
const FINGERPRINT = 'b1407b093f04a844';
const SHA = 'a'.repeat(40);
const OLDER_SHA = 'b'.repeat(40);
const SIGNATURE = `${'A'.repeat(342)}==`;
const MANIFEST = {
  bundleId: SHA,
  url: `${ORIGIN}/live/${FINGERPRINT}/${SHA}.zip`,
  signature: SIGNATURE,
};

function api(current: string | null, overrides: Partial<LiveUpdateApi> = {}) {
  return {
    ready: vi.fn(async () => ({ currentBundleId: current, previousBundleId: null, rollback: false })),
    getVersionCode: vi.fn(async () => ({ versionCode: '1001' })),
    reset: vi.fn(async () => undefined),
    getBlockedBundles: vi.fn(async () => ({ bundleIds: [] as string[] })),
    getDownloadedBundles: vi.fn(async () => ({ bundleIds: [] as string[] })),
    downloadBundle: vi.fn(async () => undefined),
    setNextBundle: vi.fn(async () => undefined),
    ...overrides,
  };
}

function storage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function respond(status: number, body: unknown = MANIFEST) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function deps(overrides: Partial<LiveUpdateDeps> & { api: LiveUpdateApi }): LiveUpdateDeps {
  return {
    fingerprint: FINGERPRINT,
    origin: ORIGIN,
    storage: storage(),
    fetch: respond(200),
    ...overrides,
  };
}

const STORE_BUILD_RECORD = { 'kikouchou-native-fingerprint:1001': FINGERPRINT };

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  capture.mockReset();
});

describe('runLiveUpdate', () => {
  it('records the store build fingerprint and stages the deployed bundle', async () => {
    const ready = vi.fn(async () => ({ currentBundleId: null, previousBundleId: null, rollback: false }));
    const getVersionCode = vi.fn(async () => ({ versionCode: '1001' }));
    const plugin = api(null, { ready, getVersionCode });
    const store = storage();
    const fetchManifest = respond(200);

    const outcome = await runLiveUpdate(deps({ api: plugin, storage: store, fetch: fetchManifest }));

    expect(outcome).toBe('staged');
    // ready() first: without it the plugin would roll this bundle back.
    expect(ready.mock.invocationCallOrder[0]).toBeLessThan(getVersionCode.mock.invocationCallOrder[0]!);
    expect(store.map.get('kikouchou-native-fingerprint:1001')).toBe(FINGERPRINT);
    expect(fetchManifest).toHaveBeenCalledWith(`${ORIGIN}/live/${FINGERPRINT}.json`, { cache: 'no-store' });
    expect(plugin.downloadBundle).toHaveBeenCalledWith({
      url: MANIFEST.url,
      bundleId: SHA,
      signature: SIGNATURE,
    });
    expect(plugin.setNextBundle).toHaveBeenCalledWith({ bundleId: SHA });
    expect(capture).toHaveBeenCalledWith('live_update_downloaded', { bundle: 'aaaaaaa' });
  });

  it('goes back to the store build bundle after a store update', async () => {
    // Running a downloaded bundle, and this version code never ran its own.
    const plugin = api(OLDER_SHA);

    const outcome = await runLiveUpdate(deps({ api: plugin, storage: storage() }));

    expect(outcome).toBe('reset');
    expect(plugin.reset).toHaveBeenCalled();
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('live_update_reset', { reason: 'store_update' });
  });

  it('goes back when a downloaded bundle was built for another native layer', async () => {
    const plugin = api(OLDER_SHA);
    const store = storage({ 'kikouchou-native-fingerprint:1001': '0123456789abcdef' });

    const outcome = await runLiveUpdate(deps({ api: plugin, storage: store }));

    expect(outcome).toBe('reset');
    expect(capture).toHaveBeenCalledWith('live_update_reset', { reason: 'fingerprint_mismatch' });
  });

  it('keeps a downloaded bundle that matches, and stages a newer one', async () => {
    const plugin = api(OLDER_SHA);

    const outcome = await runLiveUpdate(deps({ api: plugin, storage: storage(STORE_BUILD_RECORD) }));

    expect(outcome).toBe('staged');
    expect(plugin.reset).not.toHaveBeenCalled();
  });

  it('does nothing when the bundle running is the deployed one', async () => {
    const plugin = api(SHA);

    const outcome = await runLiveUpdate(deps({ api: plugin, storage: storage(STORE_BUILD_RECORD) }));

    expect(outcome).toBe('current');
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(plugin.setNextBundle).not.toHaveBeenCalled();
  });

  it('waits for a store release when no bundle exists for this native layer', async () => {
    const plugin = api(null);

    const outcome = await runLiveUpdate(deps({ api: plugin, fetch: respond(404) }));

    expect(outcome).toBe('no-bundle');
    expect(capture).not.toHaveBeenCalled();
  });

  it('reports a server error', async () => {
    const outcome = await runLiveUpdate(deps({ api: api(null), fetch: respond(503) }));

    expect(outcome).toBe('failed');
    expect(capture).toHaveBeenCalledWith('live_update_failed', { reason: 'http_503' });
  });

  it('refuses a manifest that points anywhere else', async () => {
    const plugin = api(null);
    const outcome = await runLiveUpdate(
      deps({ api: plugin, fetch: respond(200, { ...MANIFEST, url: 'https://evil.example/x.zip' }) }),
    );

    expect(outcome).toBe('failed');
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('live_update_failed', { reason: 'invalid_manifest' });
  });

  it('never stages a bundle that was rolled back', async () => {
    const plugin = api(null, { getBlockedBundles: vi.fn(async () => ({ bundleIds: [SHA] })) });

    const outcome = await runLiveUpdate(deps({ api: plugin }));

    expect(outcome).toBe('blocked');
    expect(plugin.setNextBundle).not.toHaveBeenCalled();
  });

  it('does not download a bundle twice', async () => {
    const plugin = api(null, { getDownloadedBundles: vi.fn(async () => ({ bundleIds: [SHA] })) });

    const outcome = await runLiveUpdate(deps({ api: plugin }));

    expect(outcome).toBe('staged');
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(plugin.setNextBundle).toHaveBeenCalledWith({ bundleId: SHA });
  });

  it('reports a bad signature by its kind, never its text', async () => {
    const plugin = api(null, {
      downloadBundle: vi.fn(async () => {
        throw new Error('SIGNATURE_VERIFICATION_FAILED: /data/user/0/app.kikouchou/files');
      }),
    });

    const outcome = await runLiveUpdate(deps({ api: plugin }));

    expect(outcome).toBe('failed');
    expect(plugin.setNextBundle).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('live_update_failed', { reason: 'signature' });
  });

  it('reports a rollback, and still marks the default bundle ready', async () => {
    const plugin = api(null, {
      ready: vi.fn(async () => ({ currentBundleId: null, previousBundleId: SHA, rollback: true })),
    });

    await runLiveUpdate(deps({ api: plugin, fetch: respond(404) }));

    expect(plugin.ready).toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('live_update_failed', { reason: 'rolled_back' });
  });

  it('only marks the bundle ready when the build has no fingerprint', async () => {
    const plugin = api(null);
    const fetchManifest = respond(200);

    const outcome = await runLiveUpdate(deps({ api: plugin, fingerprint: '', fetch: fetchManifest }));

    expect(outcome).toBe('unavailable');
    expect(plugin.ready).toHaveBeenCalled();
    expect(fetchManifest).not.toHaveBeenCalled();
  });
});

describe('parseLiveUpdateManifest', () => {
  it('accepts what the deploy writes', () => {
    expect(parseLiveUpdateManifest(MANIFEST, ORIGIN)).toEqual(MANIFEST);
  });

  it.each([
    ['a short id', { ...MANIFEST, bundleId: 'abc' }],
    ['an id that is a path', { ...MANIFEST, bundleId: '../../etc' }],
    ['a URL on another origin', { ...MANIFEST, url: 'https://app.kikouchou.app.evil/live/x.zip' }],
    ['a URL outside /live/', { ...MANIFEST, url: `${ORIGIN}/x.zip` }],
    ['something that is not a zip', { ...MANIFEST, url: `${ORIGIN}/live/x.html` }],
    ['no signature', { ...MANIFEST, signature: '' }],
    ['not an object', 'nope'],
  ])('refuses %s', (_label, value) => {
    expect(parseLiveUpdateManifest(value, ORIGIN)).toBeNull();
  });
});
