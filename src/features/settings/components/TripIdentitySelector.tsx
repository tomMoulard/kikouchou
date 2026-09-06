/**
 * @fileoverview "Which of these guests am I?" — the settings card that answers it.
 *
 * `useTripIdentity` could already *read* an identity from a share link or from
 * the participant an account claimed on joining, but nothing let anybody *say*
 * one — and the trip's own organiser, who never opens their own share link and
 * never joins their own invite, had no identity from any source at all. So the
 * transport filter they were asking for could not be reached from the one
 * device most likely to want it.
 *
 * The card explains itself when the answer came from somewhere else: seeing
 * your name already selected without being told why reads as the app knowing
 * more about you than it does.
 *
 * Clearing the choice clears the *explicit* one only. A device that opened a
 * share link falls back to the name picked there, which is why the select can
 * snap back to a guest after "Not set" — the note above it is what makes that
 * legible rather than a bug.
 *
 * @module features/settings/components/TripIdentitySelector
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { UserCheck } from 'lucide-react';

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
import { useTripIdentity } from '@/hooks';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTripContext } from '@/contexts/TripContext';
import type { PersonId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * The sentinel value of the "nobody" option.
 *
 * Radix refuses an empty string as an item value — it reserves it for "no
 * selection" — so clearing the choice needs a value of its own. A `PersonId` is
 * a nanoid and can never collide with it.
 */
const NOBODY_VALUE = '__nobody__';

// ============================================================================
// Component
// ============================================================================

/**
 * Lets the user say which guest of the current trip they are.
 *
 * The answer is device-local (`AppSettings.myPersonIdByTripId`) and is what the
 * transport views filter by.
 *
 * @returns The identity card
 */
export const TripIdentitySelector = memo(function TripIdentitySelector(): ReactElement {
  const { t } = useTranslation(),
    { currentTrip } = useTripContext(),
    { persons } = usePersonContext(),
    { myPersonId, source, isResolved, setMyPersonId } = useTripIdentity(),
    handleChange = useCallback(
      (value: string): void => {
        const next = value === NOBODY_VALUE ? undefined : (value as PersonId);

        setMyPersonId(next)
          .then(() => {
            // Deliberately a raw toast rather than the offline-aware one: this
            // never leaves the device, so "Saved on this device" is not a
            // caveat here, it is the whole story.
            toast.success(t('identity.saved', 'Saved on this device'));
          })
          .catch((error: unknown) => {
            console.error('Failed to save trip identity:', error);
            toast.error(t('errors.saveFailed', 'Failed to save'));
          });
      },
      [setMyPersonId, t],
    );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <UserCheck className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">
              {t('identity.title', 'Who are you?')}
            </CardTitle>
            <CardDescription>
              {t(
                'identity.description',
                'Pick your name so the app can show your own travel and the people you are driving.',
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {currentTrip === null ? (
          <p className="text-sm text-muted-foreground">
            {t('identity.noTrip', 'Open a trip to say who you are on it.')}
          </p>
        ) : persons.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('identity.noGuests', 'Add a guest to this trip first.')}
          </p>
        ) : (
          <>
            <Select
              value={myPersonId ?? NOBODY_VALUE}
              onValueChange={handleChange}
              disabled={!isResolved}
            >
              <SelectTrigger
                className="w-full sm:w-[280px]"
                aria-label={t('identity.title', 'Who are you?')}
              >
                <SelectValue placeholder={t('identity.nobody', 'Not set')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOBODY_VALUE}>
                  {t('identity.nobody', 'Not set')}
                </SelectItem>
                {persons.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                    {person.id === myPersonId && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('identity.you', 'You')}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {source === 'shareLink' && (
              <p className="text-sm text-muted-foreground">
                {t(
                  'identity.fromShareLink',
                  'Taken from the name you picked when you opened this trip’s share link.',
                )}
              </p>
            )}
            {source === 'account' && (
              <p className="text-sm text-muted-foreground">
                {t(
                  'identity.fromAccount',
                  'Taken from the guest your account claimed when you joined this trip.',
                )}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
});
