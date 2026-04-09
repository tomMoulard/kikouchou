/**
 * @fileoverview Tests for the LoadingState component.
 * @module components/shared/__tests__/LoadingState.test
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { LoadingState } from '@/components/shared/LoadingState';

// ============================================================================
// Tests
// ============================================================================

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
    it('renders with small size', () => {
      const { container } = render(<LoadingState size="sm" />, { withProviders: false });
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('renders with large size', () => {
      const { container } = render(<LoadingState size="lg" />, { withProviders: false });
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
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
