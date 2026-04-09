/**
 * ErrorBoundary Tests
 *
 * Tests for the ErrorBoundary component including:
 * - Rendering children when no error
 * - Catching errors and displaying fallback UI
 * - Custom fallback
 * - Retry functionality
 * - onError/onReset callbacks
 *
 * @module components/shared/__tests__/ErrorBoundary.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/utils';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

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

      // The error boundary should render with i18n keys (from mock)
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });
  });
});

// Need beforeEach/afterEach at module level for the import
import { beforeEach, afterEach } from 'vitest';
