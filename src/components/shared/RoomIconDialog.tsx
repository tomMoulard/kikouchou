/**
 * @fileoverview The room icon, as a button that opens a picker in a dialog.
 *
 * The icon grid used to sit open in the room form, eleven tiles tall, between
 * the name and the bed count. It is a choice most rooms never change — the
 * double bed is right nearly every time — so it now shows as one button beside
 * the name, and the grid comes out only when somebody asks for it.
 *
 * @module components/shared/RoomIconDialog
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  RoomIconPicker,
  getRoomIconComponent,
  getRoomIconLabelKey,
} from '@/components/shared/RoomIconPicker';
import { cn } from '@/lib/utils';
import { DEFAULT_ROOM_ICON, type RoomIcon } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the RoomIconDialog component.
 */
export interface RoomIconDialogProps {
  /**
   * The icon the room carries today.
   *
   * `undefined` is the value a room with no icon has always stored, and it
   * still is: the button draws the double bed for it, and the room keeps an
   * empty icon field until somebody picks one.
   */
  readonly value?: RoomIcon;
  /** Callback when an icon is picked. The dialog closes on its own. */
  readonly onChange: (icon: RoomIcon) => void;
  /** Whether the button is disabled */
  readonly disabled?: boolean;
  /** Additional CSS classes for the button */
  readonly className?: string;
  /** ID for form association */
  readonly id?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Builds the glyph for one room icon.
 *
 * Outside the button's own body on purpose: `getRoomIconComponent` returns a
 * component, and resolving one inside a component's render is what
 * `react-hooks/static-components` objects to. The rooms timeline and the trip
 * form read it the same way, each from inside a callback.
 *
 * `data-selected-room-icon`, not `data-room-icon`: the picker's keyboard
 * navigation looks a tile up with
 * `document.querySelector('[data-room-icon=…]')`, and the button comes first
 * in the document, so sharing the name would hand the arrow keys a glyph to
 * focus instead of a tile.
 */
function renderRoomIconGlyph(icon: RoomIcon): ReactElement {
  const IconComponent = getRoomIconComponent(icon);
  return (
    <IconComponent
      className="size-5"
      data-selected-room-icon={icon}
      aria-hidden="true"
    />
  );
}

/**
 * The room's icon as a button, with the full picker behind it.
 *
 * @param props - Component props
 * @returns The icon button, and the dialog it opens
 *
 * @example
 * ```tsx
 * <RoomIconDialog value={icon} onChange={setIcon} />
 * ```
 */
const RoomIconDialog = memo(function RoomIconDialog({
  value,
  onChange,
  disabled = false,
  className,
  id,
}: RoomIconDialogProps) {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);

  // A room with no icon of its own reads as the default one, here and
  // everywhere else the icon is drawn.
  const selectedIcon = value ?? DEFAULT_ROOM_ICON;
  const selectedLabel = t(getRoomIconLabelKey(selectedIcon), selectedIcon);

  /**
   * Takes the pick and closes the dialog. One tile is the whole errand, so
   * there is nothing left to confirm.
   */
  const handleChange = useCallback(
    (icon: RoomIcon) => {
      onChange(icon);
      setIsOpen(false);
    },
    [onChange],
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          // Matches the name input's height so the pair sits on one line.
          className={cn('size-9 shrink-0', className)}
          aria-label={t('rooms.changeIcon', {
            icon: selectedLabel,
            defaultValue: 'Change the room icon: {{icon}}',
          })}
        >
          {renderRoomIconGlyph(selectedIcon)}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('rooms.icon', 'Room icon')}</DialogTitle>
          <DialogDescription>
            {t('rooms.iconHint', 'Pick the icon that fits this room best.')}
          </DialogDescription>
        </DialogHeader>
        {/* Twenty tiles are taller than a phone: the grid scrolls, the title
            and the close button stay put. */}
        <div className="max-h-[60vh] overflow-y-auto">
          <RoomIconPicker
            value={selectedIcon}
            onChange={handleChange}
            showLabel={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RoomIconDialog };
