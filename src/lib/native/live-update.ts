/**
 * @fileoverview Live updates: a new web bundle for the store apps, without a
 * store release.
 *
 * The apps load the Vite build from files inside the app (`capacitor.config.ts`).
 * Every website deploy also publishes that build for the apps, signed, at
 * `<public origin>/live/<fingerprint>.json` (`scripts/build-live-update.sh`).
 * Once per launch, {@link startLiveUpdate} reads that manifest, downloads a
 * bundle it does not have, and makes it the one the next launch starts with.
 * Nothing reloads under the user's feet: Dexie holds IndexedDB open, and the
 * plugin's `reload()` keeps those locks.
 *
 * The fingerprint (`scripts/native-fingerprint.js`) names the native layer a
 * bundle was built against. A bundle is only offered to an app with the same
 * native layer, because it can only call the plugins that app shipped with.
 * Anything that changes it needs a store release first.
 *
 * The plugin does not go back to the store build's bundle when the store
 * installs a new version, so a downloaded bundle would keep running on top of
 * native code it was not built for. Each store build therefore records its own
 * fingerprint the first time it runs its own bundle, keyed by its version code,
 * and a downloaded bundle that finds no record, or another fingerprint, resets
 * to the store build's bundle for the next launch.
 *
 * Signatures are checked by the plugin, against the public key in
 * `capacitor.config.ts`. A bundle that crashes before `NativeShell` calls
 * {@link startLiveUpdate} is rolled back after 15 seconds and blocked.
 *
 * The F-Droid build has no live updates (`capacitor.config.ts`), and the
 * website never calls this.
 *
 * @module lib/native/live-update
 */

import { LiveUpdate } from '@capawesome/capacitor-live-update';

import { captureEvent } from '@/lib/posthog';
import { getPublicAppOrigin, hasNativePlugin } from '@/lib/platform';

// ============================================================================
// Type Definitions
// ============================================================================

/** What `/live/<fingerprint>.json` says, once checked. */
export interface LiveUpdateManifest {
  /** The commit the bundle was built from, which is also its bundle id. */
  readonly bundleId: string;
  /** Where the zip is, under `<public origin>/live/`. */
  readonly url: string;
  /** SHA256withRSA over the zip, base64. */
  readonly signature: string;
}

/** The plugin calls this module makes, so a test can stand in for them. */
export type LiveUpdateApi = Pick<
  typeof LiveUpdate,
  | 'ready'
  | 'getVersionCode'
  | 'reset'
  | 'getBlockedBundles'
  | 'getDownloadedBundles'
  | 'downloadBundle'
  | 'setNextBundle'
>;

/** Everything {@link startLiveUpdate} reads from outside. */
export interface LiveUpdateDeps {
  readonly api: LiveUpdateApi;
  readonly fingerprint: string;
  readonly origin: string;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly fetch: typeof fetch;
}

/** How a launch ended, for the tests and for nobody else. */
export type LiveUpdateOutcome =
  | 'unavailable'
  | 'current'
  | 'reset'
  | 'no-bundle'
  | 'blocked'
  | 'staged'
  | 'failed';

// ============================================================================
// Constants
// ============================================================================

/** The plugin's registered name. */
const PLUGIN_NAME = 'LiveUpdate';

/** Where a store build records the fingerprint of its own bundle. */
const NATIVE_FINGERPRINT_KEY_PREFIX = 'kikouchou-native-fingerprint:';

/** A bundle id is the 40-character commit sha the bundle was built from. */
const BUNDLE_ID_PATTERN = /^[0-9a-f]{40}$/;

/** A fingerprint as `scripts/native-fingerprint.js` prints it. */
const FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;

/** A 2048-bit RSA signature in base64 is 344 characters. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{16,1024}={0,2}$/;

/** Set once the first call ran, so a remount does not download twice. */
let started = false;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Checks the manifest. It comes from our own deploy, but it is still input
 * from the network: a URL elsewhere, or an id that could name a file path, is
 * refused rather than handed to the plugin.
 *
 * @param value - The parsed JSON
 * @param origin - The public origin the bundle must live under
 * @returns The manifest, or `null` when anything is off
 */
