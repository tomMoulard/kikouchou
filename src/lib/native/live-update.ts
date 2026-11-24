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

import { CapacitorHttp } from '@capacitor/core';
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
  | 'getCurrentBundle'
  | 'reload'
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

/**
 * How a check from the Settings button ended. `reloading` means the web view
 * is being replaced by the newer bundle.
 */
export type LiveUpdateCheckOutcome = 'unavailable' | 'current' | 'blocked' | 'reloading' | 'failed';

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

/** The launch's run, kept so a remount does not download twice. */
let launch: Promise<LiveUpdateOutcome> | null = null;

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
  if (/could not be downloaded/i.test(message)) {
    return 'download';
  }
  return 'error';
}

// ============================================================================
// Live update
// ============================================================================

/**
 * Reads the deployed manifest for this native layer and stages its bundle for
 * the next start, downloading it when it is not on the device yet. Throws on a
 * plugin or network error: both callers report it.
 *
 * @param deps - The plugin and the inputs
 * @param current - The bundle running now, `null` for the store build's own
 * @returns `staged` when a newer bundle is next
 */
async function stageLatestBundle(
  deps: LiveUpdateDeps,
  current: string | null,
): Promise<Extract<LiveUpdateOutcome, 'no-bundle' | 'failed' | 'current' | 'blocked' | 'staged'>> {
  const { api, fingerprint, origin } = deps;
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
}

/**
 * Tells the plugin this bundle started, then stages a newer one for the next
 * launch when the deploy has one for this native layer. Never throws.
 *
 * @param deps - The plugin and the inputs; the real ones by default
 * @returns How this launch ended
 */
export async function runLiveUpdate(deps: LiveUpdateDeps): Promise<LiveUpdateOutcome> {
  const { api, fingerprint, storage } = deps;
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

    return await stageLatestBundle(deps, current);
  } catch (error) {
    // A warning: the event below reports it, and the next launch tries again.
    console.warn('Live update failed:', error);
    captureEvent('live_update_failed', { reason: failureReason(error) });
    return 'failed';
  }
}

/** Statuses a `Response` must be built without a body for. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

/**
 * Fetches outside the web view, through Capacitor's native HTTP client.
 *
 * The Android app serves its pages as `https://app.kikouchou.app`
 * (`server.hostname` in `capacitor.config.ts`), and its web view answers every
 * request to that host from the files inside the app. The manifest lives on
 * the real host, so a plain `fetch` would read the app's own files, find no
 * `/live/…`, and never see a newer bundle. The native client goes to the
 * network.
 *
 * @param input - The URL to read
 * @returns The answer, as a `Response`
 */
async function fetchOutsideWebView(input: RequestInfo | URL): Promise<Response> {
  const response = await CapacitorHttp.get({
    url: String(input),
    responseType: 'text',
    headers: { 'Cache-Control': 'no-cache' },
  });
  const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  return new Response(NULL_BODY_STATUSES.has(response.status) ? null : body, {
    status: response.status,
  });
}

/** The real plugin and inputs. */
function realDeps(): LiveUpdateDeps {
  return {
    api: LiveUpdate,
    fingerprint: import.meta.env.VITE_NATIVE_FINGERPRINT ?? '',
    origin: getPublicAppOrigin(),
    storage: window.localStorage,
    fetch: fetchOutsideWebView as typeof fetch,
  };
}

/** The launch's run, started on the first call and shared after it. */
function launchLiveUpdate(): Promise<LiveUpdateOutcome> {
  launch ??= runLiveUpdate(realDeps());
  return launch;
}

/**
 * Runs {@link runLiveUpdate} once per launch, in a store app that has the
 * plugin. Called by `NativeShell` after the first paint.
 */
export function startLiveUpdate(): void {
  if (!hasNativePlugin(PLUGIN_NAME)) {
    return;
  }
  void launchLiveUpdate();
}

/** Whether this app can take a live update at all. False on the web and in the F-Droid build. */
export function canLiveUpdate(): boolean {
  return hasNativePlugin(PLUGIN_NAME);
}

/**
 * Looks for a newer bundle now, and switches to it at once.
 *
 * The launch's own run never reloads, because nobody asked it to. A tap on the
 * Settings button is that request, so this reloads the web view onto a bundle
 * the launch already staged, or onto one it stages itself. IndexedDB survives
 * the reload: Dexie keeps it open across the plugin's `reload()`.
 *
 * @param deps - The plugin and the inputs
 * @param launched - How the launch's run ended; it must be over first, because
 *   it is the one that checks the bundle against the native layer
 * @returns How the check ended
 */
export async function checkLiveUpdateNow(
  deps: LiveUpdateDeps,
  launched: LiveUpdateOutcome,
): Promise<LiveUpdateCheckOutcome> {
  if (launched === 'unavailable') {
    return 'unavailable';
  }
  const { api } = deps;
  try {
    // `staged`: a newer bundle is already next. `reset`: the store build's
    // own bundle is next, and the next launch looks for a newer one on top.
    if (launched !== 'staged' && launched !== 'reset') {
      const { bundleId } = await api.getCurrentBundle();
      const staged = await stageLatestBundle(deps, bundleId);
      if (staged === 'failed') {
        return 'failed';
      }
      if (staged === 'blocked') {
        return 'blocked';
      }
      // `no-bundle` means no web update exists for this native layer yet.
      if (staged !== 'staged') {
        return 'current';
      }
    }
    await api.reload();
    return 'reloading';
  } catch (error) {
    console.warn('Live update check failed:', error);
    captureEvent('live_update_failed', { reason: failureReason(error) });
    return 'failed';
  }
}

/**
 * {@link checkLiveUpdateNow} with the real plugin, after the launch's run.
 *
 * @returns How the check ended
 */
export async function applyLiveUpdateNow(): Promise<LiveUpdateCheckOutcome> {
  if (!canLiveUpdate()) {
    return 'unavailable';
  }
  return checkLiveUpdateNow(realDeps(), await launchLiveUpdate());
}
