/**
 * @fileoverview Picks people from saved groups to bring into a trip.
 *
 * One flat list, every group on it, ticks across as many as the user likes: a
 * trip is regularly two families and a couple of friends, and a picker that
 * holds one group at a time turns that into three trips through the same
 * dialog — or, worse, silently replaces the first choice with the second.
 *
 * Everybody is ticked when there is exactly one group, because "the whole
 * family is coming" is then the only reasonable default and un-ticking one
 * person beats ticking four. With several groups nothing is ticked: pre-ticking
 * three families so the user can un-tick two of them is not a default, it is a
 * chore.
 *
 * The dialog writes nothing. It hands the selections to `onConfirm`, which is
 * what lets the same component serve a trip that already exists (the guest list
 * imports immediately) and one that does not yet (the create form holds the
 * selections until the trip is saved).
 *
 * @module features/guest-groups/components/GuestGroupImportDialog
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/shared/EmptyState';
import { useGuestGroups } from '@/features/guest-groups/hooks/useGuestGroups';
import { getPersonHeadcount } from '@/types';
import type { GuestGroup, GuestGroupMemberId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** One group, and which of its people were ticked. */
export interface GuestGroupSelection {
  readonly group: GuestGroup;
  readonly memberIds: readonly GuestGroupMemberId[];
}

export interface GuestGroupImportDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Called with one entry per group that has at least one person ticked. The
   * dialog closes once this resolves, so a caller that writes can keep it open
   * on failure by rejecting.
   */
  readonly onConfirm: (
    selections: readonly GuestGroupSelection[],
  ) => Promise<void> | void;
  /**
   * Selections to open with, for a caller that is *editing* a queue rather than
   * adding to one — the create-trip form, whose groups are not imported yet.
   *
   * Without it, reopening the picker to add a second family would show the
   * first one un-ticked, and confirming would drop it.
   */
  readonly initialSelection?: readonly GuestGroupSelection[];
  /** Label for the confirm button. Defaults to "Add N people". */
  readonly confirmLabel?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Group and member picker.
 *
 * @param props - Component props
 * @returns The dialog element
 *
 * @example
 * ```tsx
 * <GuestGroupImportDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   onConfirm={(selections) =>
 *     Promise.all(selections.map((s) => importMembers(tripId, s.group.id, s.memberIds)))
 *   }
 * />
 * ```
 */
