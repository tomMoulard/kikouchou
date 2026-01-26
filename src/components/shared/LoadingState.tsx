/**
 * @fileoverview Loading state component with full-page and inline variants.
 * Provides accessible loading indicators with spinner animation and
 * screen reader support for asynchronous operations.
 *
 * @module components/shared/LoadingState
 */

import { memo } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Available loading state display variants.
 */
type LoadingVariant = 'fullPage' | 'inline';

/**
 * Available spinner size options.
 */
type LoadingSize = 'sm' | 'md' | 'lg';

/**
 * Props for the LoadingState component.
 */
interface LoadingStateProps {
  /**
   * Display variant for the loading state.
   * - `fullPage`: Centered spinner covering the viewport, for route transitions or initial loads
   * - `inline`: Compact spinner for contextual loading within sections, buttons, or cards
   * @default 'inline'
   */
  readonly variant?: LoadingVariant;

  /**
   * Size of the loading spinner.
   * - `sm`: 16x16px - for buttons or tight spaces
   * - `md`: 24x24px - default size for most use cases
   * - `lg`: 32x32px - for prominent loading states
   * @default 'md'
   */
  readonly size?: LoadingSize;

  /**
   * Custom loading text to display.
   * Falls back to the translated `common.loading` key if not provided.
   */
  readonly label?: string;

  /**
   * Whether to visually display the loading text.
   * Screen readers will always have access to the text regardless of this setting.
   * @default true for fullPage, false for inline
   */
  readonly showLabel?: boolean;

  /**
   * Additional CSS classes for the container element.
   */
  readonly className?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Tailwind classes for spinner sizes.
 */
const SIZE_CLASSES: Record<LoadingSize, string> = {
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-8',
} as const,

/**
 * Tailwind classes for text sizes matching spinner sizes.
 */
 TEXT_SIZE_CLASSES: Record<LoadingSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
} as const,

// ============================================================================
// Component
// ============================================================================

/**
 * A loading state component with full-page and inline variants.
 *
 * Provides an accessible loading indicator with:
 * - Animated spinner using Lucide's Loader2 icon
 * - Screen reader support via ARIA attributes
 * - Reduced motion support for accessibility
 * - Configurable size and label visibility
 *
 * @param props - Component props
 * @returns The loading state display element
 *
 * @example
 * ```tsx
 * import { LoadingState } from '@/components/shared/LoadingState';
 *
 * // Full-page loading during route transitions
 * function PageLoader() {
 *   return <LoadingState variant="fullPage" />;
 * }
 *
 * // Inline loading in a card or section
 * function DataSection({ isLoading, data }) {
 *   if (isLoading) {
 *     return <LoadingState variant="inline" size="sm" />;
 *   }
 *   return <div>{data}</div>;
 * }
 *
 * // Custom loading message
 * <LoadingState
 *   variant="inline"
 *   label="Saving changes..."
 *   showLabel
 * />
 * ```
 */
 LoadingState = memo(({
  variant = 'inline',
  size = 'md',
  label,
  showLabel,
  className,
}: LoadingStateProps): React.ReactElement => {
  const { t } = useTranslation(),

  // Determine loading text with fallback
   loadingText = label ?? t('common.loading', 'Loading...'),

  // Determine if label should be shown visually
  // Default: show for fullPage, hide for inline
   shouldShowLabel = showLabel ?? variant === 'fullPage',

  // Get size classes for spinner and text
   spinnerSizeClass = SIZE_CLASSES[size],
   textSizeClass = TEXT_SIZE_CLASSES[size],

  // Common spinner element
   spinner = (
    <Loader2
      className={cn(
        spinnerSizeClass,
        'text-primary',
        // Only animate when user hasn't requested reduced motion
        'motion-safe:animate-spin',
      )}
      aria-hidden="true"
    />
  );

  // Full-page variant: covers viewport with centered content
  if (variant === 'fullPage') {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className={cn(
          'fixed inset-0 z-50',
          'flex flex-col items-center justify-center gap-3',
          'bg-background/80 backdrop-blur-sm',
          className,
        )}
      >
        {/* Screen reader announcement */}
        <span className="sr-only">{loadingText}</span>

        {/* Visual spinner */}
        {spinner}

        {/* Optional visible label */}
        {shouldShowLabel && (
          <span
            className={cn(textSizeClass, 'text-muted-foreground')}
            aria-hidden="true"
          >
            {loadingText}
          </span>
        )}
      </div>
    );
  }

  // Inline variant: compact layout for contextual loading
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(
        'inline-flex items-center justify-center gap-2',
        'py-2',
        className,
      )}
    >
      {/* Screen reader announcement */}
      <span className="sr-only">{loadingText}</span>

      {/* Visual spinner */}
      {spinner}

      {/* Optional visible label */}
      {shouldShowLabel && (
        <span
          className={cn(textSizeClass, 'text-muted-foreground')}
          aria-hidden="true"
        >
          {loadingText}
        </span>
      )}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { LoadingState };
export type { LoadingStateProps, LoadingVariant, LoadingSize };
