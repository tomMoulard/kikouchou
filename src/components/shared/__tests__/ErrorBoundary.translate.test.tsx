/**
 * @fileoverview The error boundary's own words when translation itself fails.
 *
 * The boundary is the last thing on screen when something broke, and a broken
 * i18n context is one of the things that can break. So every string goes
 * through `safeTranslate`, which falls back to English when `t` throws or
 * answers with something that is not a string. This file swaps the suite-wide
 * i18n mock for one that does exactly that.
 *
 * @module components/shared/__tests__/ErrorBoundary.translate.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

/** How the translator misbehaves in the current test. */
const { translator } = vi.hoisted(() => ({
  translator: { mode: 'throws' as 'throws' | 'object' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: () => {
      if (translator.mode === 'throws') {
        throw new Error('i18n is gone');
      }
      return { not: 'a string' };
    },
  }),
}));

vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  reportError: vi.fn(),
}));

function Boom(): never {
  throw new Error('Broken page');
}

const ENGLISH = [
  'An error occurred',
  'Failed to load this content. Please try again.',
  'Retry',
  'Error details (development only)',
  'Error:',
  'Stack trace:',
  'Component stack:',
];

describe('ErrorBoundary with a broken translator', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  for (const mode of ['throws', 'object'] as const) {
    it(`falls back to English when the translator ${mode === 'throws' ? 'throws' : 'answers with an object'}`, () => {
      translator.mode = mode;

      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
        { withProviders: false },
      );

      for (const text of ENGLISH) {
        expect(screen.getByText(text)).toBeInTheDocument();
      }
    });
  }
});
