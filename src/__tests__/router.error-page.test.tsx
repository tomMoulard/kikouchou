/**
 * @fileoverview The screen a route error lands on.
 *
 * React Router catches the throw and renders this element, so the error never
 * reaches the window and PostHog's unhandled-error capture never sees it. That
 * makes the reporting in this page the only record of a broken route, and it is
 * what the first test pins. A 404 is deliberately not reported: a route that
 * does not exist is not a fault.
 *
 * The page is not exported on its own, so it is reached the way the app reaches
 * it — as the `errorElement` of a route that throws.
 *
 * @module __tests__/router.error-page.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
  captureEvent: vi.fn(),
  captureUsage: vi.fn(),
  captureDeletion: vi.fn(),
  default: { capture: vi.fn(), captureException: vi.fn() },
}));

// Only the reload is faked; `isModuleLoadError` stays real.
vi.mock('@/lib/pwa/stale-chunk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pwa/stale-chunk')>()),
  tryReloadForStaleChunk: vi.fn(() => 'reloaded' as const),
}));

import { reportError } from '@/lib/posthog';
import { resetStaleChunkReloadForTests, tryReloadForStaleChunk } from '@/lib/pwa/stale-chunk';
import { appRoutes } from '../router';

const mockedReportError = vi.mocked(reportError);
const mockedReloadForStaleChunk = vi.mocked(tryReloadForStaleChunk);

// ============================================================================
// Helpers
// ============================================================================

/** Mounts the app's own error element against a route that throws `thrown`. */
function renderErrorPage(thrown: unknown) {
  function Boom(): ReactElement {
    throw thrown;
  }

  const router = createMemoryRouter(
    [{ path: '/', element: <Boom />, errorElement: appRoutes.errorElement }],
    { initialEntries: ['/'] },
  );

  return render(<RouterProvider router={router} />);
}

/**
 * The same page for a thrown `Response`.
 *
 * A Response only becomes a route error response when it is thrown from a
 * loader; thrown during render it is an ordinary value, which is a different
 * branch of the page.
 */
function renderResponseError(response: Response) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        loader: () => {
          throw response;
        },
        element: <div>never rendered</div>,
        errorElement: appRoutes.errorElement,
      },
    ],
    { initialEntries: ['/'] },
  );

  return render(<RouterProvider router={router} />);
}

const realLocation = window.location;
const reload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resetStaleChunkReloadForTests();
  mockedReloadForStaleChunk.mockReturnValue('reloaded');
  // jsdom implements neither, and the page calls both.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, reload, href: realLocation.href },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('the route error page', () => {
  it('shows the message of a thrown error and reports it', () => {
    // React Router logs the caught error; that noise is not the subject.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderErrorPage(new Error('the chunk would not load'));

    expect(screen.getByText('the chunk would not load')).toBeInTheDocument();
    expect(mockedReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: 'RouteErrorPage' }),
    );
    consoleError.mockRestore();
  });

  it('offers a reload and a way home', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    renderErrorPage(new Error('boom'));

    await user.click(screen.getByRole('button', { name: /common.retry/i }));
    expect(reload).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /trips.title/i }));
    expect(window.location.href).toContain('trips');
    consoleError.mockRestore();
  });

  it('says a missing page is missing, and does not report it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderResponseError(new Response('', { status: 404 }));

    expect(await screen.findByText('errors.notFound')).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    // A route that does not exist is not a fault.
    expect(mockedReportError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('shows the status and the server’s own words for any other response', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderResponseError(new Response('', { status: 503, statusText: 'Service Unavailable' }));

    expect(await screen.findByText('503')).toBeInTheDocument();
    expect(screen.getByText('Service Unavailable')).toBeInTheDocument();
    expect(mockedReportError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ route_status: 503 }),
    );
    consoleError.mockRestore();
  });

  /**
   * A lazy piece of the layout with no boundary of its own (the trip glance
   * panel, for one) throws to this page. It used to report the stale chunk
   * and leave the user on the error screen, where every other catch of the
   * same failure reloads the tab first.
   */
  it('reloads the tab for a stale chunk, and reports nothing when it goes ahead', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderErrorPage(new TypeError('Importing a module script failed.'));

    expect(mockedReloadForStaleChunk).toHaveBeenCalledTimes(1);
    expect(mockedReportError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('reports a stale chunk the reload did not cure, with the reason', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedReloadForStaleChunk.mockReturnValue('cooldown');

    renderErrorPage(new TypeError('Importing a module script failed.'));

    expect(mockedReportError).toHaveBeenCalledWith(expect.any(TypeError), {
      source: 'RouteErrorPage',
      route_status: undefined,
      stale_chunk: true,
      reload_declined: 'cooldown',
    });
    consoleError.mockRestore();
  });

  it('falls back to its own description when a thrown value says nothing', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderErrorPage('just a string');

    expect(screen.getByText('errors.generic')).toBeInTheDocument();
    expect(screen.getByText('errors.loadingFailed')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
