/**
 * @fileoverview Room icon picker component for selecting room type icons.
 * Provides a grid of icon options with keyboard navigation and accessibility support.
 *
 * @module components/shared/RoomIconPicker
 */

import { memo, useCallback, useId, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Armchair,
  Baby,
  Bath,
  Bed,
  BedDouble,
  BedSingle,
  Caravan,
  DoorOpen,
  Home,
  Hotel,
  RockingChair,
  Sailboat,
  ShowerHead,
  Sofa,
  Tent,
  TentTree,
  Toilet,
  TreePalm,
  Van,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { DEFAULT_ROOM_ICON, type RoomIcon } from '@/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the RoomIconPicker component.
 */
export interface RoomIconPickerProps {
  /** Currently selected icon */
  readonly value?: RoomIcon;
  /** Callback when an icon is selected */
  readonly onChange: (icon: RoomIcon) => void;
  /** Whether the picker is disabled */
  readonly disabled?: boolean;
  /**
   * Whether to draw the "Room icon" label above the grid.
   *
   * Set it false where something else already says what the grid is — a
   * dialog whose title reads "Room icon", for one. The label is still in the
   * page for a screen reader, because it is what names the radiogroup.
   */
  readonly showLabel?: boolean;
  /** Additional CSS classes for the container */
  readonly className?: string;
  /** ID for form association */
  readonly id?: string;
}

/**
 * Icon configuration with component and translation key.
 */
interface IconConfig {
  readonly icon: LucideIcon;
  readonly labelKey: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Map of room icon types to their lucide-react components and label keys.
 *
 * lucide 0.563 has no glyph for a bunk bed, a hammock, a crib or an air
 * mattress, so those places borrow the nearest thing it does draw: a plain
 * `Bed` for the bunks and the spare mattress, a palm tree for the hammock, and
 * the rocking chair for a nursery. A cot already has `baby`.
 */
const ROOM_ICONS: Record<RoomIcon, IconConfig> = {
  'bed-double': { icon: BedDouble, labelKey: 'rooms.icons.bedDouble' },
  'bed-single': { icon: BedSingle, labelKey: 'rooms.icons.bedSingle' },
  'bath': { icon: Bath, labelKey: 'rooms.icons.bath' },
  'sofa': { icon: Sofa, labelKey: 'rooms.icons.sofa' },
  'tent': { icon: Tent, labelKey: 'rooms.icons.tent' },
  'caravan': { icon: Caravan, labelKey: 'rooms.icons.caravan' },
  'warehouse': { icon: Warehouse, labelKey: 'rooms.icons.warehouse' },
  'home': { icon: Home, labelKey: 'rooms.icons.home' },
  'door-open': { icon: DoorOpen, labelKey: 'rooms.icons.doorOpen' },
  'baby': { icon: Baby, labelKey: 'rooms.icons.baby' },
  'armchair': { icon: Armchair, labelKey: 'rooms.icons.armchair' },
  'bunk-bed': { icon: Bed, labelKey: 'rooms.icons.bunkBed' },
  'hammock': { icon: TreePalm, labelKey: 'rooms.icons.hammock' },
  'camper-van': { icon: Van, labelKey: 'rooms.icons.camperVan' },
  'campsite': { icon: TentTree, labelKey: 'rooms.icons.campsite' },
  'hotel': { icon: Hotel, labelKey: 'rooms.icons.hotel' },
  'rocking-chair': { icon: RockingChair, labelKey: 'rooms.icons.rockingChair' },
  'shower': { icon: ShowerHead, labelKey: 'rooms.icons.shower' },
  'toilet': { icon: Toilet, labelKey: 'rooms.icons.toilet' },
  'boat': { icon: Sailboat, labelKey: 'rooms.icons.boat' },
} as const;

/**
 * Ordered list of icon keys for keyboard navigation, and the order the grid
 * draws. The original eleven stay at the front so nobody has to hunt for the
 * icon they have always used; the newer places follow.
 */
const ICON_ORDER: readonly RoomIcon[] = [
  'bed-double',
  'bed-single',
  'bath',
  'sofa',
  'tent',
  'caravan',
  'warehouse',
  'home',
  'door-open',
  'baby',
  'armchair',
  'bunk-bed',
  'hammock',
  'camper-van',
  'campsite',
  'hotel',
  'rocking-chair',
  'shower',
  'toilet',
  'boat',
] as const;

/**
 * Number of columns in the grid (for keyboard navigation).
 */
const GRID_COLUMNS = 4;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets the Lucide icon component for a room icon type.
 * Returns the default icon (BedDouble) for unknown types.
 */
export function getRoomIconComponent(icon?: RoomIcon): LucideIcon {
  if (!icon) return BedDouble;
  return ROOM_ICONS[icon]?.icon ?? BedDouble;
}

/**
 * Gets the translation key for a room icon type.
 */
export function getRoomIconLabelKey(icon: RoomIcon): string {
  return ROOM_ICONS[icon]?.labelKey ?? 'rooms.icons.bedDouble';
}

// ============================================================================
// Component
// ============================================================================

/**
 * Room icon picker component for selecting room type icons.
 *
 * Features:
 * - Grid layout of every icon in {@link ICON_ORDER}
 * - Keyboard navigation (arrow keys, Home/End)
 * - Visual selection state with ring highlight
 * - Accessible with ARIA labels and descriptions
 * - Disabled state support
 *
 * @param props - Component props
 * @returns The room icon picker element
 *
 * @example
 * ```tsx
 * <RoomIconPicker
 *   value={selectedIcon}
 *   onChange={(icon) => setSelectedIcon(icon)}
 * />
 * ```
 */
const RoomIconPicker = memo(function RoomIconPicker({
  value,
  onChange,
  disabled = false,
  showLabel = true,
  className,
  id,
}: RoomIconPickerProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const pickerId = id ?? generatedId;
  const selectedIcon = value ?? DEFAULT_ROOM_ICON;

  /**
   * Handles icon button click.
   */
  const handleIconClick = useCallback(
    (icon: RoomIcon) => {
      if (disabled) return;
      onChange(icon);
    },
    [disabled, onChange],
  );

  /**
   * Handles keyboard navigation within the grid.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentIcon: RoomIcon) => {
      if (disabled) return;

      const currentIndex = ICON_ORDER.indexOf(currentIcon);
      if (currentIndex === -1) return;

      let nextIndex: number | undefined;

      switch (event.key) {
        case 'ArrowRight':
          nextIndex = currentIndex + 1;
          break;
        case 'ArrowLeft':
          nextIndex = currentIndex - 1;
          break;
        case 'ArrowDown':
          nextIndex = currentIndex + GRID_COLUMNS;
          break;
        case 'ArrowUp':
          nextIndex = currentIndex - GRID_COLUMNS;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = ICON_ORDER.length - 1;
          break;
        default:
          return;
      }

      // Wrap around if out of bounds
      if (nextIndex !== undefined) {
        event.preventDefault();
        if (nextIndex < 0) {
          nextIndex = ICON_ORDER.length + nextIndex;
        } else if (nextIndex >= ICON_ORDER.length) {
          nextIndex = nextIndex % ICON_ORDER.length;
        }
        const nextIcon = ICON_ORDER[nextIndex];
        if (nextIcon) {
          onChange(nextIcon);
          // Focus the next button
          const nextButton = document.querySelector(
            `[data-room-icon="${nextIcon}"]`,
          ) as HTMLButtonElement | null;
          nextButton?.focus();
        }
      }
    },
    [disabled, onChange],
  );

  return (
    <div className={cn('space-y-2', className)}>
      <Label id={`${pickerId}-label`} className={cn(!showLabel && 'sr-only')}>
        {t('rooms.icon', 'Room icon')}
      </Label>
      <div
        role="radiogroup"
        aria-labelledby={`${pickerId}-label`}
        // Three columns on a phone, not four. At four the tile is narrower than
        // "Double bed" renders at `text-xs`, and every multi-word label came
        // out as "Do…" — an icon grid whose labels are all elided is just an
        // icon grid. The labels wrap instead of truncating, so the widest one
        // sets the row height rather than getting cut.
        className="grid grid-cols-3 gap-2 sm:grid-cols-6"
      >
        {ICON_ORDER.map((iconKey) => {
          const config = ROOM_ICONS[iconKey];
          if (!config) return null;

          const IconComponent = config.icon;
          const isSelected = selectedIcon === iconKey;
          const label = t(config.labelKey, iconKey);

          return (
            <button
              key={iconKey}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={label}
              title={label}
              data-room-icon={iconKey}
              disabled={disabled}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => handleIconClick(iconKey)}
              onKeyDown={(e) => handleKeyDown(e, iconKey)}
              className={cn(
                'flex min-h-20 flex-col items-center justify-center gap-1 p-2 rounded-lg border-2 transition-all',
                'hover:bg-accent hover:border-accent-foreground/20',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isSelected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground',
                disabled && 'opacity-50 cursor-not-allowed hover:bg-background',
              )}
            >
              <IconComponent
                className={cn(
                  'size-6',
                  isSelected ? 'text-primary' : 'text-muted-foreground',
                )}
                aria-hidden="true"
              />
              <span className="text-xs text-center leading-tight">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RoomIconPicker, ROOM_ICONS, ICON_ORDER };
