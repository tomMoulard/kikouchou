#!/usr/bin/env node

/**
 * Draws the Kikouchou mark in every appearance each platform asks for, and
 * writes the files the website, the iOS app and the Android app read.
 *
 * Usage:
 *   bun run generate-app-icons
 *
 * The mark is the patchwork house of the "Soleil couchant" brand kit, the one
 * the landing page carries (`kikouchou-LP/assets/img/logo.svg`): a Soleil roof
 * over three rooms in Corail, Framboise and Prune. The app's own icon is the
 * brand kit's `public/icons/icon.svg`: the bright mark on Nuit. That file, the
 * maskable one and the favicon come from the kit and are not written here.
 * This script writes the other appearances:
 *
 * - `dark`, the default: the brighter value of each hue on Nuit, as
 *   `icon.svg` draws it. The iOS icon, the Android launcher, the store
 *   listing, and the dark splash screens.
 * - `light`: the mark on Creme paper, the landing page's light theme, and the
 *   splash screen of a phone in light mode.
 * - `transparent`: the bright mark with nothing behind it, for a surface that
 *   draws its own background: the iOS icon in the Dark appearance and the
 *   Android adaptive-icon foreground.
 *
 * And one silhouette, `monochrome`: the four shapes in white, which Android 13
 * tints for themed icons and iOS 18 tints in the Tinted and Clear appearances.
 *
 * The web manifest has no way to pick an icon by light or dark appearance, so
 * the website carries the default icon plus the monochrome one, and the
 * favicon switches its own colours with `prefers-color-scheme`. The native
 * apps get every variant, because their platforms do choose.
 *
 * Output is deterministic and committed: the native projects need their icons
 * to build, and CI must not depend on a designer's machine. It runs before
 * `generate-icons.js` in `bun run generate-icons`, which rasterises the
 * website's SVGs.
 *
 * @module scripts/generate-app-icons
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'public', 'icons');
const ANDROID_RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const IOS_ASSETS = join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');

// ============================================================================
// The brand kit
// ============================================================================

const CREME = '#F6F0E4';
const NUIT = '#0F172A';

/** The four hues of the mark, and the brighter values the dark theme uses. */
const HUES = {
  light: { roof: '#F09A36', left: '#E25E4A', top: '#C4436B', bottom: '#7A3786' },
  dark: { roof: '#FFB85A', left: '#FF7C66', top: '#F0628F', bottom: '#B46CD6' },
  mono: { roof: '#FFFFFF', left: '#FFFFFF', top: '#FFFFFF', bottom: '#FFFFFF' },
};

const ROOF_PATH =
  'M10.76 28Q4 28 9.13 23.6L30.37 5.39Q32 4 33.63 5.39L54.87 23.6Q60 28 53.24 28L10.76 28Z';

/** The mark in its own 64-unit box, exactly as the brand kit draws it. */
function mark(hues) {
  return [
    `<path d="${ROOF_PATH}" fill="${hues.roof}"/>`,
    `<rect x="8" y="32" width="20" height="28" rx="2.5" fill="${hues.left}"/>`,
    `<rect x="32" y="32" width="24" height="12" rx="2.5" fill="${hues.top}"/>`,
    `<rect x="32" y="48" width="24" height="12" rx="2.5" fill="${hues.bottom}"/>`,
  ].join('');
}

/** The mark scaled to `size` and centred in a `width` by `height` box. */
function placed(hues, width, height, size) {
  const scale = size / 64;
  const x = ((width - size) / 2).toFixed(2);
  const y = ((height - size) / 2).toFixed(2);
  return `<g transform="translate(${x} ${y}) scale(${scale.toFixed(4)})">${mark(hues)}</g>`;
}

/**
 * The mark on a 512 square.
 *
 * `size` is the width the 64-unit mark takes. The brand kit's own icon uses
 * 368.64 (72%). An adaptive-icon foreground must keep its content inside the
 * middle 66 of 108 dp, and a maskable icon inside the central circle, so both
 * use less.
 */
function icon({ hues, background = null, size, radius = 0, round = false }) {
  let square = '';
  if (background !== null) {
    square = round
      ? `<circle cx="256" cy="256" r="256" fill="${background}"/>`
      : `<rect width="512" height="512"${radius > 0 ? ` rx="${radius}"` : ''} fill="${background}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${square}${placed(hues, 512, 512, size)}</svg>\n`;
}

/** A splash screen: the mark, small, in the middle of the background. */
function splash(width, height, background, hues) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${background}"/>` +
    `${placed(hues, width, height, Math.min(width, height) * 0.28)}</svg>`
  );
}

// ============================================================================
// Outputs
// ============================================================================

/** The brand kit's own proportion: the mark takes 72% of the square. */
const BRAND_SIZE = 368.64;
/** Inside the adaptive-icon safe zone, 66 of 108 dp, with a margin. */
const ADAPTIVE_SIZE = 512 * (60 / 108);

const WEB_SVGS = {
  'icon-light.svg': icon({ hues: HUES.light, background: CREME, size: BRAND_SIZE, radius: 96 }),
  'icon-transparent.svg': icon({ hues: HUES.dark, size: 448 }),
  'icon-monochrome.svg': icon({ hues: HUES.mono, size: 400 }),
};

const WEB_PNGS = [
  { name: 'icon-monochrome-512.png', svg: WEB_SVGS['icon-monochrome.svg'], size: 512 },
  { name: 'icon-light-512.png', svg: WEB_SVGS['icon-light.svg'], size: 512 },
  { name: 'icon-transparent-512.png', svg: WEB_SVGS['icon-transparent.svg'], size: 512 },
];

/** The app's own icon, as the brand kit's `public/icons/icon.svg` draws it. */
const DEFAULT_ICON = { hues: HUES.dark, background: NUIT, size: BRAND_SIZE };

