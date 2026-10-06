/**
 * @fileoverview Stand-in for `virtual:pwa-register` under Vitest.
 *
 * vite-plugin-pwa creates that module inside a Vite build only, so Vitest
 * cannot resolve it, and every file that imports it fails to load. The alias
 * in `vitest.config.ts` points here. A test replaces it with `vi.mock`.
 *
 * @module test/pwa-register-stub
 */

import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void> {
  void options;
  return () => Promise.resolve();
}
