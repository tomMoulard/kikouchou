#!/usr/bin/env node

/**
 * Keeps the previous deploys' chunks alive on GitHub Pages.
 *
 * Usage:
 *   node scripts/carry-previous-assets.js [dist] [origin]
 *
 * `dist` defaults to `dist`, `origin` to `$DEPLOY_ORIGIN`. The build sha comes
 * from `$GITHUB_SHA`, falling back to `$VITE_APP_VERSION`.
 *
 * ## Why this exists
 *
 * `actions/deploy-pages` publishes a full snapshot of `dist`, so every hashed
 * file under `assets/` from the deploy before it is *deleted* the moment the
 * new one goes live. A tab that booted on the old build and has not reloaded
 * then asks for a chunk nothing serves any more, and `import()` rejects:
 * `https://app.kikouchou.app/assets/TripEditPage-CfPSMXkw.js` answered 404 with
 * the 404 page's HTML for a session that had been open three days. Five such
 * sessions reached error tracking between 2026-09-14 and 2026-09-20 — one of
 * them on the Supabase client chunk, where nothing recovers the tab.
 *
 * Hosts that keep old immutable assets around make this a non-problem. Pages
 * does not, so the previous builds' files are downloaded from the live site and
 * shipped again inside the new artifact. {@link GENERATIONS_KEPT} bounds it: a
 * tab older than that still breaks, and still has the guarded reload in
 * `src/lib/pwa/stale-chunk.ts` to recover on.
 *
 * The live artifact is the source, not the previous CI run's:
 * `upload-pages-artifact` keeps its `github-pages` artifact for one day, so on
 * any week without a daily deploy there is nothing left to download. The
 * deployed site is always there.
 *
 * Nothing here is allowed to fail a deploy. An unreachable origin, a manifest
 * that will not parse, a file that 404s — each is a warning, and the deploy goes
 * out carrying whatever was reachable. Shipping the new build always beats
 * holding it back to rescue old tabs.
 *
 * @module scripts/carry-previous-assets
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

// ============================================================================
// Constants
// ============================================================================

/** Where the list of a deploy's own files is published, inside `dist`. */
export const MANIFEST_FILENAME = 'deploy-assets.json',
  /** The shape written below, so a future reader can refuse what it predates. */
  MANIFEST_VERSION = 1,
  /**
   * How many builds' assets the site holds, this one included.
   *
   * Three covers the window that matters: a tab is stale from the deploy after
   * the one it booted on, and two deploys of grace is a working day for a phone
   * left on the trip list overnight. It also bounds the site — each generation
   * is a few megabytes against the 1GB Pages limit — and bounds this script,
   * which downloads every carried file on every deploy.
   */
  GENERATIONS_KEPT = 3,
  /**
   * The only paths that may be carried.
   *
   * A flat file directly under `assets/`, which is everything Vite emits there.
   * The manifest is fetched over the network from a site anyone can serve if
   * DNS moves under us, so this is the guard that keeps a `..` or an absolute
   * path in it from writing outside `dist`. Source maps never ship — the deploy
   * strips them — so a manifest naming one is refused rather than obeyed.
   */
  CARRYABLE_PATH = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ============================================================================
// Public API
// ============================================================================

/**
 * Whether a path from a fetched manifest is one this script may write.
 *
 * @param {string} path - Path as the manifest spells it, relative to the site root
 * @returns {boolean} True when the path is a flat file under `assets/` and not a source map
 */
export function isCarryablePath(path) {
  return typeof path === 'string' && CARRYABLE_PATH.test(path) && !path.endsWith('.map');
}

/**
 * Reads a published manifest, or nothing when it cannot be trusted.
 *
 * Every rejection here is normal rather than exceptional: the first deploy has
 * no manifest at all, and a deploy that predates this script serves the 404
 * page's HTML under that name.
 *
 * @param {string} text - Raw response body
 * @returns {{version: number, sha: string, generations: Array<{sha: string, assets: string[]}>}|null} The manifest, or null
 */
export function readManifest(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.version !== MANIFEST_VERSION) return null;
  if (!Array.isArray(parsed.generations)) return null;

  const generations = parsed.generations
    .filter((entry) => entry && typeof entry.sha === 'string' && Array.isArray(entry.assets))
    .map((entry) => ({ sha: entry.sha, assets: entry.assets.filter(isCarryablePath) }));

  return { version: MANIFEST_VERSION, sha: String(parsed.sha ?? ''), generations };
}

