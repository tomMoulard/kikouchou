/**
 * @fileoverview Tests for the seasonal logo dress and decorations.
 *
 * The palette is set on `<html>` directly, the way `lib/palette` and a
 * console preview both set it, so these tests also cover the observer in
 * `useActivePalette`.
 *
 * @module components/shared/__tests__/SeasonalDecor.test
 */

import { act } from 'react';

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { render, screen } from '@/test/utils';
import { BrandMark } from '@/components/shared/BrandMark';
import {
  SeasonalBackdrop,
  SeasonalHeaderDecor,
} from '@/components/shared/SeasonalDecor';
import { useActivePalette } from '@/hooks/useActivePalette';
import { PALETTE_ATTRIBUTE, type Palette } from '@/lib/palette';

/**
 * Paints a palette the way `lib/palette` does.
 *
 * @param palette - The palette, or `null` to remove the attribute
 */
function paint(palette: Palette | 'sepia' | null): void {
  if (palette === null) {
    document.documentElement.removeAttribute(PALETTE_ATTRIBUTE);
  } else {
    document.documentElement.setAttribute(PALETTE_ATTRIBUTE, palette);
  }
}

/**
 * Lets the MutationObserver deliver its record.
 */
async function flushObserver(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  paint(null);
});

describe('useActivePalette', () => {
  it('reads the painted palette and follows a change', async () => {
    paint('ocean');
    const { result } = renderHook(() => useActivePalette());

    expect(result.current).toBe('ocean');

    paint('halloween');
    await flushObserver();

    expect(result.current).toBe('halloween');
  });

  it('reads the default when the attribute is missing or unknown', async () => {
    const { result } = renderHook(() => useActivePalette());

    expect(result.current).toBe('default');

    paint('sepia');
    await flushObserver();

    expect(result.current).toBe('default');
  });
});

describe('BrandMark', () => {
  it('draws the plain house without a palette and for a year-round one', () => {
    const { container, rerender } = render(<BrandMark />, {
      withProviders: false,
    });

    expect(container.querySelector('[data-dress]')).toBeNull();

    rerender(<BrandMark palette="ocean" />);
    expect(container.querySelector('[data-dress]')).toBeNull();
  });

  it.each<Palette>(['halloween', 'christmas', 'valentine', 'stpatrick'])(
    'dresses the house for %s, over the four rooms',
    (palette) => {
      const { container } = render(<BrandMark palette={palette} />, {
        withProviders: false,
      });
      const svg = container.querySelector('svg');

      expect(svg?.querySelector(`[data-dress="${palette}"]`)).not.toBeNull();
      // Drawn last, so it sits on top of the rooms rather than under them.
      expect(svg?.lastElementChild).toHaveAttribute('data-dress', palette);
      expect(svg?.querySelectorAll(':scope > rect')).toHaveLength(3);
    },
  );
});

describe('SeasonalHeaderDecor and SeasonalBackdrop', () => {
  it('render nothing for a year-round palette', () => {
    paint('forest');
    render(
      <>
        <SeasonalHeaderDecor />
        <SeasonalBackdrop />
      </>,
      { withProviders: false },
    );

    expect(screen.queryByTestId('seasonal-header-decor')).toBeNull();
    expect(screen.queryByTestId('seasonal-backdrop')).toBeNull();
  });

  it.each([
    ['halloween', 'bat', 'cobweb'],
    ['christmas', 'lights', 'tree'],
    ['valentine', 'heart', 'hearts'],
    ['stpatrick', 'clover', 'rainbow'],
  ] as const)(
    'draws the %s pieces',
    (palette, headerPiece, backdropPiece) => {
      paint(palette);
      render(
        <>
          <SeasonalHeaderDecor />
          <SeasonalBackdrop />
        </>,
        { withProviders: false },
      );

      expect(
        screen
          .getByTestId('seasonal-header-decor')
          .querySelector(`[data-piece="${headerPiece}"]`),
      ).not.toBeNull();
      expect(
        screen
          .getByTestId('seasonal-backdrop')
          .querySelector(`[data-piece="${backdropPiece}"]`),
      ).not.toBeNull();
    },
  );

  it('draws snow for Christmas', () => {
    paint('christmas');
    render(<SeasonalBackdrop />, { withProviders: false });

    expect(
      screen
        .getByTestId('seasonal-backdrop')
        .querySelectorAll('[data-piece="snowflake"]').length,
    ).toBeGreaterThan(5);
  });

  it('can neither take a tap nor be read out', () => {
    paint('halloween');
    render(
      <>
        <SeasonalHeaderDecor />
        <SeasonalBackdrop />
      </>,
      { withProviders: false },
    );

    for (const surface of [
      screen.getByTestId('seasonal-header-decor'),
      screen.getByTestId('seasonal-backdrop'),
    ]) {
      expect(surface).toHaveAttribute('aria-hidden', 'true');
      expect(surface).toHaveClass('pointer-events-none', '-z-10', 'print:hidden');
    }
  });

  it('appears when the palette changes, without a remount', async () => {
    paint('default');
    render(<SeasonalBackdrop />, { withProviders: false });

    expect(screen.queryByTestId('seasonal-backdrop')).toBeNull();

    paint('christmas');
    await flushObserver();

    expect(screen.getByTestId('seasonal-backdrop')).toBeInTheDocument();
  });
});
