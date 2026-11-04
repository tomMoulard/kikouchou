/**
 * @fileoverview The fingerprint that decides which installed apps a live
 * update reaches.
 *
 * A change that moves it means a store release before anybody gets the new
 * bundle; a change that should move it and does not means a bundle calling
 * native code the installed app does not have. Both directions are pinned.
 *
 * @module scripts/__tests__/native-fingerprint
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeNativeFingerprint, readNativeFingerprint } from '../native-fingerprint.js';

const FILES = [
  { path: 'android/app/build.gradle', blob: '1'.repeat(40) },
  { path: 'ios/App/App/Info.plist', blob: '2'.repeat(40) },
  { path: 'capacitor.config.ts', blob: '3'.repeat(40) },
];

const DEPENDENCIES = {
  '@capacitor/core': '8.5.2',
  '@capawesome/capacitor-live-update': '8.7.1',
  react: '19.2.0',
};

describe('computeNativeFingerprint', () => {
  const base = computeNativeFingerprint(FILES, DEPENDENCIES);

  it('is 16 hex characters', () => {
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not depend on the order files are listed in', () => {
    expect(computeNativeFingerprint([...FILES].reverse(), DEPENDENCIES)).toBe(base);
  });

  it('moves when a native file changes', () => {
    const changed = FILES.map((f) => (f.path.startsWith('android') ? { ...f, blob: '4'.repeat(40) } : f));
    expect(computeNativeFingerprint(changed, DEPENDENCIES)).not.toBe(base);
  });

  it('moves when a native file is added', () => {
    const added = [...FILES, { path: 'android/app/src/main/res/x.xml', blob: '5'.repeat(40) }];
    expect(computeNativeFingerprint(added, DEPENDENCIES)).not.toBe(base);
  });

  it('moves when a plugin version changes', () => {
    const bumped = { ...DEPENDENCIES, '@capacitor/core': '8.5.3' };
    expect(computeNativeFingerprint(FILES, bumped)).not.toBe(base);
  });

  it('ignores a web-only dependency', () => {
    const bumped = { ...DEPENDENCIES, react: '19.3.0' };
    expect(computeNativeFingerprint(FILES, bumped)).toBe(base);
  });
});

describe('readNativeFingerprint', () => {
  it('reads this checkout', () => {
    expect(readNativeFingerprint(resolve(import.meta.dirname, '../..'))).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is empty outside a git checkout, which turns live updates off', () => {
    expect(readNativeFingerprint('/')).toBe('');
  });
});
