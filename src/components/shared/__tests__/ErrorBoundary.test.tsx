/**
 * ErrorBoundary Tests
 *
 * Tests for the ErrorBoundary component including:
 * - Rendering children when no error
 * - Catching errors and displaying fallback UI
 * - Custom fallback
 * - Retry functionality
 * - onError/onReset callbacks
 * - Reloading the tab by itself when a lazy chunk is gone
 *
 * @module components/shared/__tests__/ErrorBoundary.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/utils';

import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type { ReactElement } from 'react';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { reportError } from '@/lib/posthog';
import { tryReloadForStaleChunk } from '@/lib/pwa/stale-chunk';

// The helper's own decisions — the once-per-tab guard, the storage failures —
// are covered in `src/lib/pwa/__tests__/stale-chunk.test.ts`. What matters here
// is that the boundary asks it, without waiting for a click, and only for the
// errors a reload can actually fix.
vi.mock('@/lib/pwa/stale-chunk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pwa/stale-chunk')>();
  return { ...actual, tryReloadForStaleChunk: vi.fn(() => 'reloaded' as const) };
});

vi.mock('@/lib/posthog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/posthog')>();
  return { ...actual, reportError: vi.fn() };
});

/** The mocked helper, typed for assertions. */
const reloadMock = vi.mocked(tryReloadForStaleChunk);
/** The mocked reporter, typed for assertions. */
const reportMock = vi.mocked(reportError);

/** The message Chrome throws when a deploy has removed the chunk. */
const STALE_CHUNK_MESSAGE =
  'Failed to fetch dynamically imported module: https://app.kikouchou.app/assets/TripEditPage-CfPSMXkw.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Component that throws an error for testing */
function ThrowingComponent({ message }: { readonly message: string }): never {
  throw new Error(message);
}

/** Normal component for success path */
function GoodComponent() {
  return <div>All good</div>;
}

// ============================================================================
// Tests
// ============================================================================

