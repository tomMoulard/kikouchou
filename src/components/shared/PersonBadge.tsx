/**
 * @fileoverview PersonBadge component for displaying a person with their color.
 * Provides accessible badges with automatic text contrast calculation.
 *
 * @module components/shared/PersonBadge
 */

import { type KeyboardEvent, type MouseEvent, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

import { cn } from '@/lib/utils';
import { getContrastTextHex, parseHexColor } from '@/lib/utils/color-contrast';
import type { Person } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** Fallback color when an invalid hex color is provided */
const FALLBACK_COLOR = '#6B7280'; // Neutral gray

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Base props shared by all PersonBadge variants.
 */
interface PersonBadgeBaseProps {
  /** Size variant for the badge */
  readonly size?: 'sm' | 'default';
  /** Click handler for interactive badges */
  readonly onClick?: () => void;
  /** Additional CSS classes */
  readonly className?: string;
}

/**
 * Props when using a Person object.
 */
interface PersonBadgeWithPersonProps extends PersonBadgeBaseProps {
  /** The person to display */
  readonly person: Person;
  readonly name?: never;
  readonly color?: never;
}

/**
 * Props when using individual name and color values.
 */
interface PersonBadgeWithNameColorProps extends PersonBadgeBaseProps {
  readonly person?: never;
  /** The person's display name */
  readonly name: string;
  /** Hex color for the badge background */
  readonly color: string;
}

/**
 * Props for the PersonBadge component.
 * Accepts either a Person object OR individual name + color props.
 */
type PersonBadgeProps = PersonBadgeWithPersonProps | PersonBadgeWithNameColorProps;

// ============================================================================
// Component
// ============================================================================

/**
 * PersonBadge displays a person's name with their associated color.
 *
 * Features:
 * - Automatic text color contrast calculation (WCAG AA compliant)
 * - Size variants (sm, default)
 * - Optional click handler for interactive badges
 * - Flexible API: accepts Person object or individual name/color props
 * - Accessible with proper ARIA attributes
 *
 * @example
 * ```tsx
 * // With Person object
 * <PersonBadge person={person} />
 *
 * // With individual props
 * <PersonBadge name="Marie" color="#ef4444" />
 *
 * // Small size with click handler
 * <PersonBadge
 *   person={person}
 *   size="sm"
 *   onClick={() => console.log('clicked')}
 * />
 * ```
 */
const PersonBadge = memo((
  props: PersonBadgeProps
): React.ReactElement => {
  const { t } = useTranslation();

  // Extract name and color from either prop pattern
  const name = props.person?.name ?? props.name ?? '',
   color = props.person?.color ?? props.color ?? FALLBACK_COLOR,
   { size = 'default', onClick, className } = props,

  // Calculate contrast text color based on background
  // Validate color and calculate text color in a single computation (DRY)
   { validatedColor, textColor } = useMemo(() => {
    // An unparseable colour falls back to the neutral grey rather than painting
    // an invalid value into the style attribute.
    const background = parseHexColor(color) === null ? FALLBACK_COLOR : color;
    return { validatedColor: background, textColor: getContrastTextHex(background) };
  }, [color]),

  // Determine if the badge is interactive
   isInteractive = onClick !== undefined,

  // Handle keyboard events for interactive badges
   handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick?.();
      }
    },
    [onClick]
  ),

  // Handle click events
   handleClick = useCallback(
    (event: MouseEvent<HTMLSpanElement>) => {
      event.stopPropagation();
      onClick?.();
    },
    [onClick]
  ),

  // Size-specific classes
   sizeClasses = size === 'sm' ? 'text-xs px-1.5 py-0' : 'text-sm px-2.5 py-0.5',

  // Interactive-specific classes
   interactiveClasses = isInteractive
    ? 'cursor-pointer hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
    : '';

  return (
    <Badge
      variant="secondary"
      className={cn(sizeClasses, interactiveClasses, className)}
      style={{
        backgroundColor: validatedColor,
        color: textColor,
        borderColor: 'transparent',
      }}
      onClick={isInteractive ? handleClick : undefined}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      role={isInteractive ? 'button' : 'status'}
      aria-label={
        isInteractive
          ? t('persons.badgeInteractive', 'Select {{name}}', { name })
          : undefined
      }
    >
      {name}
    </Badge>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { PersonBadge };
export type { PersonBadgeProps };
