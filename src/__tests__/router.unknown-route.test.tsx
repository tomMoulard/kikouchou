/**
 * @fileoverview The catch-all route, and the build it may be refusing for.
 *
 * A device runs the build its service worker precached, so a link to a route
 * that shipped later lands on a router which has never heard of it. That is how
 * `/template/<token>` showed "something went wrong" inside the app chrome on a
 * path the origin serves correctly. The catch-all therefore asks for a newer
 * worker before it refuses anything.
 *
 * The element is not exported on its own, so it is reached the way the app
 * registers it: the `*` child of `appRoutes`.
 *
 * @module __tests__/router.unknown-route.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
  captureEvent: vi.fn(),
  captureUsage: vi.fn(),
  captureDeletion: vi.fn(),
  default: { capture: vi.fn(), captureException: vi.fn() },
}));

vi.mock('@/lib/pwa/stale-build', () => ({
  recoverFromStaleBuild: vi.fn(() => Promise.resolve(false)),
  STALE_BUILD_TIMEOUT_MS: 8000,
}));

import { recoverFromStaleBuild } from '@/lib/pwa/stale-build';
import { appRoutes } from '../router';

const mockedRecover = vi.mocked(recoverFromStaleBuild);

// ============================================================================
// Helpers
// ============================================================================

/** Mounts the app's own catch-all, without the Layout it normally sits in. */
function renderUnknownRoute() {
  const catchAll = appRoutes.children?.find((route) => route.path === '*');
  expect(catchAll).toBeDefined();

  const router = createMemoryRouter([{ path: '*', element: catchAll?.element }], {
    initialEntries: ['/a-path-this-build-has-never-heard-of'],
  });

  return render(<RouterProvider router={router} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('the catch-all route', () => {
  beforeEach(() => {
    mockedRecover.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('asks whether the path belongs to a newer build', async () => {
    renderUnknownRoute();

    await screen.findByText('errors.generic');
    expect(mockedRecover).toHaveBeenCalledTimes(1);
  });

  it('refuses the path once no newer build is on offer', async () => {
    renderUnknownRoute();

    expect(await screen.findByText('errors.generic')).toBeInTheDocument();
    expect(screen.getByText('errors.loadingFailed')).toBeInTheDocument();
  });

  it('waits instead of refusing while a newer build takes the page over', async () => {
    mockedRecover.mockResolvedValue(true);

    renderUnknownRoute();

    // The reload is already on its way; an error page that flashes first is a
    // worse answer than a wait nobody sees.
    await Promise.resolve();
    expect(screen.queryByText('errors.generic')).not.toBeInTheDocument();
  });
});
