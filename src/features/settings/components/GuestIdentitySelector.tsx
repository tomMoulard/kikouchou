/**
 * @fileoverview "Which guest am I?" card for the settings page.
 *
 * The share-link wizard asks this once, on the way in, and stores the answer
 * under the trip's share key. Until now nothing could show it back or change
 * it: somebody who tapped the wrong name, or who opened the trip from the
 * trips list instead of the link, was stuck — and a wrong answer is not
 * cosmetic, it decides whose sign-ups the agenda offers to toggle.
 *
 * The choice is per browser and per trip, exactly like the wizard's, and it is
 * written through the same `lib/sharing/guest-identity` helpers rather than a
 * seventh hand-rolled `kikouchou_guest_` key.
 *
 * @module features/settings/components/GuestIdentitySelector
 */

import { type ReactElement, memo, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingState } from '@/components/shared/LoadingState';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTripContext } from '@/contexts/TripContext';
import {
  clearGuestIdentity,
  getTripGuestPersonId,
  writeGuestIdentity,
} from '@/lib/sharing/guest-identity';
import type { PersonId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Value of the "nobody in particular" option.
 *
 * Radix rejects an empty-string `SelectItem` value — it reserves it for "no
 * selection" — so the absence of an identity needs a sentinel of its own. It
 * never reaches storage: `handleChange` turns it into a `clearGuestIdentity`.
 */
const NO_IDENTITY_VALUE = '__none__';

// ============================================================================
// Component
// ============================================================================

/**
 * Lets the user see and change which guest this browser is on the current trip.
 *
 * States, in the order they are decided:
 * - no trip selected — nothing to be a guest of
 * - guests still loading from IndexedDB
 * - the trip has no guests yet — offer the guest list rather than an empty menu
 * - the picker, plus a badge naming who this browser currently is
 *
 * @returns The guest identity card
 */
export const GuestIdentitySelector = memo(function GuestIdentitySelector(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentTrip } = useTripContext();
  const { persons, isLoading } = usePersonContext();

  const [personId, setPersonId] = useState<PersonId | undefined>(() =>
    getTripGuestPersonId(currentTrip),
  );

  // Re-read when the selected trip changes: the identity is stored per share
  // key, so carrying the previous trip's answer over would name a guest of a
  // different trip entirely.
  useEffect(() => {
    setPersonId(getTripGuestPersonId(currentTrip));
  }, [currentTrip]);

  const selectedPerson = persons.find((person) => person.id === personId);

  const handleChange = useCallback(
    (value: string): void => {
      if (!currentTrip) {
        return;
      }

      if (value === NO_IDENTITY_VALUE) {
        if (!clearGuestIdentity(currentTrip.shareId)) {
          toast.error(
            t(
              'sharing.identityStorageFailed',
              'Could not save your identity. You may need to re-select on your next visit.',
            ),
          );
          return;
        }
        setPersonId(undefined);
        // Deliberately a raw toast rather than the offline-aware one: this
        // lives in localStorage and never syncs, so "Saved on this device" is
        // the only thing it could ever mean. Same call as the language card's.
        toast.success(t('settings.guestIdentityCleared', 'You are nobody in particular now'));
        return;
      }

      const person = persons.find((candidate) => candidate.id === value);
      if (!person) {
        return;
      }

      if (
        !writeGuestIdentity(currentTrip.shareId, {
          personId: person.id,
          tripId: currentTrip.id,
        })
      ) {
        toast.error(
          t(
            'sharing.identityStorageFailed',
            'Could not save your identity. You may need to re-select on your next visit.',
          ),
        );
        return;
      }

      setPersonId(person.id);
      toast.success(
        t('settings.guestIdentityChanged', 'You are {{name}} on this trip', {
          name: person.name,
        }),
      );
    },
    [currentTrip, persons, t],
  );

  const handleOpenGuests = useCallback((): void => {
    if (currentTrip) {
      navigate(`/trips/${currentTrip.id}/persons`);
    }
  }, [currentTrip, navigate]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <UserCheck className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">{t('settings.guestIdentity', 'Who you are')}</CardTitle>
            <CardDescription>
              {t(
                'settings.guestIdentityDescription',
                'Which guest this browser is, on the current trip',
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!currentTrip ? (
          <p className="text-sm text-muted-foreground">
            {t('settings.guestIdentityNoTrip', 'Open a trip to say which guest you are.')}
          </p>
        ) : isLoading ? (
          <div className="flex justify-center py-2">
            <LoadingState
              variant="inline"
              label={t('settings.guestIdentityLoading', 'Loading guests…')}
            />
          </div>
        ) : persons.length === 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {t(
                'settings.guestIdentityNoGuests',
                'This trip has no guests yet. Add yourself to the guest list first.',
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenGuests}
              className="w-full sm:w-auto"
              data-testid="guest-identity-open-guests"
            >
              {t('settings.guestIdentityOpenGuests', 'Open guests')}
            </Button>
          </div>
        ) : (
          <>
            <Select
              value={selectedPerson ? selectedPerson.id : NO_IDENTITY_VALUE}
              onValueChange={handleChange}
            >
              <SelectTrigger
                className="w-full sm:w-[240px]"
                aria-label={t('settings.guestIdentity', 'Who you are')}
                // The app defaults to French, so an e2e locator built from the
                // accessible name would pass or fail by locale.
                data-testid="guest-identity-select"
              >
                <SelectValue placeholder={t('settings.guestIdentityNone', 'Nobody in particular')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_IDENTITY_VALUE} data-testid="guest-identity-none">
                  {t('settings.guestIdentityNone', 'Nobody in particular')}
                </SelectItem>
                {persons.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* A stored identity naming a guest who has since been removed
                reads back fine but resolves to nobody, and the picker above
                would silently sit on "Nobody in particular" as though that had
                always been the answer. Say so instead. */}
            {personId !== undefined && !selectedPerson && (
              <p className="text-sm text-muted-foreground">
                {t(
                  'settings.guestIdentityMissing',
                  'The guest you picked is no longer on this trip. Choose again.',
                )}
              </p>
            )}

            {selectedPerson && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                {t('settings.guestIdentityCurrent', 'On this trip you are')}
                <PersonBadge person={selectedPerson} size="sm" />
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              {t(
                'settings.guestIdentityHint',
                'Kept on this device only. It decides whose sign-ups and travel the trip pages offer to change.',
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
});
