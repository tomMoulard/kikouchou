#!/usr/bin/env node

/**
 * The fingerprint of the store apps' native layer.
 *
 * Usage:
 *   node scripts/native-fingerprint.js     # prints the fingerprint
 *
 * A live update (`src/lib/native/live-update.ts`) replaces the web bundle of
 * an installed app without a store release. The new bundle can only call the
 * native code that app was installed with, so it must be built against the same
 * native layer: the same plugins at the same versions, the same permissions,
 * the same Gradle and Xcode projects. This fingerprint names that layer. A
 * bundle is published under the fingerprint it was built with, and an app asks
 * only for the bundles of its own, so a change to anything below means a store
 * release before the change reaches anybody.
 *
 * What counts, as committed at `HEAD`:
 * - every file git tracks under `android/` and `ios/`. The web copies that
 *   `cap sync` writes there are ignored by git, so they never count;
 * - `capacitor.config.ts`, which lists the plugins and their configuration;
 * - the version of every `@capacitor/*` and `@capawesome/*` dependency.
 *
 * Committed content, not the working tree: `native.yml` regenerates the
 * Android icons before it builds and the deploy does not, so a working-tree
 * hash could differ between the store build and the deploy of one commit, and
 * that app would never be offered a bundle.
 *
 * `vite.config.ts` reads it into `VITE_NATIVE_FINGERPRINT` for every build, and
 * `scripts/build-live-update.sh` publishes under it.
 *
 * @module scripts/native-fingerprint
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** The tracked paths that make up the native layer. */
export const NATIVE_PATHS = ['android', 'ios', 'capacitor.config.ts'];

/** Dependencies that ship native code inside the apps. */
const NATIVE_PACKAGE = /^@(capacitor|capawesome)\//;

/** Hex characters kept: 64 bits, plenty to tell two native layers apart. */
const FINGERPRINT_LENGTH = 16;

/**
 * Computes the fingerprint from its inputs. Pure, so the tests can pin what
 * changes it and what does not.
 *
 * @param {ReadonlyArray<{ path: string, blob: string }>} files - The committed native files and their git blob ids
 * @param {Record<string, string>} dependencies - `package.json` dependencies
 * @returns {string} The fingerprint, 16 hex characters
 */
export function computeNativeFingerprint(files, dependencies) {
  const hash = createHash('sha256');
  for (const { path, blob } of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(`file\0${path}\0${blob}\n`);
  }
  for (const name of Object.keys(dependencies).filter((n) => NATIVE_PACKAGE.test(n)).sort()) {
    hash.update(`package\0${name}\0${dependencies[name]}\n`);
  }
  return hash.digest('hex').slice(0, FINGERPRINT_LENGTH);
}

/**
 * Reads the inputs from a checkout and computes the fingerprint.
 *
 * @param {string} root - The repository root
 * @returns {string} The fingerprint, or `''` outside a git checkout, which
 *   turns live updates off for that build
 */
export function readNativeFingerprint(root) {
  let listed;
  try {
    // `<mode> blob <id>\t<path>`, one entry per committed file.
    listed = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD', '--', ...NATIVE_PATHS], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
  const files = listed
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [meta = '', path = ''] = entry.split('\t');
      return { path, blob: meta.split(' ')[2] ?? '' };
    });
  if (files.length === 0) {
    return '';
  }
  const { dependencies = {} } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  return computeNativeFingerprint(files, dependencies);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fingerprint = readNativeFingerprint(resolve(import.meta.dirname, '..'));
  if (!fingerprint) {
    console.error('No native fingerprint: this is not a git checkout with android/ and ios/.');
    process.exit(1);
  }
  console.log(fingerprint);
}
