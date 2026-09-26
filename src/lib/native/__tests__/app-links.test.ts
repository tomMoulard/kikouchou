/**
 * @fileoverview The website's app-link files and the Android manifest agree.
 *
 * A path claimed in one and not the other fails in the worst way: silently.
 * iOS or Android keeps opening the browser, and nothing reports it.
 *
 * @module lib/native/__tests__/app-links.test
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  APP_ID,
  APP_LINK_PATH_PREFIXES,
  appleAppSiteAssociation,
  assetLinks,
} from '../../../../app-links';

const ROOT = resolve(__dirname, '../../../..');

function androidManifest(): string {
  return readFileSync(resolve(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
}

describe('app links', () => {
  it('claims in the Android manifest exactly the paths the website file claims', () => {
    const declared = [...androidManifest().matchAll(/android:pathPrefix="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(declared.sort()).toEqual([...APP_LINK_PATH_PREFIXES].sort());
  });

  it('never claims the root, where a web sign-in returns', () => {
    expect(APP_LINK_PATH_PREFIXES).not.toContain('/');
    const document = appleAppSiteAssociation('ABCDE12345') as {
      applinks: { details: { components: { '/': string }[] }[] };
    };
    const paths = document.applinks.details[0]?.components.map((component) => component['/']);

    expect(paths).not.toContain('/');
    expect(paths).not.toContain('/*');
    expect(paths).toContain('/join/*');
    expect(paths).toContain('/trips');
    expect(paths).toContain('/trips/*');
  });

  it('names the app on both platforms', () => {
    const apple = appleAppSiteAssociation('ABCDE12345') as {
      applinks: { details: { appIDs: string[] }[] };
      webcredentials: { apps: string[] };
    };
    expect(apple.applinks.details[0]?.appIDs).toEqual([`ABCDE12345.${APP_ID}`]);
    expect(apple.webcredentials.apps).toEqual([`ABCDE12345.${APP_ID}`]);

    const android = assetLinks(['AA:BB']) as {
      target: { package_name: string; sha256_cert_fingerprints: string[] };
    }[];
    expect(android[0]?.target.package_name).toBe(APP_ID);
    expect(android[0]?.target.sha256_cert_fingerprints).toEqual(['AA:BB']);
  });

  it('uses the same app id as the Capacitor configuration and both native projects', () => {
    expect(readFileSync(resolve(ROOT, 'capacitor.config.ts'), 'utf8')).toContain(
      `const APP_ID = '${APP_ID}'`,
    );
    expect(readFileSync(resolve(ROOT, 'android/app/build.gradle'), 'utf8')).toContain(
      `applicationId "${APP_ID}"`,
    );
    expect(
      readFileSync(resolve(ROOT, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8'),
    ).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${APP_ID};`);
  });
});