export function parseLiveUpdateManifest(value: unknown, origin: string): LiveUpdateManifest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { bundleId, url, signature } = value as Record<string, unknown>;
  if (typeof bundleId !== 'string' || !BUNDLE_ID_PATTERN.test(bundleId)) {
    return null;
  }
  if (typeof url !== 'string' || !url.startsWith(`${origin}/live/`) || !url.endsWith('.zip')) {
    return null;
  }
  if (typeof signature !== 'string' || !SIGNATURE_PATTERN.test(signature)) {
    return null;
  }
  return { bundleId, url, signature };
}

/** A short, stable reason for an error, never its message text. */
function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/signature/i.test(message)) {
    return 'signature';
  }
  if (/checksum/i.test(message)) {
    return 'checksum';
  }
  if (/network|timeout|connect|offline|host/i.test(message)) {
    return 'network';
  }
  return 'error';
}

// ============================================================================
// Live update
// ============================================================================

/**
 * Tells the plugin this bundle started, then stages a newer one for the next
 * launch when the deploy has one for this native layer. Never throws.
 *
 * @param deps - The plugin and the inputs; the real ones by default
 * @returns How this launch ended
 */
export async function runLiveUpdate(deps: LiveUpdateDeps): Promise<LiveUpdateOutcome> {
  const { api, fingerprint, origin, storage } = deps;
  try {
    // First, always: without it the plugin rolls this bundle back.
    const ready = await api.ready();
    if (ready.rollback) {
      captureEvent('live_update_failed', { reason: 'rolled_back' });
    }
    if (!FINGERPRINT_PATTERN.test(fingerprint)) {
      return 'unavailable';
    }

    const current = ready.currentBundleId;
    const { versionCode } = await api.getVersionCode();
    const key = `${NATIVE_FINGERPRINT_KEY_PREFIX}${versionCode}`;
    if (current === null) {
      // The store build's own bundle: its fingerprint is the native one.
      storage.setItem(key, fingerprint);
    } else {
      const native = storage.getItem(key);
      if (native !== fingerprint) {
        await api.reset();
        captureEvent('live_update_reset', {
          reason: native === null ? 'store_update' : 'fingerprint_mismatch',
        });
        return 'reset';
      }
    }

    const response = await deps.fetch(`${origin}/live/${fingerprint}.json`, { cache: 'no-store' });
    if (response.status === 404) {
      return 'no-bundle';
    }
    if (!response.ok) {
      captureEvent('live_update_failed', { reason: `http_${response.status}` });
      return 'failed';
    }
    const manifest = parseLiveUpdateManifest(await response.json(), origin);
    if (!manifest) {
      captureEvent('live_update_failed', { reason: 'invalid_manifest' });
      return 'failed';
    }
    if (manifest.bundleId === current) {
      return 'current';
    }

    const { bundleIds: blocked } = await api.getBlockedBundles();
    if (blocked.includes(manifest.bundleId)) {
      return 'blocked';
    }
    const { bundleIds: downloaded } = await api.getDownloadedBundles();
    if (!downloaded.includes(manifest.bundleId)) {
      await api.downloadBundle({
        url: manifest.url,
        bundleId: manifest.bundleId,
        signature: manifest.signature,
      });
      captureEvent('live_update_downloaded', { bundle: manifest.bundleId.slice(0, 7) });
    }
    await api.setNextBundle({ bundleId: manifest.bundleId });
    return 'staged';
  } catch (error) {
    console.error('Live update failed:', error);
    captureEvent('live_update_failed', { reason: failureReason(error) });
    return 'failed';
  }
}

/**
 * Runs {@link runLiveUpdate} once per launch, in a store app that has the
 * plugin. Called by `NativeShell` after the first paint.
 */
export function startLiveUpdate(): void {
  if (started || !hasNativePlugin(PLUGIN_NAME)) {
    return;
  }
  started = true;
  void runLiveUpdate({
    api: LiveUpdate,
    fingerprint: import.meta.env.VITE_NATIVE_FINGERPRINT ?? '',
    origin: getPublicAppOrigin(),
    storage: window.localStorage,
    fetch: window.fetch.bind(window),
  });
}
