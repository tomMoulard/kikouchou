/**
 * @fileoverview PersonBadge component for displaying a person with their color.
 * Provides accessible badges with automatic text contrast calculation.
 *
 * @module components/shared/PersonBadge
 */

import { type KeyboardEvent, type MouseEvent, memo, useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { Person } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** Fallback color when an invalid hex color is provided */
const FALLBACK_COLOR = '#6B7280', // Neutral gray

/** WCAG luminance threshold for determining text color */
 LUMINANCE_THRESHOLD = 0.179;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * RGB color values normalized to 0-1 range.
 */
interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

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
// Utility Functions
// ============================================================================

/**
 * Parses a hex color string to RGB values normalized to 0-1 range.
 *
 * @param hex - Hex color string (with or without #, 3 or 6 characters)
 * @returns RGB object or null if invalid
 *
 * @example
 * parseHexColor('#ff5500') // { r: 1, g: 0.333, b: 0 }
 * parseHexColor('f50')     // { r: 1, g: 0.333, b: 0 }
 */
function parseHexColor(hex: string): RGB | null {
  // Normalize: remove # prefix and convert to lowercase
  let normalized = hex.replace(/^#/, '').toLowerCase();

  // Strip alpha channel if present (8 chars -> 6 chars)
  if (normalized.length === 8) {
    normalized = normalized.slice(0, 6);
  }

  // Expand 3-char format to 6-char
  if (normalized.length === 3) {
    normalized = normalized
      .split('')
      .map((c) => c + c)
      .join('');
  }

  // Validate: must be exactly 6 hex characters
  if (!/^[0-9a-f]{6}$/.test(normalized)) {
    return null;
  }

  // Parse hex values and normalize to 0-1 range
  const r = parseInt(normalized.slice(0, 2), 16) / 255,
   g = parseInt(normalized.slice(2, 4), 16) / 255,
   b = parseInt(normalized.slice(4, 6), 16) / 255;

  return { r, g, b };
}

/**
 * Calculates the relative luminance of a color per WCAG 2.1.
 * Uses sRGB gamma correction and the luminance formula.
 *
 * @param rgb - RGB color values normalized to 0-1
 * @returns Relative luminance value between 0 (black) and 1 (white)
 *
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function calculateLuminance(rgb: RGB): number {
  // Apply sRGB gamma correction
  const gammaCorrected = (value: number): number =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055)**2.4,

   r = gammaCorrected(rgb.r),
   g = gammaCorrected(rgb.g),
   b = gammaCorrected(rgb.b);

  // WCAG luminance formula
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

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
  // Extract name and color from either prop pattern
  const name = props.person?.name ?? props.name ?? '',
   color = props.person?.color ?? props.color ?? FALLBACK_COLOR,
   { size = 'default', onClick, className } = props,

  // Calculate contrast text color based on background
  // Validate color and calculate text color in a single computation (DRY)
   { validatedColor, textColor } = useMemo(() => {
    const rgb = parseHexColor(color);
    if (!rgb) {
      // Invalid color - use fallback with appropriate text color
      const fallbackRgb = parseHexColor(FALLBACK_COLOR),
       fallbackLuminance = fallbackRgb ? calculateLuminance(fallbackRgb) : 0.5;
      return {
        validatedColor: FALLBACK_COLOR,
        textColor: fallbackLuminance > LUMINANCE_THRESHOLD ? '#000000' : '#FFFFFF',
      };
    }
    const luminance = calculateLuminance(rgb);
    return {
      validatedColor: color,
      textColor: luminance > LUMINANCE_THRESHOLD ? '#000000' : '#FFFFFF',
    };
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
      aria-label={isInteractive ? `${name} - click to interact` : undefined}
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
