/**
 * @fileoverview The accounts on a shared trip, under its invite link.
 *
 * Everyone on the trip sees who else is on it. The organiser also gets a
 * Remove button beside each other person: the person loses the trip, and the
 * live invite links are withdrawn so they cannot rejoin, which is why the
 * dialog then shows a fresh link.
 *
 * @module features/sharing/components/TripMembersPanel
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserMinus, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { notify } from '@/lib/notifications';
import { type TripMemberEntry, useTripMembers } from '../hooks/useTripMembers';
import type { TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface TripMembersPanelProps {
  readonly tripId: TripId | null;
  /** False while the dialog is closed or before the trip has a link. */
  readonly active: boolean;
  /** Told after a removal, which withdrew the link on screen. */
  readonly onMemberRemoved?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const TripMembersPanel = memo(function TripMembersPanel({
  tripId,
  active,
  onMemberRemoved,
}: TripMembersPanelProps): ReactElement | null {
  const { t } = useTranslation();
  const { state, remove } = useTripMembers(tripId, active);
  const [pending, setPending] = useState<TripMemberEntry | null>(null);

  const label = useCallback(
    (member: TripMemberEntry): string => {
      const name = member.name ?? t('sharing.members.unnamed', 'Someone who has not picked a name yet');
      if (member.isSelf) return t('sharing.members.you', { name, defaultValue: '{{name}} (you)' });
      if (member.isOwner) return t('sharing.members.organiser', { name, defaultValue: '{{name}} (organiser)' });
      return name;
    },
    [t],
  );

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    const result = await remove(pending.userId);
    if (result.status === 'removed') {
      notify.success(t('sharing.members.removed', 'Removed from the trip'));
      onMemberRemoved?.();
    } else if (result.status === 'not-owner') {
      notify.error(t('sharing.members.notOwner', 'Only the organiser can remove someone.'));
    } else {
      console.error('Failed to remove trip member:', result.message);
      notify.error(t('sharing.members.removeFailed', 'Could not remove this person. Try again.'));
    }
    setPending(null);
  }, [onMemberRemoved, pending, remove, t]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setPending(null);
  }, []);

  if (state.kind === 'hidden' || state.kind === 'loading') {
    return null;
  }

  if (state.kind === 'error') {
    return (
      <p className="text-sm text-muted-foreground" role="alert">
        {t('sharing.members.loadFailed', 'Could not load who is on this trip.')}
      </p>
    );
  }

  return (
    <section className="space-y-2" aria-labelledby="trip-members-title" data-testid="trip-members">
      <h3 id="trip-members-title" className="flex items-center gap-2 font-display text-sm font-semibold">
        <Users className="size-4 text-muted-foreground" aria-hidden="true" />
        {t('sharing.members.title', 'People on this trip')}
      </h3>
      <ul className="divide-y divide-border rounded-lg border">
        {state.members.map((member) => (
          <li key={member.userId} className="flex min-h-11 items-center justify-between gap-2 px-3 py-1.5">
            <span className="min-w-0 truncate text-sm">{label(member)}</span>
            {state.canRemove && !member.isOwner ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-destructive"
                onClick={() => setPending(member)}
              >
                <UserMinus className="size-4" aria-hidden="true" />
                {t('sharing.members.remove', 'Remove')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {state.canRemove ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'sharing.members.removeHint',
            'Removing someone also withdraws the current link, so they cannot come back with it. Send the new link to the others who have not joined yet.',
          )}
        </p>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={handleOpenChange}
        variant="destructive"
        title={t('sharing.members.confirmTitle', {
          name: pending ? (pending.name ?? t('sharing.members.unnamedShort', 'this person')) : '',
          defaultValue: 'Remove {{name}}?',
        })}
        description={t(
          'sharing.members.confirmDescription',
          'They will no longer see or edit this trip, and the current invite link stops working. The copy already on their phone stays there.',
        )}
        confirmLabel={t('sharing.members.remove', 'Remove')}
        onConfirm={handleConfirm}
      />
    </section>
  );
});
