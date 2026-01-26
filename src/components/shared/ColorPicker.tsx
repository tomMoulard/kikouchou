/**
 * @fileoverview Color picker component for selecting person colors from a
 * predefined palette. Provides accessible keyboard navigation and visual
 * selection indicators.
 *
 * @module components/shared/ColorPicker
 */

import { type KeyboardEvent, memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default color palette for person colors.
 * These colors provide good visual distinction and contrast.
 */
const DEFAULT_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#eab308', // Yellow
  '#84cc16', // Lime
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
] as const,

/**
 * Translation keys for color names (used for accessibility labels).
 * Maps hex color codes to i18n translation keys.
 */
 COLOR_KEYS: Readonly<Record<string, string>> = {
  '#ef4444': 'colors.red',
  '#f97316': 'colors.orange',
  '#f59e0b': 'colors.amber',
  '#eab308': 'colors.yellow',
  '#84cc16': 'colors.lime',
  '#22c55e': 'colors.green',
  '#14b8a6': 'colors.teal',
  '#06b6d4': 'colors.cyan',
  '#3b82f6': 'colors.blue',
  '#6366f1': 'colors.indigo',
  '#8b5cf6': 'colors.violet',
  '#ec4899': 'colors.pink',
},

/** Number of columns in the color grid for keyboard navigation. */
 GRID_COLUMNS = 4;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ColorPicker component.
 */
interface ColorPickerProps {
  /** Currently selected color (hex string) */
  readonly value?: string;
  /** Callback invoked when a color is selected */
  readonly onChange: (color: string) => void;
  /** Custom color palette (defaults to predefined palette) */
  readonly colors?: readonly string[];
  /** Additional CSS classes for the container */
  readonly className?: string;
  /** Whether the picker is disabled */
  readonly disabled?: boolean;
  /** Accessible label for the color picker */
  readonly label?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the translation key for a color.
 * Returns undefined for unknown colors.
 */
function getColorKey(color: string): string | undefined {
  return COLOR_KEYS[color.toLowerCase()];
}

// ============================================================================
// Component
// ============================================================================

/**
 * A color picker component for selecting from a predefined palette of colors.
 *
 * Features:
 * - Grid layout with 4 columns
 * - Visual selection indicator (ring + checkmark)
 * - Full keyboard navigation (arrow keys, Enter/Space)
 * - Accessible with ARIA radiogroup pattern
 * - Customizable color palette
 *
 * @param props - Component props
 * @returns The color picker element
 *
 * @example
 * ```tsx
 * import { ColorPicker } from '@/components/shared/ColorPicker';
 *
 * function PersonForm() {
 *   const [color, setColor] = useState('#3b82f6');
 *
 *   return (
 *     <ColorPicker
 *       value={color}
 *       onChange={setColor}
 *       label="Person color"
 *     />
 *   );
 * }
 * ```
 */
const ColorPicker = memo(({
  value,
  onChange,
  colors = DEFAULT_COLORS,
  className,
  disabled = false,
  label = 'Color selection',
}: ColorPickerProps): React.ReactElement => {
  const { t } = useTranslation(),
  
  // Ref for managing focus during keyboard navigation
   buttonsRef = useRef<(HTMLButtonElement | null)[]>([]),

  // Find the index of the currently selected color
   selectedIndex = colors.findIndex(
    (c) => c.toLowerCase() === value?.toLowerCase(),
  ),

  /**
   * Handle color selection via click.
   */
   handleColorClick = useCallback(
    (color: string) => {
      if (!disabled) {
        onChange(color);
      }
    },
    [disabled, onChange],
  ),

  /**
   * Handle keyboard navigation within the color grid.
   * Implements roving tabindex pattern with arrow key navigation.
   */
   handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) {return;}

      const { key } = event,
       currentIndex = selectedIndex >= 0 ? selectedIndex : 0,
       totalColors = colors.length;

      let newIndex: number | null = null;

      switch (key) {
        case 'ArrowRight':
          newIndex = (currentIndex + 1) % totalColors;
          break;
        case 'ArrowLeft':
          newIndex = (currentIndex - 1 + totalColors) % totalColors;
          break;
        case 'ArrowDown':
          newIndex = (currentIndex + GRID_COLUMNS) % totalColors;
          break;
        case 'ArrowUp':
          newIndex = (currentIndex - GRID_COLUMNS + totalColors) % totalColors;
          break;
        case 'Enter':
        case ' ':
          // Select the currently focused color
          event.preventDefault();
          const focusedButton = buttonsRef.current.find(
            (btn) => btn === document.activeElement,
          );
          if (focusedButton) {
            const focusedIndex = buttonsRef.current.indexOf(focusedButton),
             colorAtIndex = colors[focusedIndex];
            if (colorAtIndex !== undefined) {
              onChange(colorAtIndex);
            }
          }
          return;
        default:
          return;
      }

      // Prevent default scroll behavior for arrow keys
      event.preventDefault();

      // Focus the new button and select the color
      if (newIndex !== null) {
        const newButton = buttonsRef.current[newIndex];
        if (newButton) {
          newButton.focus();
        }
        const newColor = colors[newIndex];
        if (newColor !== undefined) {
          onChange(newColor);
        }
      }
    },
    [colors, disabled, onChange, selectedIndex],
  );

  // Handle empty colors array
  if (colors.length === 0) {
    return <div className={className} />;
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid grid-cols-4 gap-2', className)}
      onKeyDown={handleKeyDown}
    >
      {colors.map((color, index) => {
        // Use pre-computed selectedIndex for efficiency
        const isSelected = index === selectedIndex,
         colorKey = getColorKey(color),
        // Get translated color name, with fallback for missing translations
         rawTranslation = colorKey ? t(colorKey) : t('colors.custom', 'Custom color'),
         colorName = typeof rawTranslation === 'string' ? rawTranslation : 'Custom color';

        return (
          <button
            key={color}
            ref={(el) => {
              buttonsRef.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={colorName}
            tabIndex={
              isSelected || (selectedIndex === -1 && index === 0) ? 0 : -1
            }
            disabled={disabled}
            onClick={() => handleColorClick(color)}
            className={cn(
              // Base styles - min 44px touch targets on mobile
              'size-11 md:size-10 rounded-full border-2 transition-all duration-150',
              // Focus styles
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              // Hover styles
              'hover:scale-110',
              // Selected styles
              isSelected
                ? 'border-foreground ring-2 ring-offset-2'
                : 'border-transparent',
              // Disabled styles
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
            )}
            style={{
              backgroundColor: color,
              // Use the color for the ring color when selected
              ['--tw-ring-color' as string]: isSelected ? color : undefined,
            }}
          >
            {/* Checkmark icon for selected state */}
            {isSelected && (
              <Check
                className="size-5 mx-auto text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                aria-hidden="true"
                strokeWidth={3}
              />
            )}
          </button>
        );
      })}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ColorPicker, DEFAULT_COLORS };
export type { ColorPickerProps };
