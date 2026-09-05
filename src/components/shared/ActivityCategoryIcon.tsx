/**
 * @fileoverview Activity category icon component.
 * Maps activity categories to their Lucide icons.
 *
 * @module components/shared/ActivityCategoryIcon
 */

import { type CSSProperties, memo } from 'react';
import {
  Bike,
  Footprints,
  Hammer,
  Landmark,
  type LucideIcon,
  Music,
  PartyPopper,
  ShoppingBasket,
  Sprout,
  UtensilsCrossed,
  Waves,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ActivityCategory } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ActivityCategoryIcon component.
 */
interface ActivityCategoryIconProps {
  /** The activity category to display an icon for */
  readonly category: ActivityCategory | undefined;
  /** Additional CSS classes */
  readonly className?: string;
  /** Inline styles, typically the category colour */
  readonly style?: CSSProperties;
  /** Accessible label for screen readers; omit to mark the icon decorative */
  readonly 'aria-label'?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maps activity categories to their corresponding Lucide icons.
 */
const ACTIVITY_CATEGORY_ICONS: Readonly<Record<ActivityCategory, LucideIcon>> = {
  horticulture: Sprout,
  visit: Landmark,
  hike: Footprints,
  beach: Waves,
  sport: Bike,
  meal: UtensilsCrossed,
  culture: Music,
  market: ShoppingBasket,
  workshop: Hammer,
  other: PartyPopper,
} as const;

// ============================================================================
// Component
// ============================================================================

/**
 * Displays the icon standing for an activity category.
 *
 * Records with an unknown category fall back to the generic icon, so imported
 * or out-of-date data never renders a blank slot.
 *
 * @example
 * ```tsx
 * <ActivityCategoryIcon category="horticulture" />
 * <ActivityCategoryIcon category={activity.category} className="size-5" style={{ color }} />
 * ```
 */
const ActivityCategoryIcon = memo(function ActivityCategoryIcon({
  category,
  className,
  style,
  'aria-label': ariaLabel,
}: ActivityCategoryIconProps): React.ReactElement {
  const Icon =
    (category && ACTIVITY_CATEGORY_ICONS[category]) ?? ACTIVITY_CATEGORY_ICONS.other;

  return (
    <Icon
      className={cn('size-4 shrink-0', className)}
      style={style}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
    />
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ActivityCategoryIcon };
export type { ActivityCategoryIconProps };
