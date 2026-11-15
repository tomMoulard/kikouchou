/**
 * @fileoverview The beds part of the room form: one or more layouts, each a
 * list of beds with a kind, a count and a size, plus the extra spots.
 *
 * A room that can be set up two ways (two singles, or one queen when they are
 * pushed together) has two layouts. The room then sleeps as many people as its
 * largest layout, plus its extra spots. Which layout a night uses is the
 * planning's question, not this form's.
 *
 * The component is controlled: the room form owns the drafts, so its dirty
 * state, its validation and its submit see the same values.
 *
 * @module features/rooms/components/BedLayoutsField
 */

import { memo, useCallback, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberStepper } from '@/components/ui/number-stepper';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  createBedDraft,
  type BedDraft,
  type LayoutDraft,
} from '@/features/rooms/utils/bed-drafts';
import { formatBedKind } from '@/features/rooms/utils/bed-format';

import {
  BED_KINDS,
  BED_KIND_DEFAULT_SIZE,
  MAX_BED_COUNT,
  MAX_BED_LAYOUT_NAME_LENGTH,
  MAX_BED_LENGTH_CM,
  MAX_BED_WIDTH_CM,
  MAX_BEDS_PER_LAYOUT,
  MAX_ROOM_BED_LAYOUTS,
  MAX_ROOM_EXTRA_SPOTS,
  MIN_BED_LENGTH_CM,
  MIN_BED_WIDTH_CM,
} from '@/types';
import type { BedKind } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