/**
 * What to download, and what the new manifest will say.
 *
 * The current build is always the first generation, so its own files are never
 * downloaded — a hash that survived a rebuild names identical bytes, and the
 * fresh ones on disk are the trustworthy copy either way.
 *
 * A previous generation built from the same sha is dropped rather than kept
 * beside this one: a re-run of the same commit emits the same hashes, so it
 * would spend one of the three slots saying nothing new.
 *
 * @param {object} input - Inputs
 * @param {{generations: Array<{sha: string, assets: string[]}>}|null} input.previous - Manifest from the live site
 * @param {string[]} input.ownAssets - Paths this build emitted, relative to the site root
 * @param {string} input.sha - This build's sha
 * @param {number} [input.keep] - Generations to keep, this one included
 * @returns {{download: string[], generations: Array<{sha: string, assets: string[]}>}} The plan
 */
export function planCarryOver({ previous, ownAssets, sha, keep = GENERATIONS_KEPT }) {
  const own = ownAssets.filter(isCarryablePath).sort(),
    mine = new Set(own),
    past = (previous?.generations ?? []).filter((entry) => entry.sha !== sha),
    generations = [{ sha, assets: own }, ...past].slice(0, Math.max(1, keep)),
    download = [];

  const seen = new Set(mine);
  for (const generation of generations.slice(1)) {
    for (const path of generation.assets) {
      if (seen.has(path)) continue;
      seen.add(path);
      download.push(path);
    }
  }

  return { download, generations };
}

/**
 * The manifest to publish, with the paths that could not be fetched removed.
 *
 * Dropping them is what stops a file that has fallen off the site for good from
 * being chased on every deploy from here to eternity.
 *
 * @param {object} input - Inputs
 * @param {string} input.sha - This build's sha
 * @param {Array<{sha: string, assets: string[]}>} input.generations - Planned generations
 * @param {Iterable<string>} input.missing - Paths whose download failed
 * @param {string} input.builtAt - ISO timestamp for the record
 * @returns {object} The manifest to write
 */
export function manifestToPublish({ sha, generations, missing, builtAt }) {
  const gone = new Set(missing);

  return {
    version: MANIFEST_VERSION,
    sha,
    built_at: builtAt,
    generations: generations
      .map((entry) => ({ sha: entry.sha, assets: entry.assets.filter((p) => !gone.has(p)) }))
      .filter((entry) => entry.assets.length > 0),
  };
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Fetches the live manifest, or nothing when the site cannot answer for it.
 *
 * @param {string} origin - Origin of the deployed site
 * @returns {Promise<object|null>} The manifest, or null
 */
async function fetchPreviousManifest(origin) {
  const url = new URL(MANIFEST_FILENAME, `${origin.replace(/\/$/, '')}/`).href;

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.warn(`::warning title=No asset carry-over::${url} is unreachable (${error}). This deploy ships its own assets only.`);
    return null;
  }

  if (!response.ok) {
    console.warn(`::warning title=No asset carry-over::${url} answered ${response.status}. Expected on the first deploy after this script lands.`);
    return null;
  }

  const manifest = readManifest(await response.text());
  if (!manifest) {
    console.warn(`::warning title=No asset carry-over::${url} is not a manifest this script understands.`);
  }
  return manifest;
}

/**
 * Downloads one carried file into `dist`.
 *
 * @param {string} origin - Origin of the deployed site
 * @param {string} distDir - Absolute path of the build output
 * @param {string} path - Site-relative path, already validated
 * @returns {Promise<boolean>} True when the file landed
 */
async function download(origin, distDir, path) {
  const url = new URL(path, `${origin.replace(/\/$/, '')}/`).href;

  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    await writeFile(resolve(distDir, path), Buffer.from(await response.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the carry-over against a built `dist`.
 *
 * @returns {Promise<void>} Resolves once the manifest is written
 */
async function main() {
  const distDir = resolve(process.cwd(), process.argv[2] ?? 'dist'),
    origin = process.argv[3] ?? process.env.DEPLOY_ORIGIN ?? '',
    sha = process.env.GITHUB_SHA ?? process.env.VITE_APP_VERSION ?? 'unknown';

  let ownAssets = [];
  try {
    ownAssets = (await readdir(resolve(distDir, 'assets'))).map((name) => `assets/${name}`);
  } catch (error) {
    console.warn(`::warning title=No asset carry-over::${distDir}/assets cannot be read (${error}).`);
  }

  const previous = origin ? await fetchPreviousManifest(origin) : null;
  if (!origin) {
    console.warn('::warning title=No asset carry-over::DEPLOY_ORIGIN is unset, so there is no site to carry assets from.');
  }

  const { download: wanted, generations } = planCarryOver({ previous, ownAssets, sha });

  await mkdir(resolve(distDir, 'assets'), { recursive: true });

  const missing = [];
  for (const path of wanted) {
    if (!(await download(origin, distDir, path))) missing.push(path);
  }

  const manifest = manifestToPublish({
    sha,
    generations,
    missing,
    builtAt: new Date().toISOString(),
  });

  await writeFile(resolve(distDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `[carry-previous-assets] ${ownAssets.length} own, ${wanted.length - missing.length} carried, ${missing.length} gone, ${manifest.generations.length} generations published.`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
