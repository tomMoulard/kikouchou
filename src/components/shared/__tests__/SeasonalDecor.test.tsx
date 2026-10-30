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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { render, screen } from '@/test/utils';
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

/**
 * Loaded inside the first test rather than at the top of the file: the dress
 * and scene tables are built when the modules load, and Stryker can only test
 * a mutant in load-time code against the test that was running then.
 */
let BrandMark: typeof import('@/components/shared/BrandMark').BrandMark;
let SeasonalBackdrop: typeof import('@/components/shared/SeasonalDecor').SeasonalBackdrop;
let SeasonalHeaderDecor: typeof import('@/components/shared/SeasonalDecor').SeasonalHeaderDecor;

beforeEach(async () => {
  ({ BrandMark } = await import('@/components/shared/BrandMark'));
  ({ SeasonalBackdrop, SeasonalHeaderDecor } = await import('@/components/shared/SeasonalDecor'));
});

describe('seasonal load-time tables', () => {
  it('dresses the house and draws the header pieces and the backdrop for each seasonal palette', () => {
    const cases = [
      ['halloween', 'bat', 'cobweb', false],
      ['christmas', 'lights', 'tree', true],
      ['valentine', 'heart', 'hearts', true],
      ['stpatrick', 'clover', 'rainbow', true],
    ] as const;

    for (const [palette, headerPiece, backdropPiece, white] of cases) {
      paint(palette);
      const { container, unmount } = render(
        <>
          <BrandMark palette={palette} />
          <SeasonalHeaderDecor />
          <SeasonalBackdrop />
        </>,
        { withProviders: false },
      );

      const dress = container.querySelector(`[data-dress="${palette}"]`);
      expect(dress, palette).not.toBeNull();
      // eslint-disable-next-line kikouchou/no-raw-palette-class -- The house's dress is drawn in literal white over the brand rooms, and this asserts exactly that.
      expect(dress?.matches('.fill-white') === true || dress?.querySelector('.fill-white') != null, palette).toBe(white);
      expect(
        screen.getByTestId('seasonal-header-decor').querySelector(`[data-piece="${headerPiece}"]`),
        palette,
      ).not.toBeNull();
      expect(
        screen.getByTestId('seasonal-backdrop').querySelector(`[data-piece="${backdropPiece}"]`),
        palette,
      ).not.toBeNull();
      unmount();
    }
  });
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
    expect(container.querySelector('svg')).toHaveClass('size-6', 'shrink-0');

    rerender(<BrandMark palette="ocean" className="extra" />);
    expect(container.querySelector('svg')).toHaveClass('size-6', 'shrink-0', 'extra');
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

describe('the seasonal drawings', () => {
  /** The `d` of every direct `path` child of `svg`, in order. */
  function pathData(svg: Element, selector = ':scope > path'): (string | null)[] {
    return [...svg.querySelectorAll(selector)].map((path) => path.getAttribute('d'));
  }

  it('spins the cobweb as three rings of sagging arcs', () => {
    paint('halloween');
    render(<SeasonalBackdrop />, { withProviders: false });

    const cobweb = screen.getByTestId('seasonal-backdrop').querySelector('[data-piece="cobweb"]') as Element;
    expect(pathData(cobweb).slice(1)).toEqual([
      'M90.0 0.0Q95.6 2.8 93.3 13.6Q101.0 14.3 100.7 23.0Q109.7 21.8 110.7 28.5Q119.4 25.3 120.0 30.0',
      'M65.0 0.0Q72.0 8.5 71.0 25.0Q81.8 29.6 84.6 42.1Q97.8 43.2 103.0 52.3Q115.5 49.7 120.0 55.0',
      'M40.0 0.0Q48.4 14.2 48.7 36.3Q62.6 44.8 68.6 61.3Q85.9 64.7 95.3 76.1Q111.6 74.0 120.0 80.0',
    ]);
  });

  it('bends six rainbow bands, each a little inside the last', () => {
    paint('stpatrick');
    render(<SeasonalBackdrop />, { withProviders: false });

    const rainbow = screen.getByTestId('seasonal-backdrop').querySelector('[data-piece="rainbow"]') as Element;
    expect(pathData(rainbow, ':scope > g[fill="none"] > path')).toEqual([
      'M75 110A125 125 0 0 1 200 -15',
      'M80 110A120 120 0 0 1 200 -10',
      'M85 110A115 115 0 0 1 200 -5',
      'M90 110A110 110 0 0 1 200 0',
      'M95 110A105 105 0 0 1 200 5',
      'M100 110A100 100 0 0 1 200 10',
    ]);
  });

  it('lets the snow fall as soft dots', () => {
    paint('christmas');
    render(<SeasonalBackdrop />, { withProviders: false });

    const flakes = screen.getByTestId('seasonal-backdrop').querySelectorAll('[data-piece="snowflake"]');
    expect(flakes).toHaveLength(13);
    for (const flake of flakes) {
      expect(flake).toHaveClass('seasonal-snowflake', 'absolute', 'top-0', 'rounded-full', 'bg-foreground/20');
    }
  });

  it.each([
    ['halloween', 'bat', 3, ['seasonal-bat', 'absolute', 'fill-foreground/45']],
    ['valentine', 'heart', 5, ['seasonal-rise', 'absolute', 'bottom-0', 'fill-primary/35']],
    ['stpatrick', 'clover', 4, ['seasonal-sway', 'absolute', 'fill-primary/40']],
  ] as const)('draws every %s header piece', (palette, piece, count, classes) => {
    paint(palette);
    render(<SeasonalHeaderDecor />, { withProviders: false });

    const pieces = screen.getByTestId('seasonal-header-decor').querySelectorAll(`[data-piece="${piece}"]`);
    expect(pieces).toHaveLength(count);
    for (const element of pieces) {
      expect(element).toHaveClass(...classes);
    }
  });

  it('strings the fairy lights in the four brand colours, staggered, half of them hidden on a phone', () => {
    paint('christmas');
    render(<SeasonalHeaderDecor />, { withProviders: false });

    const lights = [
      ...(screen.getByTestId('seasonal-header-decor').querySelector('[data-piece="lights"]')?.children ?? []),
    ];
    expect(lights).toHaveLength(24);

    const colours = ['bg-brand-soleil', 'bg-brand-corail', 'bg-brand-framboise', 'bg-brand-prune'];
    lights.forEach((light, index) => {
      expect(light).toHaveClass('seasonal-twinkle', 'size-1.5', 'rounded-full', colours[index % 4] as string);
      for (const other of colours.filter((_, i) => i !== index % 4)) {
        expect(light).not.toHaveClass(other);
      }
      expect(light.classList.contains('[animation-delay:-0.6s]')).toBe(index % 3 === 0);
      expect(light.classList.contains('[animation-delay:-1.3s]')).toBe(index % 3 === 1);
      expect(light.classList.contains('max-sm:hidden')).toBe(index % 2 === 1);
    });
  });
});