interface BedLayoutsFieldProps {
  readonly layouts: readonly LayoutDraft[];
  readonly onLayoutsChange: (layouts: readonly LayoutDraft[]) => void;
  readonly extraSpots: number;
  readonly onExtraSpotsChange: (extraSpots: number) => void;
  /** Keys of the bed lines whose size is out of bounds. */
  readonly invalidBedKeys: ReadonlySet<string>;
  readonly disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The beds of a room, as one or more layouts.
 */
const BedLayoutsField = memo(function BedLayoutsField({
  layouts,
  onLayoutsChange,
  extraSpots,
  onExtraSpotsChange,
  invalidBedKeys,
  disabled = false,
}: BedLayoutsFieldProps) {
  const { t } = useTranslation();

  const updateLayout = useCallback(
    (layoutKey: string, update: (layout: LayoutDraft) => LayoutDraft | null) => {
      onLayoutsChange(
        layouts.flatMap((layout) => {
          if (layout.key !== layoutKey) {
            return [layout];
          }
          const next = update(layout);
          return next === null ? [] : [next];
        }),
      );
    },
    [layouts, onLayoutsChange],
  );

  const updateBed = useCallback(
    (layoutKey: string, bedKey: string, patch: Partial<Omit<BedDraft, 'key'>>) => {
      updateLayout(layoutKey, (layout) => ({
        ...layout,
        beds: layout.beds.map((bed) => (bed.key === bedKey ? { ...bed, ...patch } : bed)),
      }));
    },
    [updateLayout],
  );

  // Removing the last bed of a layout removes the layout: a layout with no
  // bed sleeps nobody and could not be saved.
  const removeBed = useCallback(
    (layoutKey: string, bedKey: string) => {
      updateLayout(layoutKey, (layout) => {
        const beds = layout.beds.filter((bed) => bed.key !== bedKey);
        return beds.length === 0 ? null : { ...layout, beds };
      });
    },
    [updateLayout],
  );

  const addBed = useCallback(
    (layoutKey: string) => {
      updateLayout(layoutKey, (layout) => ({
        ...layout,
        beds: [...layout.beds, createBedDraft('single')],
      }));
    },
    [updateLayout],
  );

  const addLayout = useCallback(() => {
    onLayoutsChange([
      ...layouts,
      { key: nanoid(), name: '', beds: [createBedDraft('queen')] },
    ]);
  }, [layouts, onLayoutsChange]);

  const removeLayout = useCallback(
    (layoutKey: string) => {
      updateLayout(layoutKey, () => null);
    },
    [updateLayout],
  );

  return (
    <div className="space-y-3">
      {layouts.map((layout, layoutIndex) => {
        const layoutNumber = layoutIndex + 1;
        const nameId = `room-layout-${layoutNumber}-name`;
        return (
          <div
            key={layout.key}
            role="group"
            aria-label={t('rooms.layoutLabel', { number: layoutNumber })}
            className="space-y-3 rounded-lg border p-3"
          >
            {/*
              The name only matters when there is something to tell apart, so
              a room with one layout does not ask for it.
            */}
            {layouts.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor={nameId}>{t('rooms.layoutName')}</Label>
                <Input
                  id={nameId}
                  value={layout.name}
                  maxLength={MAX_BED_LAYOUT_NAME_LENGTH}
                  placeholder={t('rooms.layoutNamePlaceholder')}
                  disabled={disabled}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const { value } = event.target;
                    updateLayout(layout.key, (current) => ({ ...current, name: value }));
                  }}
                />
              </div>
            )}

            <ul className="space-y-3">
              {layout.beds.map((bed, bedIndex) => {
                const bedId = `room-layout-${layoutNumber}-bed-${bedIndex + 1}`;
                const defaults = BED_KIND_DEFAULT_SIZE[bed.kind];
                const isInvalid = invalidBedKeys.has(bed.key);
                const errorId = `${bedId}-error`;
                return (
                  <li key={bed.key} className="space-y-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-0 flex-1 space-y-1.5 basis-40">
                        <Label htmlFor={`${bedId}-kind`}>{t('rooms.bedKind')}</Label>
                        <Select
                          value={bed.kind}
                          onValueChange={(value) => {
                            updateBed(layout.key, bed.key, { kind: value as BedKind });
                          }}
                          disabled={disabled}
                        >
                          <SelectTrigger id={`${bedId}-kind`} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BED_KINDS.map((kind) => (
                              <SelectItem key={kind} value={kind}>
                                {formatBedKind(kind, t)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`${bedId}-count`}>{t('rooms.bedCount')}</Label>
                        <NumberStepper
                          id={`${bedId}-count`}
                          value={bed.count}
                          min={1}
                          max={MAX_BED_COUNT}
                          onValueChange={(count) => {
                            updateBed(layout.key, bed.key, { count });
                          }}
                          decrementLabel={t('rooms.bedCountDecrease')}
                          incrementLabel={t('rooms.bedCountIncrease')}
                          disabled={disabled}
                        />
                      </div>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="w-24 space-y-1.5">
                        <Label htmlFor={`${bedId}-width`}>{t('rooms.bedWidth')}</Label>
                        <Input
                          id={`${bedId}-width`}
                          type="number"
                          inputMode="numeric"
                          min={MIN_BED_WIDTH_CM}
                          max={MAX_BED_WIDTH_CM}
                          value={bed.width}
                          placeholder={String(defaults.widthCm)}
                          aria-invalid={isInvalid}
                          aria-describedby={isInvalid ? errorId : undefined}
                          disabled={disabled}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            updateBed(layout.key, bed.key, { width: event.target.value });
                          }}
                        />
                      </div>
                      <span className="pb-2 text-muted-foreground" aria-hidden="true">×</span>
                      <div className="w-24 space-y-1.5">
                        <Label htmlFor={`${bedId}-length`}>{t('rooms.bedLength')}</Label>
                        <Input
                          id={`${bedId}-length`}
                          type="number"
                          inputMode="numeric"
                          min={MIN_BED_LENGTH_CM}
                          max={MAX_BED_LENGTH_CM}
                          value={bed.length}
                          placeholder={String(defaults.lengthCm)}
                          aria-invalid={isInvalid}
                          aria-describedby={isInvalid ? errorId : undefined}
                          disabled={disabled}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            updateBed(layout.key, bed.key, { length: event.target.value });
                          }}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto"
                        aria-label={t('rooms.removeBed')}
                        disabled={disabled}
                        onClick={() => {
                          removeBed(layout.key, bed.key);
                        }}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                    {isInvalid && (
                      <p id={errorId} className="text-sm text-destructive" role="alert">
                        {t('rooms.bedSizeInvalid', {
                          minWidth: MIN_BED_WIDTH_CM,
                          maxWidth: MAX_BED_WIDTH_CM,
                          minLength: MIN_BED_LENGTH_CM,
                          maxLength: MAX_BED_LENGTH_CM,
                        })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap gap-2">
              {layout.beds.length < MAX_BEDS_PER_LAYOUT && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    addBed(layout.key);
                  }}
                >
                  <Plus className="mr-1 size-4" aria-hidden="true" />
                  {t('rooms.addBedLine')}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={disabled}
                onClick={() => {
                  removeLayout(layout.key);
                }}
              >
                <Trash2 className="mr-1 size-4" aria-hidden="true" />
                {t('rooms.removeLayout')}
              </Button>
            </div>
          </div>
        );
      })}

      {layouts.length < MAX_ROOM_BED_LAYOUTS && (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={addLayout}
          >
            <Plus className="mr-1 size-4" aria-hidden="true" />
            {t('rooms.addLayout')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('rooms.addLayoutHint')}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="room-extra-spots">{t('rooms.extraSpots')}</Label>
        <NumberStepper
          id="room-extra-spots"
          value={extraSpots}
          min={0}
          max={MAX_ROOM_EXTRA_SPOTS}
          onValueChange={onExtraSpotsChange}
          decrementLabel={t('rooms.extraSpotsDecrease')}
          incrementLabel={t('rooms.extraSpotsIncrease')}
          aria-describedby="room-extra-spots-hint"
          disabled={disabled}
          className="w-fit"
        />
        <p id="room-extra-spots-hint" className="text-xs text-muted-foreground">
          {t('rooms.extraSpotsHint')}
        </p>
      </div>
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { BedLayoutsField };
export type { BedLayoutsFieldProps };
