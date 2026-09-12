/**
 * @fileoverview Reusable error display component for consistent error UI across pages.
 * Provides a standardized way to display errors with optional retry functionality.
 *
 * @module components/shared/ErrorDisplay
 */

import { type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the ErrorDisplay component.
 */
export interface ErrorDisplayProps {
  /**
   * The error object to display.
   * Can be an Error object or null/undefined (will show generic message).
   */
  error?: Error | null;

  /**
   * Optional custom title for the error.
   * Defaults to translated 'errors.loadingFailed'.
   */
  title?: string;

  /**
   * Optional callback for retry functionality.
   * When provided, a retry button will be displayed.
   */
  onRetry?: () => void;

  /**
   * Optional callback for navigation (e.g., "Go Back" action).
   * When provided, a secondary action button will be displayed.
   */
  onBack?: () => void;

  /**
   * Label for the back button.
   * Defaults to translated 'common.back'.
   */
  backLabel?: string;

  /**
   * Additional CSS classes to apply to the container.
   */
  className?: string;

  /**
   * Optional children to render below the error message.
   */
  children?: ReactNode;

  /**
   * Size variant for the error display.
   * - 'default': Standard size for page-level errors
   * - 'compact': Smaller size for inline/section errors
   * @default 'default'
   */
  size?: 'default' | 'compact';

  /**
   * Whether to show the error message from the Error object.
   * @default true
   */
  showMessage?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A reusable error display component that provides consistent error UI.
 *
 * Features:
 * - Accessible: Uses role="alert" and aria-live="assertive" for screen readers
 * - i18n: All text uses translations with safe fallbacks
 * - Flexible: Supports retry, back navigation, and custom children
 * - Consistent: Matches the styling used across all feature pages
 *
 * @example
 * ```tsx
 * // Basic usage with retry
 * <ErrorDisplay
 *   error={error}
 *   onRetry={() => refetch()}
 * />
 *
 * // With back navigation
 * <ErrorDisplay
 *   error={error}
 *   onRetry={() => refetch()}
 *   onBack={() => navigate(-1)}
 * />
 *
 * // Compact inline variant
 * <ErrorDisplay
 *   error={error}
 *   size="compact"
 *   onRetry={() => refetch()}
 * />
 *
 * // Custom title
 * <ErrorDisplay
 *   error={error}
 *   title="Failed to save changes"
 *   onRetry={handleRetry}
 * />
 * ```
 */
export const ErrorDisplay = memo(function ErrorDisplay({
  error,
  title,
  onRetry,
  onBack,
  backLabel,
  className,
  children,
  size = 'default',
  showMessage = true,
}: ErrorDisplayProps) {
  const { t } = useTranslation(),

   isCompact = size === 'compact';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-4',
        isCompact ? 'py-4' : 'min-h-[400px]',
        className,
      )}
      role="alert"
      aria-live="assertive"
    >
      {/* Icon */}
      <div
        className={cn(
          'rounded-full bg-destructive/10 p-3',
          isCompact && 'p-2',
        )}
        aria-hidden="true"
      >
        <AlertCircle
          className={cn(
            'text-destructive',
            isCompact ? 'h-5 w-5' : 'h-6 w-6',
          )}
        />
      </div>

      {/* Error Text */}
      <div className="text-center">
        <p
          className={cn(
            'font-semibold text-destructive',
            isCompact ? 'text-base' : 'text-lg',
          )}
        >
          {title ?? t('errors.loadingFailed', 'Failed to load')}
        </p>
        {showMessage && error?.message && (
          <p
            className={cn(
              'mt-1 text-muted-foreground',
              isCompact ? 'text-xs' : 'text-sm',
            )}
          >
            {error.message}
          </p>
        )}
      </div>

      {/* Actions */}
      {(onRetry ?? onBack) && (
        <div className="flex gap-2">
          {onRetry && (
            <Button
              onClick={onRetry}
              variant="outline"
              size={isCompact ? 'sm' : 'default'}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('common.retry', 'Retry')}
            </Button>
          )}
          {onBack && (
            <Button
              onClick={onBack}
              variant="ghost"
              size={isCompact ? 'sm' : 'default'}
            >
              {backLabel ?? t('common.back', 'Back')}
            </Button>
          )}
        </div>
      )}

      {/* Custom Children */}
      {children}
    </div>
  );
});
