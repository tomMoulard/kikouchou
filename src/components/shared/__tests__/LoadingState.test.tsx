/**
 * @fileoverview Tests for the LoadingState component.
 * @module components/shared/__tests__/LoadingState.test
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';

/**
 * Loaded inside the first test: the size tables are load-time constants, and
 * Stryker can only test a mutant in load-time code against the test that was
 * running when the module loaded.
 */
let LoadingState: typeof import('@/components/shared/LoadingState').LoadingState;

beforeEach(async () => {
  ({ LoadingState } = await import('@/components/shared/LoadingState'));
});

describe('LoadingState sizes and frames', () => {
  it('sizes the spinner and the label together, in both variants', () => {
    for (const variant of ['inline', 'fullPage'] as const) {
      for (const [size, spinner, text] of [
        ['sm', 'size-4', 'text-xs'],
        ['md', 'size-6', 'text-sm'],
        ['lg', 'size-8', 'text-base'],
      ] as const) {
        const { container, unmount } = render(
          <LoadingState variant={variant} size={size} showLabel label="Busy" />,
          { withProviders: false },
        );
        expect(container.querySelector('svg'), `${variant} ${size}`).toHaveClass(
          spinner,
          'text-primary',
          'motion-safe:animate-spin',
        );
        const visible = container.querySelector('[aria-hidden="true"]:not(svg)');
        expect(visible, `${variant} ${size}`).toHaveClass(text, 'text-muted-foreground');
        expect(visible).toHaveTextContent('Busy');
        unmount();
      }
    }
  });

  it('covers the page with a blurred, centred overlay in full-page mode', () => {
    render(<LoadingState variant="fullPage" className="extra" />, { withProviders: false });

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveClass(
      'fixed', 'inset-0', 'z-50', 'flex', 'flex-col', 'items-center', 'justify-center', 'gap-3',
      'bg-background/80', 'backdrop-blur-sm', 'extra',
    );
    expect(screen.getAllByText('common.loading')[0]).toHaveClass('sr-only');
  });

  it('sits in the flow, compact, when inline', () => {
    render(<LoadingState />, { withProviders: false });

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveClass('inline-flex', 'items-center', 'justify-center', 'gap-2', 'py-2');
    expect(status).not.toHaveClass('fixed');
    expect(screen.getByText('common.loading')).toHaveClass('sr-only');
  });
});

// ============================================================================
// Tests
// ============================================================================

/**
 * The visible label span, picked by what marks it out rather than by DOM
 * position: `getAllByText(...)[1]` also matches the sr-only span, so reordering
 * the two would redden these tests for the wrong reason.
 */
function visibleLabel(container: HTMLElement): Element | null {
  return container.querySelector('span[aria-hidden="true"]');
}

describe('LoadingState', () => {
  // ------------------------------------------------------------------
  // Inline variant (default)
  // ------------------------------------------------------------------
  describe('inline variant (default)', () => {
    it('renders with role="status"', () => {
      render(<LoadingState />, { withProviders: false });
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has aria-busy="true"', () => {
      render(<LoadingState />, { withProviders: false });
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('provides screen reader text', () => {
      render(<LoadingState />, { withProviders: false });
      // The sr-only span contains the loading text
      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });

    it('does not show visible label by default', () => {
      render(<LoadingState />, { withProviders: false });
      // There should be exactly one instance of the text (the sr-only one)
      const elements = screen.getAllByText('common.loading');
      expect(elements).toHaveLength(1);
    });

    it('shows visible label when showLabel is true', () => {
      render(<LoadingState showLabel />, { withProviders: false });
      const elements = screen.getAllByText('common.loading');
      // One sr-only + one visible
      expect(elements).toHaveLength(2);
    });

    it('uses custom label when provided', () => {
      render(<LoadingState label="Saving..." />, { withProviders: false });
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Full-page variant
  // ------------------------------------------------------------------
  describe('fullPage variant', () => {
    it('renders with role="status"', () => {
      render(<LoadingState variant="fullPage" />, { withProviders: false });
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows visible label by default', () => {
      render(<LoadingState variant="fullPage" />, { withProviders: false });
      const elements = screen.getAllByText('common.loading');
      // One sr-only + one visible
      expect(elements).toHaveLength(2);
    });

    it('hides visible label when showLabel is false', () => {
      render(<LoadingState variant="fullPage" showLabel={false} />, { withProviders: false });
      const elements = screen.getAllByText('common.loading');
      expect(elements).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------
  // Size variants
  // ------------------------------------------------------------------
  describe('sizes', () => {
    // These two used to share one assertion — "an svg exists" — which held
    // whatever `size` was passed, and would still hold with the prop deleted.
    it('renders a 16px spinner at size="sm"', () => {
      const { container } = render(<LoadingState size="sm" showLabel />, {
        withProviders: false,
      });

      expect(container.querySelector('svg')).toHaveClass('size-4');
      expect(visibleLabel(container)).toHaveClass('text-xs');
    });

    it('renders a 24px spinner by default', () => {
      const { container } = render(<LoadingState showLabel />, { withProviders: false });

      expect(container.querySelector('svg')).toHaveClass('size-6');
      expect(visibleLabel(container)).toHaveClass('text-sm');
    });

    it('renders a 32px spinner at size="lg"', () => {
      const { container } = render(<LoadingState size="lg" showLabel />, {
        withProviders: false,
      });

      expect(container.querySelector('svg')).toHaveClass('size-8');
      expect(visibleLabel(container)).toHaveClass('text-base');
    });
  });

  // ------------------------------------------------------------------
  // Additional className
  // ------------------------------------------------------------------
  it('applies additional className', () => {
    render(<LoadingState className="mt-4" />, { withProviders: false });
    const status = screen.getByRole('status');
    expect(status.className).toContain('mt-4');
  });
});
