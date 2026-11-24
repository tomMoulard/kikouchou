/**
 * @fileoverview Who was invited to an activity, who said no, and inviting more.
 *
 * Shown in the activity's detail dialog under who is coming. "Invite" opens a
 * checklist of the guests who are neither in nor already asked; sending it
 * writes the invitation (`useActivityInvitations`), which tells their devices
 * at once and asks them when they next open the trip.
 *
 * @module features/activities/components/ActivityInvitations
 */

import { type ReactElement, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, UserPlus, UserX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import { PersonBadge } from '@/components/shared/PersonBadge';

import type { Activity, ActivityId, Person, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for {@link ActivityInvitations}. */
export interface ActivityInvitationsProps {
  /** The activity. */
  readonly activity: Activity;
  /** Every guest of the trip. */
  readonly guests: readonly Person[];
  /** Sends the invitations; absent where this device cannot write. */
  readonly onInvite?: (activityId: ActivityId, personIds: readonly PersonId[]) => Promise<number>;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The invited and declined guests, and the invite checklist.
 *
 * @param props - See {@link ActivityInvitationsProps}
 * @returns The section, or nothing when there is nobody to show or invite
 */
export const ActivityInvitations = memo(function ActivityInvitations({
  activity,
  guests,
  onInvite,
}: ActivityInvitationsProps): ReactElement | null {
  const { t } = useTranslation();
  const [isPicking, setIsPicking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<PersonId>>(new Set());
  const [isSending, setIsSending] = useState(false);

  const byId = useMemo(() => new Map(guests.map((guest) => [guest.id, guest])), [guests]);
  const resolve = useCallback(
    (ids: readonly PersonId[] | undefined): Person[] =>
      (ids ?? []).map((id) => byId.get(id)).filter((guest): guest is Person => guest !== undefined),
    [byId],
  );
  const invited = resolve(activity.invitedIds);
  const declined = resolve(activity.declinedIds);

  // A guest who said no can be asked again; one already in or asked cannot.
  const candidates = useMemo(() => {
    const taken = new Set([...(activity.participantIds ?? []), ...(activity.invitedIds ?? [])]);
    return guests.filter((guest) => !taken.has(guest.id));
  }, [activity.invitedIds, activity.participantIds, guests]);

  const toggle = useCallback((personId: PersonId, checked: boolean) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(personId);
      } else {
        next.delete(personId);
      }
      return next;
    });
  }, []);

  const send = useCallback(async () => {
    if (!onInvite || picked.size === 0) {
      return;
    }
    setIsSending(true);
    const sent = await onInvite(activity.id, [...picked]);
    setIsSending(false);
    if (sent > 0) {
      setPicked(new Set());
      setIsPicking(false);
    }
  }, [activity.id, onInvite, picked]);

  const canInvite = onInvite !== undefined && candidates.length > 0;
  if (invited.length === 0 && declined.length === 0 && !canInvite) {
    return null;
  }

  return (
    <div className="space-y-2">
      {invited.length > 0 && (
        <div className="flex items-start gap-3">
          <Mail className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm text-muted-foreground">
              {t('activities.invite.invitedList', 'Invited, no answer yet')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {invited.map((guest) => (
                <PersonBadge key={guest.id} person={guest} size="sm" />
              ))}
            </div>
          </div>
        </div>
      )}

      {declined.length > 0 && (
        <div className="flex items-start gap-3">
          <UserX className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm text-muted-foreground">
              {t('activities.invite.declinedList', "Can't come")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {declined.map((guest) => (
                <PersonBadge key={guest.id} person={guest} size="sm" />
              ))}
            </div>
          </div>
        </div>
      )}

      {canInvite && !isPicking && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full md:h-8"
          onClick={() => setIsPicking(true)}
        >
          <UserPlus className="mr-2 size-4" aria-hidden="true" />
          {t('activities.invite.button', 'Invite guests')}
        </Button>
      )}

      {canInvite && isPicking && (
        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">
            {t('activities.invite.pickTitle', 'Who do you want to invite?')}
          </legend>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {candidates.map((guest) => {
              const id = `invite-${activity.id}-${guest.id}`;
              return (
                <li key={guest.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={picked.has(guest.id)}
                    onCheckedChange={(checked) => toggle(guest.id, checked === true)}
                    disabled={isSending}
                  />
                  <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer py-1.5 font-normal">
                    <PersonBadge person={guest} size="sm" />
                  </Label>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setIsPicking(false);
                setPicked(new Set());
              }}
              disabled={isSending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => void send()}
              disabled={isSending || picked.size === 0}
            >
              {t('activities.invite.send', { count: picked.size, defaultValue_one: 'Invite {{count}}', defaultValue_other: 'Invite {{count}}' })}
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  );
});