/** Android density buckets and their scale over mdpi. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

function contents(images) {
  return `${JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2)}\n`;
}

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('The "sharp" package is not installed. Run `bun install` first.');
    process.exit(1);
  }

  const png = (svg, size, path) =>
    sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(path);
  const pngAsDrawn = (svg, path) => sharp(Buffer.from(svg)).png().toFile(path);

  // Website
  await mkdir(ICONS, { recursive: true });
  for (const [name, svg] of Object.entries(WEB_SVGS)) {
    await writeFile(join(ICONS, name), svg);
  }
  for (const { name, svg, size } of WEB_PNGS) {
    await png(svg, size, join(ICONS, name));
  }
  await rm(join(ICONS, 'icon-dark.svg'), { force: true });
  console.log('website: light, transparent and monochrome icons');

  // The store listing's icon, read by F-Droid, IzzyOnDroid and Play's `supply`.
  for (const locale of ['en-US', 'fr-FR']) {
    const folder = join(ROOT, 'fastlane', 'metadata', 'android', locale, 'images');
    await mkdir(folder, { recursive: true });
    await png(icon(DEFAULT_ICON), 512, join(folder, 'icon.png'));
  }

  // Android
  if (existsSync(ANDROID_RES)) {
    const foreground = icon({ hues: HUES.dark, size: ADAPTIVE_SIZE });
    const monochrome = icon({ hues: HUES.mono, size: ADAPTIVE_SIZE });
    const legacy = icon({ ...DEFAULT_ICON, radius: 96 });
    const round = icon({ hues: HUES.dark, background: NUIT, size: 300, round: true });

    for (const [bucket, factor] of Object.entries(DENSITIES)) {
      const folder = join(ANDROID_RES, `mipmap-${bucket}`);
      await mkdir(folder, { recursive: true });
      await png(legacy, Math.round(48 * factor), join(folder, 'ic_launcher.png'));
      await png(round, Math.round(48 * factor), join(folder, 'ic_launcher_round.png'));
      await png(foreground, Math.round(108 * factor), join(folder, 'ic_launcher_foreground.png'));
      await png(monochrome, Math.round(108 * factor), join(folder, 'ic_launcher_monochrome.png'));
    }

    // Splash: Creme with the mark, and Nuit with the bright mark in a matching
    // `-night` folder, which Android picks when the phone is in dark mode.
    for (const entry of await readdir(ANDROID_RES)) {
      const file = join(ANDROID_RES, entry, 'splash.png');
      if (!entry.startsWith('drawable') || entry.includes('-night') || !existsSync(file)) {
        continue;
      }
      const { width, height } = await sharp(file).metadata();
      await pngAsDrawn(splash(width, height, CREME, HUES.light), `${file}.tmp`);
      await rename(`${file}.tmp`, file);
      // Android reads qualifiers in a fixed order: the orientation comes
      // before the night mode, so `drawable-port-night-xhdpi`, not the reverse.
      const night = join(
        ANDROID_RES,
        entry === 'drawable'
          ? 'drawable-night'
          : entry.replace(/^drawable-(port|land)/, 'drawable-$1-night'),
      );
      await mkdir(night, { recursive: true });
      await pngAsDrawn(splash(width, height, NUIT, HUES.dark), join(night, 'splash.png'));
    }
    console.log('android: adaptive icon with a monochrome layer, legacy icons, light and dark splash');
  }

  // iOS: one 1024 icon per appearance. Opaque squares: iOS rounds the corners.
  if (existsSync(IOS_ASSETS)) {
    const folder = join(IOS_ASSETS, 'AppIcon.appiconset');
    await mkdir(folder, { recursive: true });
    await png(icon(DEFAULT_ICON), 1024, join(folder, 'AppIcon-512@2x.png'));
    // Dark: the bright mark and no square; iOS draws its own dark backdrop.
    await png(icon({ hues: HUES.dark, size: BRAND_SIZE }), 1024, join(folder, 'AppIcon-dark.png'));
    // Tinted and Clear: a white silhouette the system colours itself.
    await png(icon({ hues: HUES.mono, size: BRAND_SIZE }), 1024, join(folder, 'AppIcon-tinted.png'));
    await writeFile(
      join(folder, 'Contents.json'),
      contents([
        { filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
        {
          appearances: [{ appearance: 'luminosity', value: 'dark' }],
          filename: 'AppIcon-dark.png',
          idiom: 'universal',
          platform: 'ios',
          size: '1024x1024',
        },
        {
          appearances: [{ appearance: 'luminosity', value: 'tinted' }],
          filename: 'AppIcon-tinted.png',
          idiom: 'universal',
          platform: 'ios',
          size: '1024x1024',
        },
      ]),
    );

    // Splash: a light and a dark image, picked by the system appearance.
    const splashFolder = join(IOS_ASSETS, 'Splash.imageset');
    await mkdir(splashFolder, { recursive: true });
    await pngAsDrawn(splash(2732, 2732, CREME, HUES.light), join(splashFolder, 'splash-2732x2732.png'));
    await pngAsDrawn(splash(2732, 2732, NUIT, HUES.dark), join(splashFolder, 'splash-2732x2732-dark.png'));
    for (const stale of ['splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
      await rm(join(splashFolder, stale), { force: true });
    }
    await writeFile(
      join(splashFolder, 'Contents.json'),
      contents([
        { idiom: 'universal', filename: 'splash-2732x2732.png' },
        {
          idiom: 'universal',
          filename: 'splash-2732x2732-dark.png',
          appearances: [{ appearance: 'luminosity', value: 'dark' }],
        },
      ]),
    );
    console.log('ios: light, dark and tinted app icons, light and dark splash');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
