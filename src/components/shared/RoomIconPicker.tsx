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
  BedDouble,
  BedSingle,
  Caravan,
  DoorOpen,
  Home,
  Sofa,
  Tent,
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
} as const;

/**
 * Ordered list of icon keys for keyboard navigation.
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
 * - Grid layout of 11 icon options
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
const RoomIconPicker = memo(({
  value,
  onChange,
  disabled = false,
  className,
  id,
}: RoomIconPickerProps) => {
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

      let nextIndex: number | null = null;

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
      if (nextIndex !== null) {
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
      <Label id={`${pickerId}-label`}>{t('rooms.icon', 'Room icon')}</Label>
      <div
        role="radiogroup"
        aria-labelledby={`${pickerId}-label`}
        className="grid grid-cols-4 sm:grid-cols-6 gap-2"
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
                'flex flex-col items-center justify-center gap-1 p-3 rounded-lg border-2 transition-all',
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
              <span className="text-xs truncate max-w-full">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

RoomIconPicker.displayName = 'RoomIconPicker';

// ============================================================================
// Exports
// ============================================================================

export { RoomIconPicker, ROOM_ICONS, ICON_ORDER };
