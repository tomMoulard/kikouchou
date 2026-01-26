#!/usr/bin/env node

/**
 * PWA Icon Generator Script
 * 
 * Generates PNG icons from SVG source files for PWA manifest and iOS compatibility.
 * 
 * Requirements:
 * - Node.js 18+
 * - sharp package (installed as dev dependency)
 * 
 * Usage:
 *   node scripts/generate-icons.js
 * 
 * Or via npm script:
 *   npm run generate-icons
 * 
 * Output files:
 *   - public/icons/icon-192.png (192x192, for PWA manifest)
 *   - public/icons/icon-512.png (512x512, for PWA manifest)
 *   - public/icons/icon-maskable-192.png (192x192, maskable for Android)
 *   - public/icons/icon-maskable-512.png (512x512, maskable for Android)
 *   - public/icons/apple-touch-icon.png (180x180, for iOS home screen)
 *   - public/favicon.ico (multi-resolution, for legacy browsers)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const ICONS_DIR = join(ROOT_DIR, 'public', 'icons');

// Icon sizes to generate
const ICON_SIZES = [
  { name: 'icon-192.png', size: 192, source: 'icon.svg' },
  { name: 'icon-512.png', size: 512, source: 'icon.svg' },
  { name: 'icon-maskable-192.png', size: 192, source: 'icon-maskable.svg' },
  { name: 'icon-maskable-512.png', size: 512, source: 'icon-maskable.svg' },
  { name: 'apple-touch-icon.png', size: 180, source: 'icon.svg' },
];

const FAVICON_SIZES = [16, 32, 48];

async function main() {
  console.log('🎨 Kikoushou PWA Icon Generator\n');
  
  // Check if sharp is available
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch (error) {
    console.error('❌ Error: "sharp" package is not installed.');
    console.error('   Please install it first:');
    console.error('   npm install --save-dev sharp');
    console.error('   or');
    console.error('   bun add -D sharp\n');
    process.exit(1);
  }

  // Ensure icons directory exists
  if (!existsSync(ICONS_DIR)) {
    await mkdir(ICONS_DIR, { recursive: true });
    console.log('📁 Created icons directory');
  }

  // Generate PNG icons
  console.log('📦 Generating PNG icons...\n');
  
  for (const icon of ICON_SIZES) {
    const sourcePath = join(ICONS_DIR, icon.source);
    const outputPath = join(ICONS_DIR, icon.name);
    
    try {
      const svgBuffer = await readFile(sourcePath);
      
      await sharp(svgBuffer)
        .resize(icon.size, icon.size)
        .png()
        .toFile(outputPath);
      
      console.log(`   ✅ ${icon.name} (${icon.size}x${icon.size})`);
    } catch (error) {
      console.error(`   ❌ Failed to generate ${icon.name}: ${error.message}`);
    }
  }

  // Generate favicon.ico (multi-resolution)
  console.log('\n📦 Generating favicon.ico...\n');
  
  try {
    const faviconSvgPath = join(ROOT_DIR, 'public', 'favicon.svg');
    const faviconIcoPath = join(ROOT_DIR, 'public', 'favicon.ico');
    const svgBuffer = await readFile(faviconSvgPath);
    
    // Generate PNG buffers at different sizes
    const pngBuffers = await Promise.all(
      FAVICON_SIZES.map(async (size) => {
        const buffer = await sharp(svgBuffer)
          .resize(size, size)
          .png()
          .toBuffer();
        return { size, buffer };
      })
    );
    
    // For proper ICO generation, we'd need a specialized library
    // For now, we'll just use the 32x32 PNG as a single-resolution ICO
    // This works for most browsers
    const icoBuffer = pngBuffers.find(p => p.size === 32)?.buffer;
    if (icoBuffer) {
      // Note: This creates a PNG masquerading as ICO
      // For a true multi-resolution ICO, use a tool like png-to-ico
      await writeFile(faviconIcoPath, icoBuffer);
      console.log(`   ✅ favicon.ico (32x32 PNG format)`);
      console.log('   ℹ️  For true multi-resolution ICO, use: npx png-to-ico public/icons/icon-*.png > public/favicon.ico');
    }
  } catch (error) {
    console.error(`   ❌ Failed to generate favicon.ico: ${error.message}`);
  }

  console.log('\n✨ Icon generation complete!\n');
  console.log('Next steps:');
  console.log('1. Verify icons look correct at different sizes');
  console.log('2. Test on iOS device (add to home screen)');
  console.log('3. Run Lighthouse PWA audit to verify compliance');
  console.log('4. Update vite.config.ts to include PNG icons in manifest\n');
}

main().catch(console.error);
