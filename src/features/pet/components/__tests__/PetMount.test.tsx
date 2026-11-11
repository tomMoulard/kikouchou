/**
 * @fileoverview The pet's lazy chunk failing to load.
 *
 * `App` mounts the pet beside the router, outside every route's boundary. On
 * 2026-11-09 an iOS Chrome session on a first open (pet on) read the
 * `onboarding-small-pet` flag, and 300 ms later the overlay's chunk failed:
 * with only a `Suspense` around it the error was uncaught, React 19 unmounted
 * the whole root, and PostHog filed it as an unhandled exception. A
 * decoration took the app down with it.
 *
 * @module features/pet/components/__tests__/PetMount.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';

import { PetMount } from '../PetMount';
import { resetStaleChunkReloadForTests, tryReloadForStaleChunk } from '@/lib/pwa/stale-chunk';

// ============================================================================
// Test doubles
// ============================================================================

// A first open: the pet is on, and the experiment answers the shipped arm.
vi.mock('../../hooks/usePetPreferences', () => ({
  usePetPreferences: () => ({ enabled: true }),
}));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlagVariant: () => false }));

vi.mock('@/lib/pwa/stale-chunk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pwa/stale-chunk')>()),
  tryReloadForStaleChunk: vi.fn(() => 'cooldown' as const),
}));

// Reading the export is what fails, the way the module itself failing to
// arrive rejects the lazy import with the browser's own wording.
vi.mock('../PetOverlay', () => ({
  get PetOverlay(): never {
    throw new TypeError('Importing a module script failed.');
  },
}));

const mockedReload = vi.mocked(tryReloadForStaleChunk);

beforeEach(() => {
  resetStaleChunkReloadForTests();
  mockedReload.mockClear();
});

// ============================================================================
// Tests
// ============================================================================

describe('PetMount', () => {
  it('keeps the app on screen when the pet will not load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <>
          <PetMount />
          <p>the rest of the app</p>
        </>,
        { withProviders: false },
      );

      // The failure goes through the one stale chunk helper...
      await waitFor(() => {
        expect(mockedReload).toHaveBeenCalledTimes(1);
      });
      // ...and the pet's absence is the whole cost of it.
      expect(screen.getByText('the rest of the app')).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