describe('ErrorBoundary', () => {
  // Suppress console.error from React's error boundary logging
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('Normal rendering', () => {
    it('renders children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <GoodComponent />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(screen.getByText('All good')).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('displays error UI when a child throws', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent message="Test error" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      // Should show the fallback error UI
      expect(screen.getByRole('alert')).toBeInTheDocument();
      // Should show retry button
      expect(screen.getByRole('button', { name: /common.retry/i })).toBeInTheDocument();
    });

    it('renders custom fallback when provided', () => {
      render(
        <ErrorBoundary fallback={<div>Custom fallback</div>}>
          <ThrowingComponent message="Test error" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(screen.getByText('Custom fallback')).toBeInTheDocument();
    });

    it('calls onError callback when error is caught', () => {
      const onError = vi.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ThrowingComponent message="Test error" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Test error' }),
        expect.objectContaining({ componentStack: expect.any(String) })
      );
    });

    it('handles onError callback that throws', () => {
      const onError = vi.fn(() => {
        throw new Error('Callback error');
      });

      // Should not crash
      render(
        <ErrorBoundary onError={onError}>
          <ThrowingComponent message="Test error" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('Retry functionality', () => {
    it('calls onReset callback when retry is clicked', async () => {
      const onReset = vi.fn();

      const { user } = render(
        <ErrorBoundary onReset={onReset}>
          <ThrowingComponent message="Test error" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      const retryButton = screen.getByRole('button', { name: /common.retry/i });
      await user.click(retryButton);

      expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('handles onReset callback that throws', async () => {
      const onReset = vi.fn(() => {
        throw new Error('Reset error');
      });

      const { user } = render(
        <ErrorBoundary onReset={onReset}>
          <ThrowingComponent message="Test error" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      const retryButton = screen.getByRole('button', { name: /common.retry/i });
      // Should not crash
      await user.click(retryButton);

      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('Stale chunk recovery', () => {
    beforeEach(() => {
      reloadMock.mockClear();
      reloadMock.mockReturnValue('reloaded');
      reportMock.mockClear();
    });

    // A tab left open across a deploy is the normal life of a PWA, and the
    // reload cures it. Reporting it anyway made PostHog issue 01a0a104.
    it('reports nothing when the reload goes ahead', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent message={STALE_CHUNK_MESSAGE} />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(reloadMock).toHaveBeenCalledTimes(1);
      expect(reportMock).not.toHaveBeenCalled();
    });

    // The guard holding the reload back means one reload already failed to
    // fix it: a chunk missing from the new build too, which is a bad deploy.
    it('reports a stale chunk the reload did not cure', () => {
      reloadMock.mockReturnValue('cooldown');

      render(
        <ErrorBoundary>
          <ThrowingComponent message={STALE_CHUNK_MESSAGE} />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(reportMock).toHaveBeenCalledTimes(1);
      expect(reportMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: STALE_CHUNK_MESSAGE }),
        expect.objectContaining({
          source: 'ErrorBoundary',
          stale_chunk: true,
          reload_declined: 'cooldown',
        })
      );
    });

    // PostHog issue 01a0edf6: a declined reload reported only `stale_chunk`,
    // so a broken deploy and a browser without session storage read the same.
    it.each(['no_storage', 'storage_error'] as const)(
      'says the reload was held back by %s',
      (outcome) => {
        reloadMock.mockReturnValue(outcome);

        render(
          <ErrorBoundary>
            <ThrowingComponent message={STALE_CHUNK_MESSAGE} />
          </ErrorBoundary>,
          { withProviders: false }
        );

        expect(reportMock.mock.calls[0]?.[1]).toMatchObject({
          stale_chunk: true,
          reload_declined: outcome,
        });
      }
    );

    it('reports an ordinary error without the stale chunk flag', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent message="Trip not found" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(reportMock).toHaveBeenCalledTimes(1);
      expect(reportMock.mock.calls[0]?.[1]).not.toHaveProperty('stale_chunk');
      expect(reportMock.mock.calls[0]?.[1]).not.toHaveProperty('reload_declined');
    });

    it('reloads the tab without waiting for a click', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent message={STALE_CHUNK_MESSAGE} />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it('leaves an ordinary error to the retry button', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent message="Trip not found" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(reloadMock).not.toHaveBeenCalled();
    });

    it('keeps the fallback on screen when the reload is held back', () => {
      reloadMock.mockReturnValue('cooldown');

      render(
        <ErrorBoundary>
          <ThrowingComponent message={STALE_CHUNK_MESSAGE} />
        </ErrorBoundary>,
        { withProviders: false }
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /common.retry/i })
      ).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('applies custom className to error container', () => {
      render(
        <ErrorBoundary className="my-custom-class">
          <ThrowingComponent message="Test error" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('my-custom-class');
    });
  });

  describe('safeTranslate', () => {
    it('renders error UI with translated keys', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent message="Critical failure" />
        </ErrorBoundary>,
        { withProviders: false }
      );

      // "an alert exists" was already asserted three tests up and said nothing
      // about translation. `safeTranslate` returns its *fallback* whenever `t`
      // misbehaves, so the only way to see that the real `t` ran is to find
      // the keys — the fallbacks are the English strings.
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'errors.generic'
      );
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('errors.loadingFailed');
      expect(screen.getByRole('button')).toHaveTextContent('common.retry');
    });
  });
});

// Need beforeEach/afterEach at module level for the import
import { beforeEach, afterEach } from 'vitest';

// ============================================================================
// Reset on route change
// ============================================================================

describe('ErrorBoundary reset on navigation', () => {
  /** Throws for trip "a" only, so the same route element can succeed later. */
  function MaybeBoom(): ReactElement {
    const { tripId } = useParams<'tripId'>();
    if (tripId === 'a') {
      throw new Error('boom');
    }
    return <div>rooms ok</div>;
  }

  // The route element is built once and is referentially stable, so navigating
  // from /trips/a/rooms to /trips/b/rooms re-renders through the SAME element
  // and React never remounts the boundary. Before the fix, hasError stayed true
  // and the fallback was shown for the rest of the session.
  function Harness(): ReactElement {
    const navigate = useNavigate();
    return (
      <>
        <button type="button" onClick={() => navigate('/trips/b/rooms')}>
          go to trip b
        </button>
        <Routes>
          <Route
            path="/trips/:tripId/rooms"
            element={
              <ErrorBoundary>
                <MaybeBoom />
              </ErrorBoundary>
            }
          />
        </Routes>
      </>
    );
  }

  it('clears a caught error when the route changes', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { user } = render(<Harness />, {
      withProviders: false,
      initialRoute: '/trips/a/rooms',
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'go to trip b' }));

    expect(await screen.findByText('rooms ok')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    spy.mockRestore();
  });
});
