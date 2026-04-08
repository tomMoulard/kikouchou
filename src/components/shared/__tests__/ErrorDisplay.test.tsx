/**
 * ErrorDisplay Tests
 *
 * @module components/shared/__tests__/ErrorDisplay.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/utils';

import { ErrorDisplay } from '@/components/shared/ErrorDisplay';

// ============================================================================
// Tests
// ============================================================================

describe('ErrorDisplay', () => {
  describe('Basic rendering', () => {
    it('renders with role alert', () => {
      render(<ErrorDisplay />, { withProviders: false });

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('renders default title when no title provided', () => {
      render(<ErrorDisplay />, { withProviders: false });

      expect(screen.getByText('errors.loadingFailed')).toBeInTheDocument();
    });

    it('renders custom title', () => {
      render(<ErrorDisplay title="Custom Error Title" />, { withProviders: false });

      expect(screen.getByText('Custom Error Title')).toBeInTheDocument();
    });

    it('renders error message when showMessage is true (default)', () => {
      const error = new Error('Something went wrong');
      render(<ErrorDisplay error={error} />, { withProviders: false });

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('hides error message when showMessage is false', () => {
      const error = new Error('Something went wrong');
      render(<ErrorDisplay error={error} showMessage={false} />, { withProviders: false });

      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('renders without error message when error is null', () => {
      render(<ErrorDisplay error={null} />, { withProviders: false });

      // Only the title should be present
      expect(screen.getByText('errors.loadingFailed')).toBeInTheDocument();
    });
  });

  describe('Action buttons', () => {
    it('shows retry button when onRetry is provided', () => {
      render(<ErrorDisplay onRetry={vi.fn()} />, { withProviders: false });

      expect(screen.getByRole('button', { name: /common.retry/i })).toBeInTheDocument();
    });

    it('does not show retry button when onRetry is not provided', () => {
      render(<ErrorDisplay />, { withProviders: false });

      expect(screen.queryByRole('button', { name: /common.retry/i })).not.toBeInTheDocument();
    });

    it('calls onRetry when retry button is clicked', async () => {
      const onRetry = vi.fn();
      const { user } = render(<ErrorDisplay onRetry={onRetry} />, { withProviders: false });

      await user.click(screen.getByRole('button', { name: /common.retry/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows back button when onBack is provided', () => {
      render(<ErrorDisplay onBack={vi.fn()} />, { withProviders: false });

      expect(screen.getByRole('button', { name: /common.back/i })).toBeInTheDocument();
    });

    it('calls onBack when back button is clicked', async () => {
      const onBack = vi.fn();
      const { user } = render(<ErrorDisplay onBack={onBack} />, { withProviders: false });

      await user.click(screen.getByRole('button', { name: /common.back/i }));
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('shows custom back label', () => {
      render(<ErrorDisplay onBack={vi.fn()} backLabel="Go Home" />, { withProviders: false });

      expect(screen.getByRole('button', { name: 'Go Home' })).toBeInTheDocument();
    });

    it('shows both retry and back buttons', () => {
      render(
        <ErrorDisplay onRetry={vi.fn()} onBack={vi.fn()} />,
        { withProviders: false }
      );

      expect(screen.getByRole('button', { name: /common.retry/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /common.back/i })).toBeInTheDocument();
    });
  });

  describe('Size variants', () => {
    it('renders default size', () => {
      render(<ErrorDisplay />, { withProviders: false });

      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('min-h-[400px]');
    });

    it('renders compact size', () => {
      render(<ErrorDisplay size="compact" />, { withProviders: false });

      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('py-4');
      expect(alert.className).not.toContain('min-h-[400px]');
    });
  });

  describe('Custom className and children', () => {
    it('applies custom className', () => {
      render(<ErrorDisplay className="my-class" />, { withProviders: false });

      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('my-class');
    });

    it('renders children', () => {
      render(
        <ErrorDisplay>
          <div>Custom child content</div>
        </ErrorDisplay>,
        { withProviders: false }
      );

      expect(screen.getByText('Custom child content')).toBeInTheDocument();
    });
  });
});
