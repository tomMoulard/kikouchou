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

  describe('Retry on a stale chunk', () => {
    // Re-rendering re-throws a failed dynamic import forever, so the button
    // has to reload. `window.location` is unforgeable and cannot be spied on,
    // and jsdom cannot navigate: it reports the attempt on its virtual console
    // instead, which is the only trace a reload leaves under test. The handle
    // is jsdom's own; if a jsdom upgrade renames it, this fails rather than
    // passing blind.
    it('reloads the tab when the reader taps retry', async () => {
      reloadMock.mockReturnValue('cooldown');
      const { user } = render(
        <ErrorBoundary>
          <ThrowingComponent message={STALE_CHUNK_MESSAGE} />
        </ErrorBoundary>,
        { withProviders: false }
      );
      const virtualConsole = (
        window as unknown as {
          readonly _virtualConsole?: {
            on(event: 'jsdomError', listener: (error: Error) => void): void;
            off(event: 'jsdomError', listener: (error: Error) => void): void;
          };
        }
      )._virtualConsole;
      expect(virtualConsole).toBeDefined();
      const navigations: string[] = [];
      const listen = (error: Error): void => {
        if (error.message.startsWith('Not implemented: navigation')) navigations.push(error.message);
      };
      virtualConsole?.on('jsdomError', listen);

      try {
        await user.click(screen.getByRole('button', { name: /common.retry/i }));
      } finally {
        virtualConsole?.off('jsdomError', listen);
      }

      expect(navigations).toHaveLength(1);
      expect(screen.getByRole('alert')).toBeInTheDocument();
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

// ============================================================================
// Callbacks, retry and the development details
// ============================================================================

describe('ErrorBoundary, more of it', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    reloadMock.mockClear();
    reloadMock.mockReturnValue('reloaded');
    reportMock.mockClear();
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  /**
   * Throws until `heal()` is called, so a retry can succeed. React renders a
   * throwing tree a second time on its own, so "throw once" is not enough.
   */
  function makeFlaky(): { Flaky: () => ReactElement; heal: () => void } {
    let failing = true;
    return {
      Flaky: function Flaky(): ReactElement {
        if (failing) {
          throw new Error('render fails');
        }
        return <div>recovered</div>;
      },
      heal: () => {
        failing = false;
      },
    };
  }

  it('logs a throwing onError and still shows the fallback', () => {
    const callbackError = new Error('Callback error');
    render(
      <ErrorBoundary onError={() => { throw callbackError; }}>
        <ThrowingComponent message="Test error" />
      </ErrorBoundary>,
      { withProviders: false },
    );

    expect(consoleError).toHaveBeenCalledWith(
      'ErrorBoundary: onError callback threw an error:',
      callbackError,
    );
  });

  it('logs the caught error and its component stack in development', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Dev error" />
      </ErrorBoundary>,
      { withProviders: false },
    );

    expect(consoleError).toHaveBeenCalledWith(
      'ErrorBoundary caught an error:',
      expect.objectContaining({ message: 'Dev error' }),
    );
    expect(consoleError).toHaveBeenCalledWith('Component stack:', expect.any(String));
  });

  it('reports the error with its component stack', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Reported" />
      </ErrorBoundary>,
      { withProviders: false },
    );

    expect(reportMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Reported' }),
      { source: 'ErrorBoundary', component_stack: expect.stringContaining('ThrowingComponent') },
    );
  });

  it('renders the children again on retry', async () => {
    const { Flaky, heal } = makeFlaky();
    const { user } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
      { withProviders: false },
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    heal();

    await user.click(screen.getByRole('button', { name: /common.retry/i }));

    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('logs a throwing onReset and still retries', async () => {
    const { Flaky, heal } = makeFlaky();
    const resetError = new Error('Reset error');
    const { user } = render(
      <ErrorBoundary onReset={() => { throw resetError; }}>
        <Flaky />
      </ErrorBoundary>,
      { withProviders: false },
    );
    heal();

    await user.click(screen.getByRole('button', { name: /common.retry/i }));

    expect(consoleError).toHaveBeenCalledWith(
      'ErrorBoundary: onReset callback threw an error:',
      resetError,
    );
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('does not re-render a stale chunk on retry, because only a reload can fix it', async () => {
    reloadMock.mockReturnValue('cooldown');
    const { user } = render(
      <ErrorBoundary>
        <ThrowingComponent message={STALE_CHUNK_MESSAGE} />
      </ErrorBoundary>,
      { withProviders: false },
    );
    expect(reloadMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /common.retry/i }));

    // Re-rendering would throw the cached rejection again and ask the guard a
    // second time.
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('keeps the caught error when the boundary re-renders on the same route', () => {
    const { rerender } = render(
      <ErrorBoundary className="a">
        <ThrowingComponent message="Sticky" />
      </ErrorBoundary>,
      { withProviders: false },
    );

    rerender(
      <ErrorBoundary className="b">
        <ThrowingComponent message="Sticky" />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveClass('b');
  });

  it('lays out its fallback and names each development detail', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Detailed failure" />
      </ErrorBoundary>,
      { withProviders: false },
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveClass(
      'flex', 'flex-col', 'items-center', 'justify-center', 'px-4', 'py-12', 'text-center', 'max-w-md', 'mx-auto',
    );
    expect(screen.getByText('errors.dev.details')).toBeInTheDocument();
    expect(screen.getByText('errors.dev.error')).toBeInTheDocument();
    expect(screen.getByText('Detailed failure')).toBeInTheDocument();
    expect(screen.getByText('errors.dev.stack')).toBeInTheDocument();
    expect(screen.getByText('errors.dev.componentStack')).toBeInTheDocument();
  });

  it('leaves out the parts of the details an error does not have', () => {
    function ThrowsBare(): never {
      const error = new Error('');
      error.stack = '';
      throw error;
    }
    render(
      <ErrorBoundary>
        <ThrowsBare />
      </ErrorBoundary>,
      { withProviders: false },
    );

    expect(screen.queryByText('errors.dev.error')).not.toBeInTheDocument();
    expect(screen.queryByText('errors.dev.stack')).not.toBeInTheDocument();
    expect(screen.getByText('errors.dev.componentStack')).toBeInTheDocument();
    expect(screen.getByText('errors.dev.details')).toBeInTheDocument();
  });

  it('draws the details only once it has something to put in them', () => {
    // React hands over the component stack in componentDidCatch, after the
    // fallback's first paint. `onError` runs there, so it sees that paint.
    function throwing(message: string) {
      return function ThrowsWithoutStack(): never {
        const error = new Error(message);
        error.stack = '';
        throw error;
      };
    }
    const sawDetails: boolean[] = [];
    const onError = (): void => {
      sawDetails.push(document.querySelector('details') !== null);
    };
    const Bare = throwing('');
    const WithMessage = throwing('No stack here');

    const bare = render(
      <ErrorBoundary onError={onError}>
        <Bare />
      </ErrorBoundary>,
      { withProviders: false },
    );
    bare.unmount();
    render(
      <ErrorBoundary onError={onError}>
        <WithMessage />
      </ErrorBoundary>,
      { withProviders: false },
    );

    // Nothing to show for a bare error until the component stack arrives; a
    // message is worth showing at once.
    expect(sawDetails).toEqual([false, true]);
  });

  it('shows the message of an error that has no stack', () => {
    function ThrowsNoStack(): never {
      const error = new Error('No stack here');
      error.stack = '';
      throw error;
    }
    render(
      <ErrorBoundary>
        <ThrowsNoStack />
      </ErrorBoundary>,
      { withProviders: false },
    );

    expect(screen.getByText('errors.dev.error')).toBeInTheDocument();
    expect(screen.queryByText('errors.dev.stack')).not.toBeInTheDocument();
  });

  it('shows the stack of an error that has no message', () => {
    function ThrowsNoMessage(): never {
      throw new Error('');
    }
    render(
      <ErrorBoundary>
        <ThrowsNoMessage />
      </ErrorBoundary>,
      { withProviders: false },
    );

    expect(screen.queryByText('errors.dev.error')).not.toBeInTheDocument();
    expect(screen.getByText('errors.dev.stack')).toBeInTheDocument();
  });

  it('survives a thrown value that is not an error', () => {
    function ThrowsNull(): never {
      throw null;
    }
    render(
      <ErrorBoundary>
        <ThrowsNull />
      </ErrorBoundary>,
      { withProviders: false },
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('errors.dev.error')).not.toBeInTheDocument();
    expect(screen.getByText('errors.dev.componentStack')).toBeInTheDocument();
  });
});

describe('ErrorBoundary without callbacks', () => {
  it('reports no failing callback when it was given none', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let failing = true;
    function Flaky(): ReactElement {
      if (failing) throw new Error('render fails');
      return <div>recovered</div>;
    }
    const { user } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
      { withProviders: false },
    );
    failing = false;

    await user.click(screen.getByRole('button', { name: /common.retry/i }));

    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalledWith(
      'ErrorBoundary: onError callback threw an error:',
      expect.anything(),
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      'ErrorBoundary: onReset callback threw an error:',
      expect.anything(),
    );
    consoleError.mockRestore();
  });
});
