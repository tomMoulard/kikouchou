/**
 * @fileoverview The error fallback in a production build.
 *
 * `IS_DEVELOPMENT` is read once, when the module loads, and Vitest runs as a
 * development build. So this file switches `import.meta.env.DEV` off and loads
 * a fresh copy of the boundary, which is the only way a test sees what a
 * deployed app shows a visitor.
 *
 * @module components/shared/__tests__/ErrorBoundary.production.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { render, screen } from '@/test/utils';

function Throws(): never {
  throw new Error('Trip not found');
}

describe('ErrorBoundary in a production build', () => {
  let ErrorBoundary: (typeof import('../ErrorBoundary'))['ErrorBoundary'];

  beforeEach(async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    ({ ErrorBoundary } = await import('../ErrorBoundary'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows the visitor the fallback without the development details, and logs nothing of its own', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ui: ReactElement = (
      <ErrorBoundary>
        <Throws />
      </ErrorBoundary>
    );

    render(ui, { withProviders: false });

    const own = consoleError.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && (arg.startsWith('ErrorBoundary caught') || arg.startsWith('Component stack'))),
    );
    consoleError.mockRestore();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('errors.dev.details')).not.toBeInTheDocument();
    expect(screen.queryByText('Trip not found')).not.toBeInTheDocument();
    expect(own).toEqual([]);
  });
  // This file loads its own copy of the boundary, so the module's starting
  // state is only ever checked here: a page that has not failed shows the
  // page, and a retry after the fault is gone shows it again.
  it('shows the page until it fails, and again after a retry once the fault is gone', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fault = { on: false };
    function MaybeThrows(): ReactElement {
      if (fault.on) {
        throw new Error('Trip not found');
      }
      return <p>The trip</p>;
    }
    const ui: ReactElement = (
      <ErrorBoundary>
        <MaybeThrows />
      </ErrorBoundary>
    );

    try {
      const { rerender, user } = render(ui, { withProviders: false });
      expect(screen.getByText('The trip')).toBeInTheDocument();

      fault.on = true;
      rerender(
        <ErrorBoundary>
          <MaybeThrows key="again" />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert')).toBeInTheDocument();

      fault.on = false;
      await user.click(screen.getByRole('button', { name: /common.retry/i }));

      expect(screen.getByText('The trip')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
