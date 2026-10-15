/**
 * @fileoverview Phone navigation card for the settings page: which four trip
 * pages sit in the bottom bar, and whether the bar is shown at all.
 *
 * Both answers are this device's. They live in the settings row, which never
 * syncs, because the right bar for one phone is not the right bar for another.
 *
 * @module features/settings/components/NavBarSettings
 */

import { type ReactElement, memo, useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Navigation, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ViewSwitcher,
  type ViewSwitcherOption,
} from '@/components/ui/view-switcher';
import { TRIP_NAV_ITEMS, type TripNavItem } from '@/components/shared/nav-items';
import { useMobileNavPreferences } from '@/hooks/useMobileNavPreferences';
import { updateSettings } from '@/lib/db';
import { notify } from '@/lib/notifications';
import { captureEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import {
  MOBILE_NAV_BAR_SLOTS,
  MOBILE_NAV_MODES,
  type MobileNavMode,
  type MobileNavPage,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

interface SortablePageRowProps {
  /** The page this row stands for */
  readonly item: TripNavItem;
  /** Its 1-based position, read out by the drag handle */
  readonly position: number;
}

/** A dropped order, and the stored order it was dropped over, as a key. */
interface PendingOrder {
  readonly overKey: string;
  readonly next: readonly MobileNavPage[];
}

// ============================================================================
// Constants
// ============================================================================

/** The default order, which "Restore" puts back. */
const DEFAULT_ORDER: readonly MobileNavPage[] = TRIP_NAV_ITEMS.map((item) => item.pathSuffix);

// ============================================================================
// Helpers
// ============================================================================

/** Whether two orders list the same pages in the same places. */
function isSameOrder(a: readonly MobileNavPage[], b: readonly MobileNavPage[]): boolean {
  return a.length === b.length && a.every((page, index) => page === b[index]);
}

/** The item for a page id dnd-kit hands back. */
function itemOf(id: string | number): TripNavItem | undefined {
  return TRIP_NAV_ITEMS.find((item) => item.pathSuffix === id);
}

/**
 * What a screen reader hears during a drag.
 *
 * dnd-kit's own announcements are built from the ids ("Draggable item money
 * was dropped..."), in English. These say the page's name and where it now
 * sits, in the user's language.
 *
 * @param t - Translator for the `settings.navBar.announce*` keys
 * @param order - The order the list shows
 * @returns The announcements for `DndContext`
 */
function buildOrderAnnouncements(
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
  order: readonly MobileNavPage[],
): Announcements {
  const nameOf = (id: string | number): string => {
      const item = itemOf(id);
      return item ? t(item.labelKey, item.labelKey) : String(id);
    },
    describe = (id: string | number, overId: string | number | undefined): string =>
      t('settings.navBar.announceOver', '{{page}} is at position {{position}} of {{count}}', {
        page: nameOf(id),
        position: (overId === undefined ? -1 : order.indexOf(overId as MobileNavPage)) + 1,
        count: order.length,
      });

  return {
    onDragStart: ({ active }) =>
      t('settings.navBar.announceStart', 'Picked up {{page}}', { page: nameOf(active.id) }),
    onDragOver: ({ active, over }) => describe(active.id, over?.id),
    onDragEnd: ({ active, over }) => describe(active.id, over?.id),
    onDragCancel: ({ active }) =>
      t('settings.navBar.announceCancel', 'Move of {{page}} cancelled', {
        page: nameOf(active.id),
      }),
  };
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * One page in the list, dragged by its handle.
 *
 * The whole row is not the handle, so a phone can still scroll the settings
 * page by swiping across the list.
 */
const SortablePageRow = memo(function SortablePageRow({
  item,
  position,
}: SortablePageRowProps): ReactElement {
  const { t } = useTranslation(),
    label: string = t(item.labelKey),
    { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
      useSortable({ id: item.pathSuffix });

  return (
    <li
      ref={setNodeRef}
      // Computed pixel geometry from dnd-kit, the inline-style carve-out.
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-lg border bg-background px-2 py-1',
        isDragging && 'relative z-10 shadow-md',
      )}
      data-testid={`nav-order-${item.pathSuffix}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        aria-label={t('settings.navBar.moveHandle', 'Move {{page}}, position {{position}}', {
          page: label,
          position,
        })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <item.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </li>
  );
});

// ============================================================================
// Component
// ============================================================================

/**
 * Lets the user reorder the trip pages by drag and drop, and choose between
 * the bottom bar, the header's menu button, or letting the screen size decide.
 *
 * No confirmation notification, like the theme next to it: the list moving
 * under the finger is the confirmation. A failed save is the one message, and
 * it goes to an in-page toast because the user has to read it.
 *
 * @returns The navigation preferences card
 */
export const NavBarSettings = memo(function NavBarSettings(): ReactElement {
  const { t } = useTranslation(),
    { order: storedOrder, mode } = useMobileNavPreferences(),
    sensors = useSensors(
      // The same activation as the room board: a click is not a drag, and a
      // touch has to be held so a swipe still scrolls the page.
      useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
      useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    ),
    orderLabelId = useId(),
    orderHintId = useId(),
    // The order the list shows between a drop and the live query reporting it
    // back. Without it the row jumps to its old place for a frame and then to
    // its new one. It holds only while the stored order is still the one it
    // was dropped over, so the save landing, or another tab's edit, ends it
    // without an effect.
    [pending, setPending] = useState<PendingOrder | null>(null),
    storedKey = storedOrder.join(','),
    order = pending !== null && pending.overKey === storedKey ? pending.next : storedOrder,
    { barItems, moreItems, isDefaultOrder } = useMemo(() => {
      const items = order.flatMap((page) =>
        TRIP_NAV_ITEMS.filter((item) => item.pathSuffix === page),
      );
      return {
        barItems: items.slice(0, MOBILE_NAV_BAR_SLOTS),
        moreItems: items.slice(MOBILE_NAV_BAR_SLOTS),
        isDefaultOrder: isSameOrder(order, DEFAULT_ORDER),
      };
    }, [order]),
    saveOrder = useCallback(
      (next: readonly MobileNavPage[]): void => {
        setPending({ overKey: storedKey, next });
        updateSettings({ mobileNavOrder: next })
          .then(() => {
            captureEvent('nav_bar_reordered', {
              bar_pages: next.slice(0, MOBILE_NAV_BAR_SLOTS),
              is_default: isSameOrder(next, DEFAULT_ORDER),
            });
          })
          .catch((error: unknown) => {
            console.error('Failed to save the navigation order:', error);
            setPending(null);
            notify.error(t('settings.navBar.saveFailed', 'Could not save the navigation'));
          });
      },
      [storedKey, t],
    ),
    handleDragEnd = useCallback(
      ({ active, over }: DragEndEvent): void => {
        if (over === null || active.id === over.id) {
          return;
        }
        const from = order.indexOf(active.id as MobileNavPage),
          to = order.indexOf(over.id as MobileNavPage);
        if (from === -1 || to === -1) {
          return;
        }
        saveOrder(arrayMove([...order], from, to));
      },
      [order, saveOrder],
    ),
    handleRestore = useCallback((): void => {
      saveOrder(DEFAULT_ORDER);
    }, [saveOrder]),
    handleModeChange = useCallback(
      (next: MobileNavMode): void => {
        captureEvent('nav_mode_changed', { mode: next });
        updateSettings({ mobileNavMode: next }).catch((error: unknown) => {
          console.error('Failed to save the navigation mode:', error);
          notify.error(t('settings.navBar.saveFailed', 'Could not save the navigation'));
        });
      },
      [t],
    ),
    modeOptions = useMemo<readonly ViewSwitcherOption<MobileNavMode>[]>(
      () =>
        MOBILE_NAV_MODES.map((option) => ({
          value: option,
          label: t(`settings.navBar.modes.${option}`, option),
        })),
      [t],
    ),
    announcements = useMemo(() => buildOrderAnnouncements(t, order), [order, t]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <Navigation className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">
              {t('settings.navBar.title', 'Phone navigation')}
            </CardTitle>
            <CardDescription>
              {t(
                'settings.navBar.description',
                'Choose which trip pages your phone shows at the bottom of the screen.',
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('settings.navBar.modeLabel', 'Display')}</p>
          <ViewSwitcher
            value={mode}
            onValueChange={handleModeChange}
            options={modeOptions}
            ariaLabel={t('settings.navBar.modeLabel', 'Display')}
            className="w-full sm:w-[360px]"
          />
          <p className="text-sm text-muted-foreground">
            {t(`settings.navBar.modeHints.${mode}`)}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium" id={orderLabelId}>
            {t('settings.navBar.orderLabel', 'Order')}
          </p>
          <p className="text-sm text-muted-foreground" id={orderHintId}>
            {t(
              'settings.navBar.orderHint',
              'Drag a page by its handle. The first four go in the bottom bar, the others in More.',
            )}
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            accessibility={{ announcements }}
          >
            <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
              <div
                className="space-y-3"
                role="group"
                aria-labelledby={orderLabelId}
                aria-describedby={orderHintId}
              >
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    {t('settings.navBar.inBar', 'In the bottom bar')}
                  </p>
                  <ol className="space-y-1">
                    {barItems.map((item, index) => (
                      <SortablePageRow key={item.pathSuffix} item={item} position={index + 1} />
                    ))}
                  </ol>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    {t('settings.navBar.inMore', 'In More')}
                  </p>
                  <ol className="space-y-1" start={MOBILE_NAV_BAR_SLOTS + 1}>
                    {moreItems.map((item, index) => (
                      <SortablePageRow
                        key={item.pathSuffix}
                        item={item}
                        position={MOBILE_NAV_BAR_SLOTS + index + 1}
                      />
                    ))}
                  </ol>
                </div>
              </div>
            </SortableContext>
          </DndContext>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRestore}
            disabled={isDefaultOrder}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {t('settings.navBar.restore', 'Restore the default order')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});