const GuestGroupImportDialog = memo(function GuestGroupImportDialog({
  open,
  onOpenChange,
  onConfirm,
  initialSelection,
  confirmLabel,
}: GuestGroupImportDialogProps) {
  const { t } = useTranslation();
  const { groups, isLoading } = useGuestGroups();

  /**
   * Ticked member ids, flat across every group.
   *
   * Flat because member ids are nanoids and therefore unique across groups, so
   * a per-group map would buy nothing and cost a second lookup at every read.
   */
  const [selectedIds, setSelectedIds] = useState<readonly GuestGroupMemberId[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  /**
   * Whether this opening has been initialised.
   *
   * The set-up cannot simply depend on `groups`: that array is a fresh identity
   * on **every** Dexie emission, and re-running it on one throws away the ticks
   * the user has just made. A sync writing `remoteGroupId` back onto a group, or
   * an edit in another tab, is enough to do it — and it did, in a loaded test
   * run, where a de-selected member came back before confirm.
   */
  const isInitialisedRef = useRef(false);

  // Set up each time the picker opens. `groups` stays in the deps so an opening
  // that beat the first Dexie read still initialises when the rows arrive — but
  // the ref makes that a one-shot rather than a reset on every emission.
  useEffect(() => {
    if (!open || isInitialisedRef.current || groups.length === 0) {
      return;
    }

    isInitialisedRef.current = true;

    if (initialSelection && initialSelection.length > 0) {
      setSelectedIds(initialSelection.flatMap((entry) => entry.memberIds));
      return;
    }

    // One group: everybody. Several: nobody — see the module docblock.
    const only = groups.length === 1 ? groups[0] : undefined;
    setSelectedIds(only?.members.map((member) => member.id) ?? []);
  }, [open, groups, initialSelection]);

  // Clear on close, so reopening does not flash the last selection.
  useEffect(() => {
    if (open) {
      return;
    }
    isInitialisedRef.current = false;
    setSelectedIds([]);
    setIsImporting(false);
  }, [open]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleToggleMember = useCallback((memberId: GuestGroupMemberId) => {
    setSelectedIds((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId],
    );
  }, []);

  /** Ticks or clears one group without touching the others. */
  const handleToggleGroup = useCallback((group: GuestGroup) => {
    setSelectedIds((prev) => {
      const ids = group.members.map((member) => member.id),
        isFullySelected = ids.every((id) => prev.includes(id)),
        without = prev.filter((id) => !ids.includes(id));

      return isFullySelected ? without : [...without, ...ids];
    });
  }, []);

  /**
   * The ticks, as one entry per group that has any.
   *
   * Member ids come back in the group's own order rather than tick order, so
   * the guests land in the order the user arranged the group.
   */
  const selections = useMemo((): readonly GuestGroupSelection[] => {
    const result: GuestGroupSelection[] = [];

    for (const group of groups) {
      const memberIds = group.members
        .map((member) => member.id)
        .filter((id) => selectedIds.includes(id));

      if (memberIds.length > 0) {
        result.push({ group, memberIds });
      }
    }

    return result;
  }, [groups, selectedIds]);

  const handleConfirm = useCallback(async () => {
    if (selections.length === 0 || isImporting) {
      return;
    }

    setIsImporting(true);
    try {
      await onConfirm(selections);
      onOpenChange(false);
    } catch (error) {
      // Caught rather than propagated: `onConfirm` rejecting is how a caller
      // says "that did not work, keep the dialog open", and it has already told
      // the user why. Letting it through would leave the click handler with an
      // unhandled rejection and no one better placed to report it.
      console.error('Failed to import a guest group:', error);
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, onConfirm, onOpenChange, selections]);

  // ============================================================================
  // Render
  // ============================================================================

  /** People, not rows: a member standing for a couple counts twice. */
  const selectedHeadcount = useMemo(
    () =>
      selections.reduce(
        (total, selection) =>
          total +
          selection.group.members
            .filter((member) => selection.memberIds.includes(member.id))
            .reduce((groupTotal, member) => groupTotal + getPersonHeadcount(member), 0),
        0,
      ),
    [selections],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('guestGroups.importTitle', 'Add from a group')}</DialogTitle>
          <DialogDescription>
            {t(
              'guestGroups.importPickPeople',
              'Choose who is coming, from as many groups as you like. They are copied into this trip as guests.',
            )}
          </DialogDescription>
        </DialogHeader>

        {!isLoading && groups.length === 0 && (
          <EmptyState
            icon={Users}
            title={t('guestGroups.emptyTitle', 'No groups yet')}
            description={t(
              'guestGroups.emptyImportDescription',
              'Create a group of people you invite together, and add them to a trip in one go.',
            )}
          />
        )}

        {groups.map((group) => {
          const memberIds = group.members.map((member) => member.id),
            selectedCount = memberIds.filter((id) => selectedIds.includes(id)).length,
            isFullySelected =
              memberIds.length > 0 && selectedCount === memberIds.length;

          return (
            <section key={group.id} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{group.name}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleGroup(group)}
                  disabled={isImporting || group.members.length === 0}
                >
                  {isFullySelected
                    ? t('guestGroups.selectNone', 'Clear all')
                    : t('guestGroups.selectAll', 'Select all')}
                </Button>
              </div>

              {group.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'guestGroups.membersEmpty',
                    'Nobody yet. Add the people you invite together.',
                  )}
                </p>
              ) : (
                <ul className="space-y-1">
                  {group.members.map((member) => {
                    const inputId = `import-member-${member.id}`,
                      headcount = getPersonHeadcount(member);

                    return (
                      <li key={member.id}>
                        <div className="flex items-center gap-3 rounded-md p-2 hover:bg-accent/40">
                          <Checkbox
                            id={inputId}
                            checked={selectedIds.includes(member.id)}
                            onCheckedChange={() => handleToggleMember(member.id)}
                            disabled={isImporting}
                          />
                          <span
                            className="size-3 shrink-0 rounded-full border"
                            style={{ backgroundColor: member.color }}
                            aria-hidden="true"
                          />
                          <Label
                            htmlFor={inputId}
                            className="flex-1 cursor-pointer font-normal"
                          >
                            {member.name}
                            {headcount > 1 && (
                              <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                                {t('persons.headcountBadge', '{{count}} people', {
                                  count: headcount,
                                })}
                              </span>
                            )}
                          </Label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isImporting}
          >
            {t('common.cancel')}
          </Button>
          {groups.length > 0 && (
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={selections.length === 0 || isImporting}
              aria-busy={isImporting}
            >
              {confirmLabel ??
                t('guestGroups.importConfirm', 'Add {{count}} people', {
                  count: selectedHeadcount,
                })}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { GuestGroupImportDialog };
