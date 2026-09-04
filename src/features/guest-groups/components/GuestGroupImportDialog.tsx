/**
 * @fileoverview Picks a group and which of its people to bring into a trip.
 *
 * Two steps in one dialog: choose the group, tick the people. Everybody is
 * ticked when a group is opened, because "the whole family is coming" is the
 * common case and un-ticking one person is less work than ticking four.
 *
 * The dialog does not write anything. It hands the selection to `onConfirm`,
 * which is what lets the same component serve a trip that already exists (the
 * guest list imports immediately) and one that does not yet (the create form
 * holds the selection until the trip is saved).
 *
 * @module features/guest-groups/components/GuestGroupImportDialog
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { cn } from '@/lib/utils';
import { getPersonHeadcount } from '@/types';
import type { GuestGroup, GuestGroupId, GuestGroupMemberId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** What the user chose. */
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
   * Called with the selection when the user confirms. The dialog closes once
   * this resolves, so a caller that writes can keep it open on failure by
   * rejecting.
   */
  readonly onConfirm: (selection: GuestGroupSelection) => Promise<void> | void;
  /** Label for the confirm button. Defaults to "Add to trip". */
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
 *   onConfirm={({ group, memberIds }) => importMembers(tripId, group.id, memberIds)}
 * />
 * ```
 */
const GuestGroupImportDialog = memo(function GuestGroupImportDialog({
  open,
  onOpenChange,
  onConfirm,
  confirmLabel,
}: GuestGroupImportDialogProps) {
  const { t } = useTranslation();
  const { groups, isLoading } = useGuestGroups();

  const [groupId, setGroupId] = useState<GuestGroupId | null>(null);
  const [selectedIds, setSelectedIds] = useState<readonly GuestGroupMemberId[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const group = useMemo(
    () => groups.find((candidate) => candidate.id === groupId),
    [groupId, groups],
  );

  // Resetting the picker each time it opens, as every dialog here does.
  useEffect(() => {
    if (!open) {
      return;
    }
    // One group is the common case; skipping straight to its people saves a
    // click that has no alternative to offer.
    const only = groups.length === 1 ? groups[0] : undefined;
    setGroupId(only?.id ?? null);
    setSelectedIds(only?.members.map((member) => member.id) ?? []);
    setIsImporting(false);
  }, [open, groups]);

  const handleSelectGroup = useCallback(
    (next: GuestGroup) => {
      setGroupId(next.id);
      setSelectedIds(next.members.map((member) => member.id));
    },
    [],
  );

  const handleToggleMember = useCallback((memberId: GuestGroupMemberId) => {
    setSelectedIds((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId],
    );
  }, []);

  const handleToggleAll = useCallback(() => {
    if (!group) {
      return;
    }
    setSelectedIds((prev) =>
      prev.length === group.members.length ? [] : group.members.map((member) => member.id),
    );
  }, [group]);

  const handleBack = useCallback(() => {
    setGroupId(null);
    setSelectedIds([]);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!group || selectedIds.length === 0 || isImporting) {
      return;
    }

    setIsImporting(true);
    try {
      // Send them in the group's own order rather than tick order, so the
      // guests land in the order the user arranged the group.
      const ordered = group.members
        .map((member) => member.id)
        .filter((id) => selectedIds.includes(id));

      await onConfirm({ group, memberIds: ordered });
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
  }, [group, isImporting, onConfirm, onOpenChange, selectedIds]);

  // ============================================================================
  // Render
  // ============================================================================

  /** People, not rows: a member standing for a couple counts twice. */
  const selectedHeadcount = useMemo(() => {
    if (!group) {
      return 0;
    }
    return group.members
      .filter((member) => selectedIds.includes(member.id))
      .reduce((total, member) => total + getPersonHeadcount(member), 0);
  }, [group, selectedIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('guestGroups.importTitle', 'Add from a group')}</DialogTitle>
          <DialogDescription>
            {group
              ? t(
                  'guestGroups.importPickPeople',
                  'Choose who is coming. They are copied into this trip as guests.',
                )
              : t('guestGroups.importPickGroup', 'Choose a group.')}
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

        {!group && groups.length > 0 && (
          <ul className="space-y-2">
            {groups.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => handleSelectGroup(candidate)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left',
                    'hover:bg-accent/60 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <span className="font-medium">{candidate.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t('guestGroups.memberCount', '{{count}} people', {
                      count: candidate.members.length,
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {group && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{group.name}</p>
              <Button type="button" variant="ghost" size="sm" onClick={handleToggleAll}>
                {selectedIds.length === group.members.length
                  ? t('guestGroups.selectNone', 'Clear all')
                  : t('guestGroups.selectAll', 'Select all')}
              </Button>
            </div>

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
                      <Label htmlFor={inputId} className="flex-1 cursor-pointer font-normal">
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

            {group.members.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t('guestGroups.membersEmpty', 'Nobody yet. Add the people you invite together.')}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {group && groups.length > 1 && (
            <Button type="button" variant="ghost" onClick={handleBack} disabled={isImporting}>
              {t('guestGroups.chooseAnother', 'Another group')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isImporting}
          >
            {t('common.cancel')}
          </Button>
          {group && (
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={selectedIds.length === 0 || isImporting}
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
