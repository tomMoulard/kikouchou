/**
 * @fileoverview The review step for a suggested room allocation.
 *
 * The planner proposes; this dialog is where a human agrees. It lists one row
 * per guest per gap with the room the planner picked, lets any of them be
 * changed or dropped, and writes nothing until "Apply" is pressed — so the
 * whole board is one review instead of ten drags, and a suggestion nobody likes
 * costs a Cancel rather than an undo.
 *
 * Capacity is re-checked here against the rows as they stand, not against the
 * planner's own arithmetic: the reader can put four people in a double if they
 * mean to, and they should be told they are doing it.
 *
 * @module features/rooms/components/AllocationSuggestionDialog
 */

import { type ReactElement, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { statusVariants } from '@/components/ui/status.variants';
import { PersonBadge } from '@/components/shared/PersonBadge';
import type { SuggestedStay } from '@/features/rooms/utils/allocation-planner';
import {
  buildNightlyOccupancyByRoom,
  createHeadcountResolver,
} from '@/features/rooms/utils/capacity-utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { formatDateRange } from '@/lib/utils/date-format';
import { cn } from '@/lib/utils';
import { useStalled } from '@/hooks/useStalled';
import type { Person, Room, RoomAssignment, RoomId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A stay the reader has agreed to, ready for `createAssignment`.
 */
export interface ConfirmedStay {
  /** The guest. */
  readonly personId: Person['id'];
  /** The room they were given. */
  readonly roomId: RoomId;
  /** Check-in day. */
  readonly startDate: string;
  /** Check-out morning, exclusive. */
  readonly endDate: string;
}

/**
 * Props for {@link AllocationSuggestionDialog}.
 */
export interface AllocationSuggestionDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback to change open state. */
  readonly onOpenChange: (open: boolean) => void;
  /** The planner's proposal, in the order it should be read. */
  readonly stays: readonly SuggestedStay[];
  /** Every room in the trip, for the per-row picker. */
  readonly rooms: readonly Room[];
  /** The trip's guests, for names, colours and headcounts. */
  readonly persons: readonly Person[];
  /** Existing assignments, which the capacity check counts from. */
  readonly assignments: readonly RoomAssignment[];
  /** Writes the agreed stays. Resolves once they are all saved. */
  readonly onApply: (stays: readonly ConfirmedStay[]) => Promise<void>;
}

/** One row of the review list. */
interface ReviewRow {
  readonly key: string;
  readonly stay: SuggestedStay;
  readonly person: Person;
}

/** A party's rows, kept adjacent so "together" is visible. */
interface ReviewParty {
  readonly partyKey: string;
  readonly rows: readonly ReviewRow[];
  /** Names of the other guests in the party, for the "travels with" line. */
  readonly memberNames: readonly string[];
}

// ============================================================================
// Constants
// ============================================================================

/** The picker value that means "give this guest no room for now". */
const NO_ROOM = 'none';

// ============================================================================
// Helpers
// ============================================================================

/**
 * A row's identity: one guest, one gap. Stable across re-renders and unique,
 * because a guest can need two separate stretches of nights.
 */
function rowKeyOf(stay: SuggestedStay): string {
  return `${stay.personId}|${stay.startDate}|${stay.endDate}`;
}

/**
 * Builds the review list: rows in the planner's order, grouped by party.
 *
 * A stay whose guest is no longer in the trip is dropped rather than rendered
 * nameless.
 */
function buildParties(
  stays: readonly SuggestedStay[],
  persons: readonly Person[],
): readonly ReviewParty[] {
  const personById = new Map(persons.map((person) => [person.id, person]));
  const order: string[] = [];
  const rowsByParty = new Map<string, ReviewRow[]>();

  for (const stay of stays) {
    const person = personById.get(stay.personId);
    if (!person) {
      continue;
    }
    const row: ReviewRow = { key: rowKeyOf(stay), stay, person };
    const rows = rowsByParty.get(stay.partyKey);
    if (rows) {
      rows.push(row);
    } else {
      order.push(stay.partyKey);
      rowsByParty.set(stay.partyKey, [row]);
    }
  }

  return order.map((partyKey) => {
    const rows = rowsByParty.get(partyKey) ?? [];
    const names: string[] = [];
    for (const row of rows) {
      if (!names.includes(row.person.name)) {
        names.push(row.person.name);
      }
    }
    return { partyKey, rows, memberNames: names };
  });
}

// ============================================================================
// Component
// ============================================================================

/**
 * Shows a suggested allocation for review and applies the version the reader
 * agreed to.
 *
 * @example
 * ```tsx
 * <AllocationSuggestionDialog
 *   open={isReviewing}
 *   onOpenChange={setIsReviewing}
 *   stays={suggestion}
 *   rooms={rooms}
 *   persons={persons}
 *   assignments={assignments}
 *   onApply={applySuggestedStays}
 * />
 * ```
 */
const AllocationSuggestionDialog = memo(function AllocationSuggestionDialog(
  props: AllocationSuggestionDialogProps,
): ReactElement {
  const { open, onOpenChange, stays, rooms, persons, assignments, onApply } = props;

  const { t, i18n } = useTranslation();
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  const [choices, setChoices] = useState<Readonly<Record<string, string>>>({});
  const [isApplying, setIsApplying] = useState(false);

  // The proposal is the starting point of an edit, so it is copied into state
  // when the dialog opens. Render-time sync rather than an effect, as in
  // QuickAssignmentDialog: an effect would render one frame of empty pickers.
  const initKey = open
    ? stays.map((stay) => `${rowKeyOf(stay)}>${stay.roomId ?? NO_ROOM}`).join(',')
    : null;
  const [prevInitKey, setPrevInitKey] = useState<string | null>(null);
  if (initKey !== null && prevInitKey !== initKey) {
    setPrevInitKey(initKey);
    setChoices(
      Object.fromEntries(
        stays.map((stay) => [rowKeyOf(stay), stay.roomId ?? NO_ROOM]),
      ),
    );
    setIsApplying(false);
  }
  if (initKey === null && prevInitKey !== null) {
    setPrevInitKey(null);
  }

  const parties = useMemo(() => buildParties(stays, persons), [stays, persons]);
  const roomById = useMemo(
    () => new Map(rooms.map((room) => [room.id, room])),
    [rooms],
  );

  /**
   * Which rows put a room over its capacity, given the choices as they stand.
   *
   * Counted over the existing bookings plus every chosen row, so a warning
   * names each row that is part of the same overflow rather than only the last
   * one added.
   */
  const overCapacityRowKeys = useMemo(() => {
    const headcountOf = createHeadcountResolver(persons);
    const occupancy = buildNightlyOccupancyByRoom(assignments, headcountOf);
    const rows = parties.flatMap((party) => party.rows);

    for (const row of rows) {
      const roomId = choices[row.key];
      if (!roomId || roomId === NO_ROOM) {
        continue;
      }
      let nightly = occupancy.get(roomId as RoomId);
      if (!nightly) {
        nightly = new Map<string, number>();
        occupancy.set(roomId as RoomId, nightly);
      }
      const headcount = headcountOf(row.person.id);
      for (const night of row.stay.nights) {
        nightly.set(night, (nightly.get(night) ?? 0) + headcount);
      }
    }

    const overflowing = new Set<string>();
    for (const row of rows) {
      const roomId = choices[row.key];
      if (!roomId || roomId === NO_ROOM) {
        continue;
      }
      const room = roomById.get(roomId as RoomId);
      const nightly = occupancy.get(roomId as RoomId);
      if (!room || !nightly) {
        continue;
      }
      if (row.stay.nights.some((night) => (nightly.get(night) ?? 0) > room.capacity)) {
        overflowing.add(row.key);
      }
    }
    return overflowing;
  }, [assignments, choices, parties, persons, roomById]);

  const confirmed = useMemo((): readonly ConfirmedStay[] => {
    const result: ConfirmedStay[] = [];
    for (const party of parties) {
      for (const row of party.rows) {
        const roomId = choices[row.key];
        if (!roomId || roomId === NO_ROOM) {
          continue;
        }
        result.push({
          personId: row.person.id,
          roomId: roomId as RoomId,
          startDate: row.stay.startDate,
          endDate: row.stay.endDate,
        });
      }
    }
    return result;
  }, [choices, parties]);

  const skippedCount = useMemo(
    () => parties.reduce((total, party) => total + party.rows.length, 0) - confirmed.length,
    [confirmed.length, parties],
  );

  const handleRoomChange = useCallback((rowKey: string, value: string) => {
    setChoices((prev) => ({ ...prev, [rowKey]: value }));
  }, []);

  const handleApply = useCallback(async () => {
    if (confirmed.length === 0 || isApplying) {
      return;
    }
    setIsApplying(true);
    try {
      await onApply(confirmed);
      onOpenChange(false);
    } catch {
      // The caller has already said so in a toast. Staying open is the point:
      // whatever did not save is still listed here to try again.
    } finally {
      setIsApplying(false);
    }
  }, [confirmed, isApplying, onApply, onOpenChange]);

  // A write that never settles used to hold this dialog open forever, and a
  // modal makes the page behind it inert — so the rooms page read as frozen
  // rather than as busy. The lock still covers a real save; it no longer
  // outlives one.
  const isApplyStalled = useStalled(isApplying);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (isApplying && !isApplyStalled && !nextOpen) {
        return;
      }
      onOpenChange(nextOpen);
    },
    [isApplying, isApplyStalled, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('rooms.suggest.title')}</DialogTitle>
          <DialogDescription>{t('rooms.suggest.description')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {parties.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t('rooms.suggest.nothingToPlace')}
            </p>
          ) : (
            <ul className="grid gap-4 py-2">
              {parties.map((party) => (
                <li key={party.partyKey} className="grid gap-3">
                  {party.memberNames.length > 1 && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="size-3.5 shrink-0" aria-hidden="true" />
                      {t('rooms.suggest.travelsTogether', {
                        names: party.memberNames.join(', '),
                      })}
                    </p>
                  )}

                  {party.rows.map((row) => {
                    const selectId = `suggested-room-${row.key}`;
                    const value = choices[row.key] ?? NO_ROOM;
                    const isOverCapacity = overCapacityRowKeys.has(row.key);
                    const hasNoRoomOnOffer = row.stay.roomId === null;

                    return (
                      <div
                        key={row.key}
                        className="grid gap-2 rounded-md border p-3 sm:grid-cols-2 sm:items-center"
                      >
                        <div className="grid gap-1">
                          <PersonBadge person={row.person} size="sm" />
                          <span className="text-xs text-muted-foreground">
                            {formatDateRange(
                              row.stay.startDate,
                              row.stay.endDate,
                              dateLocale,
                            )}
                            {' · '}
                            {t('rooms.suggest.nights', {
                              count: row.stay.nights.length,
                            })}
                          </span>
                        </div>

                        <div className="grid gap-1">
                          <Label htmlFor={selectId} className="sr-only">
                            {t('rooms.suggest.roomFor', { name: row.person.name })}
                          </Label>
                          <Select
                            value={value}
                            onValueChange={(next) => handleRoomChange(row.key, next)}
                            disabled={isApplying}
                          >
                            <SelectTrigger
                              id={selectId}
                              className="w-full"
                              aria-label={t('rooms.suggest.roomFor', {
                                name: row.person.name,
                              })}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_ROOM}>
                                {t('rooms.suggest.noRoom')}
                              </SelectItem>
                              {rooms.map((room) => (
                                <SelectItem key={room.id} value={room.id}>
                                  {`${room.name} · ${t('rooms.beds', { count: room.capacity })}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {hasNoRoomOnOffer && value === NO_ROOM && (
                            <span className="text-xs text-muted-foreground">
                              {t('rooms.suggest.nothingFits')}
                            </span>
                          )}
                          {isOverCapacity && (
                            <span
                              className={cn(
                                statusVariants({ tone: 'warning', emphasis: 'text' }),
                                'flex items-center gap-1.5 text-xs',
                              )}
                              role="alert"
                            >
                              <AlertTriangle
                                className="size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              {t('rooms.suggest.overCapacity')}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>

        {skippedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('rooms.suggest.leftOut', { count: skippedCount })}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isApplying}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              void handleApply();
            }}
            disabled={confirmed.length === 0 || isApplying}
          >
            {isApplying && (
              <Loader2
                className="mr-2 size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            {t('rooms.suggest.apply', { count: confirmed.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { AllocationSuggestionDialog };
