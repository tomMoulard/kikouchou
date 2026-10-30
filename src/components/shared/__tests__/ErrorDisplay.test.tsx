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

      // The old assertion was byte-identical to "renders default title", so
      // the half this test is named for went unchecked: the message paragraph
      // must be absent entirely, not merely empty.
      const paragraphs = screen.getByRole('alert').querySelectorAll('p');
      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0]).toHaveTextContent('errors.loadingFailed');
    });

    it('renders no action row when neither callback is given', () => {
      render(<ErrorDisplay error={new Error('boom')} />, { withProviders: false });

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
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

    it('renders compact size with error message and action buttons', () => {
      const error = new Error('Compact error');
      render(
        <ErrorDisplay size="compact" error={error} onRetry={vi.fn()} onBack={vi.fn()} />,
        { withProviders: false }
      );

      // The comment claimed smaller text; nothing checked it, so `isCompact`
      // could stop reaching the message and the buttons and this still passed.
      expect(screen.getByText('Compact error')).toHaveClass('text-xs');
      expect(screen.getByRole('button', { name: /common.retry/i })).toHaveClass('h-8');
      expect(screen.getByRole('button', { name: /common.back/i })).toHaveClass('h-8');
    });

    it('renders the message and buttons at default size outside compact', () => {
      const error = new Error('Roomy error');
      render(
        <ErrorDisplay error={error} onRetry={vi.fn()} onBack={vi.fn()} />,
        { withProviders: false }
      );

      // The contrast with the compact case is the point: without it, "compact
      // uses text-xs" is unfalsifiable if every size did.
      expect(screen.getByText('Roomy error')).toHaveClass('text-sm');
      expect(screen.getByRole('button', { name: /common.retry/i })).toHaveClass('h-9');
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

describe('ErrorDisplay drawing', () => {
  it('draws the full-size error large and roomy', () => {
    render(
      <ErrorDisplay error={new Error('Disk full')} onRetry={vi.fn()} onBack={vi.fn()} />,
      { withProviders: false },
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center', 'gap-4', 'px-4', 'min-h-[400px]');
    expect(alert).not.toHaveClass('py-4');
    const badge = alert.firstElementChild as HTMLElement;
    expect(badge).toHaveClass('rounded-full', 'bg-destructive/10', 'p-3');
    expect(badge).not.toHaveClass('p-2');
    expect(badge.querySelector('svg')).toHaveClass('text-destructive', 'h-6', 'w-6');
    expect(screen.getByText('errors.loadingFailed')).toHaveClass('font-semibold', 'text-destructive', 'text-lg');
    expect(screen.getByText('errors.loadingFailed').parentElement).toHaveClass('text-center');
    expect(screen.getByText('Disk full')).toHaveClass('mt-1', 'text-muted-foreground', 'text-sm');
    const retry = screen.getByRole('button', { name: /common.retry/ });
    expect(retry.parentElement).toHaveClass('flex', 'gap-2');
    expect(retry.querySelector('svg')).toHaveClass('mr-2', 'h-4', 'w-4');
    expect(screen.getByRole('button', { name: 'common.back' })).toBeInTheDocument();
  });

  it('draws the compact error small and tight', () => {
    render(<ErrorDisplay error={new Error('Disk full')} size="compact" />, { withProviders: false });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('py-4');
    expect(alert).not.toHaveClass('min-h-[400px]');
    const badge = alert.firstElementChild as HTMLElement;
    expect(badge).toHaveClass('p-2');
    expect(badge.querySelector('svg')).toHaveClass('h-5', 'w-5');
    expect(screen.getByText('errors.loadingFailed')).toHaveClass('text-base');
    expect(screen.getByText('Disk full')).toHaveClass('text-xs');
  });

  it('sizes its buttons to match the error', () => {
    const { unmount } = render(<ErrorDisplay error={null} onRetry={vi.fn()} onBack={vi.fn()} />, {
      withProviders: false,
    });
    expect(screen.getByRole('button', { name: /common.retry/ })).toHaveAttribute('data-size', 'default');
    expect(screen.getByRole('button', { name: 'common.back' })).toHaveAttribute('data-size', 'default');
    unmount();

    render(<ErrorDisplay error={null} onRetry={vi.fn()} onBack={vi.fn()} size="compact" />, {
      withProviders: false,
    });
    expect(screen.getByRole('button', { name: /common.retry/ })).toHaveAttribute('data-size', 'sm');
    expect(screen.getByRole('button', { name: 'common.back' })).toHaveAttribute('data-size', 'sm');
  });
});

