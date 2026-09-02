/**
 * @fileoverview The screen an invite link lands on.
 *
 * Four things happen here, in order, and each has to be visible because any of
 * them can take a moment or fail: sign in, redeem the invite, download the trip,
 * then say which participant you are.
 *
 * The last step is the one that makes a shared trip legible — without it the
 * app knows an account joined but not *who* that is, so it cannot tell you whose
 * room assignment or train you are looking at.
 *
 * @module features/sharing/pages/JoinTripPage
 */

import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { useTripContext } from '@/contexts/TripContext';
import posthog from '@/lib/posthog';
import { db } from '@/lib/db/database';
import { useAuth } from '@/features/auth/AuthContext';
import { SignInDialog } from '@/features/auth/components/SignInDialog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { claimParticipant, fetchClaimedParticipants } from '@/lib/sync/join-trip';
import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import { useJoinTrip } from '../hooks/useJoinTrip';
import type { PersonId, TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * How long to keep waiting for participants before saying there are none.
 *
 * Long enough to cover a slow first pull, short enough that nobody concludes the
 * app is broken. Only reached when sync never reports itself settled.
 */
const EMPTY_TRIP_GRACE_MS = 15_000;

// ============================================================================
// Shell
// ============================================================================

/** One centred card, so every phase of the flow looks like the same screen. */
function JoinShell({ children }: { readonly children: ReactElement }): ReactElement {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">{children}</CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Identity step
// ============================================================================

interface IdentityStepProps {
  readonly tripId: TripId;
  readonly remoteTripId: string;
}

/**
 * "Which of these people are you?"
 *
 * The list comes from the document, so it is empty until the log has downloaded
 * — that wait is shown rather than hidden, because on a slow connection an empty
 * list would otherwise look like a trip with nobody in it.
 */
function IdentityStep({ tripId, remoteTripId }: IdentityStepProps): ReactElement {
  const { state: syncState } = useSyncStatus();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  /**
   * The participants of the trip this step was told about.
   *
   * Read for `tripId` directly rather than from `PersonContext`, which is scoped
   * to whichever trip is *currently selected*. During the join transition that
   * is still the trip the invitee had open before following the link, so the
   * step offered the wrong trip's people — and claiming one of them wrote a
   * person id from another trip into this trip's roster, which
   * `unique (trip_id, person_id)` cannot catch because the trip differs.
   *
   * The prop was already here and already correct; it was simply not the thing
   * being read. When the selection happened to be a trip with nobody in it, the
   * same bug presented as "no participants to choose from" instead.
   */
  const personsQuery = useLiveQuery(
    () => db.persons.where('tripId').equals(tripId).toArray(),
    [tripId],
  );
  // Memoised rather than `?? []` inline: a fresh array on every render defeats
  // the `available` memo below, which is the only reason that memo exists.
  const persons = useMemo(() => personsQuery ?? [], [personsQuery]);

  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [claiming, setClaiming] = useState<PersonId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    void (async () => {
      const client = await getSupabaseClient();
      if (!client || cancelled) {
        return;
      }
      const taken = await fetchClaimedParticipants(client, remoteTripId, user.id);
      if (!cancelled) {
        setClaimed(taken);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remoteTripId, user]);

  const available = useMemo(
    () => persons.filter((person) => !claimed.has(person.id)),
    [claimed, persons],
  );

  const handleClaim = useCallback(
    async (personId: PersonId): Promise<void> => {
      if (!user) {
        return;
      }
      setClaiming(personId);
      setError(null);

      const client = await getSupabaseClient();
      if (!client) {
        setClaiming(null);
        return;
      }

      const result = await claimParticipant(client, remoteTripId, user.id, personId);
      setClaiming(null);

      if (result.status === 'taken') {
        posthog?.capture('trip_identity_claim_failed', { reason: 'taken' });
        // Somebody claimed this person between the list loading and the tap.
        setClaimed((current) => new Set(current).add(personId));
        setError(t('sharing.join.identityTaken', 'Somebody else just took that name.'));
        return;
      }
      if (result.status === 'not-a-member') {
        posthog?.capture('trip_identity_claim_failed', { reason: 'not-a-member' });
        // The server has no roster row for this account, so nothing was
        // recorded. Navigating anyway would leave the participant looking free
        // to whoever joins next.
        setError(
          t(
            'sharing.join.notOnRoster',
            'Your invitation has not been accepted yet. Open the invite link again.',
          ),
        );
        return;
      }
      if (result.status === 'error') {
        setError(result.message ?? t('errors.generic', 'Something went wrong'));
        return;
      }

      posthog?.capture('trip_identity_claimed');

      // Only on a confirmed claim.
      void navigate(`/trips/${tripId}/calendar`);
    },
    [navigate, remoteTripId, t, tripId, user],
  );

  const skip = useCallback(() => {
    // Distinguished from claiming, because somebody entering a trip as nobody in
    // particular will not see their own room or travel — a quiet drop-off worth
    // measuring rather than guessing at.
    posthog?.capture('trip_identity_skipped');
    void navigate(`/trips/${tripId}/calendar`);
  }, [navigate, tripId]);

  /**
   * Whether the document might still be arriving.
   *
   * `syncing` and `local` both mean "no answer yet" — the second because the
   * provider may not have mounted for this trip at the moment of render. Anything
   * else is settled: whatever the trip contains, it has arrived.
   */
  const settled = syncState.status === 'synced' || syncState.status === 'offline';

  /**
   * A hard bound on the wait, independent of what sync reports.
   *
   * The reason this exists rather than trusting `settled`: the screen must reach
   * an end. Three separate bugs in this flow have been a spinner with no terminal
   * state, and one of them was reported by a user whose trip had already
   * downloaded in full and simply had no guests in it. If sync never says it is
   * settled, that is a reason to stop waiting, not to wait forever.
   */
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setWaitedLongEnough(true);
    }, EMPTY_TRIP_GRACE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  if (persons.length === 0) {
    if (!settled && !waitedLongEnough) {
      return (
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <CardTitle className="text-lg">
            {t('sharing.join.downloading', 'Getting the trip…')}
          </CardTitle>
          <CardDescription>
            {t(
              'sharing.join.downloadingHint',
              "You're in. Fetching who's coming and where they're sleeping.",
            )}
          </CardDescription>
        </div>
      );
    }

    // Nothing to pick. Deliberately does not claim the *trip* is empty: this
    // device cannot tell "nobody has been added" from "nobody has reached me
    // yet", and asserting the first reads as a confident falsehood to anyone
    // sharing a trip that plainly has people on it.
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <UserRound className="size-6 text-muted-foreground" aria-hidden="true" />
        <CardTitle className="text-lg">
          {t('sharing.join.noParticipants', 'No participants to choose from')}
        </CardTitle>
        <CardDescription>
          {t(
            'sharing.join.noParticipantsHint',
            "Either nobody has been added to this trip yet, or their details haven't reached this device. You can open the trip and carry on.",
          )}
        </CardDescription>
        <Button onClick={skip}>{t('sharing.join.openTrip', 'Open the trip')}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <CardTitle className="text-lg">
          {t('sharing.join.whoAreYou', 'Which one are you?')}
        </CardTitle>
        <CardDescription>
          {t(
            'sharing.join.whoAreYouHint',
            'So the trip can show your room and your travel, not just everyone else’s.',
          )}
        </CardDescription>
      </div>

      {error !== null ? (
        <div
          className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {available.map((person) => (
          <li key={person.id}>
            <Button
              variant="outline"
              className="h-auto w-full justify-start py-3"
              onClick={() => void handleClaim(person.id)}
              disabled={claiming !== null}
            >
              {claiming === person.id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <PersonBadge person={person} size="sm" />
              )}
              <span className="ml-1">{person.name}</span>
            </Button>
          </li>
        ))}
      </ul>

      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'sharing.join.allTaken',
            'Everyone on the list is already claimed. Carry on without picking one — you can still see and edit the trip.',
          )}
        </p>
      ) : null}

      <Button variant="ghost" onClick={skip}>
        {t('sharing.join.notListed', "I'm not on the list")}
      </Button>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export function JoinTripPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const { setCurrentTrip, trips } = useTripContext();

  const { phase, retry } = useJoinTrip(token ?? null);
  const [signInOpen, setSignInOpen] = useState(false);

  // Selecting the trip is what mounts the sync provider, which is what fills the
  // participant list the identity step needs.
  useEffect(() => {
    if (phase.kind === 'joined') {
      void setCurrentTrip(phase.kind === 'joined' ? phase.tripId : null);
    }
  }, [phase, setCurrentTrip]);

  const joinedTrip = useMemo(
    () =>
      phase.kind === 'joined'
        ? trips.find((candidate) => candidate.id === phase.tripId)
        : undefined,
    [phase, trips],
  );

  if (phase.kind === 'needs-account') {
    return (
      <JoinShell>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <UserRound className="size-6 text-primary" aria-hidden="true" />
            </div>
            <CardTitle className="text-lg">
              {t('sharing.join.title', "You've been invited to a trip")}
            </CardTitle>
            <CardDescription>
              {t(
                'sharing.join.needsAccount',
                'Create an account so the others can see your room and your travel times.',
              )}
            </CardDescription>
          </div>
          <Button onClick={() => setSignInOpen(true)}>
            {t('auth.account.signInAction', 'Sign in')}
          </Button>
          <SignInDialog
            open={signInOpen}
            onOpenChange={setSignInOpen}
            reason={t(
              'sharing.join.signInReason',
              'Sign in to join this trip and edit it with the others.',
            )}
          />
        </div>
      </JoinShell>
    );
  }

  if (phase.kind === 'joining') {
    return (
      <JoinShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-lg">
            {t('sharing.join.joining', 'Joining the trip…')}
          </CardTitle>
        </div>
      </JoinShell>
    );
  }

  if (phase.kind === 'rejected') {
    // Each reason gets its own line: "this link expired" and "this link was
    // withdrawn" call for different responses from the person holding it.
    const messages: Record<typeof phase.reason, string> = {
      'not-found': t('sharing.join.notFound', "This invite link isn't valid."),
      revoked: t('sharing.join.revoked', 'This invite link has been withdrawn.'),
      expired: t('sharing.join.expired', 'This invite link has expired.'),
      exhausted: t('sharing.join.exhausted', 'This invite link has been used up.'),
    };

    return (
      <JoinShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <AlertTriangle className="size-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">{messages[phase.reason]}</CardTitle>
          <CardDescription>
            {t('sharing.join.askAgain', 'Ask whoever invited you for a fresh link.')}
          </CardDescription>
          <Button variant="outline" onClick={() => void navigate('/trips')}>
            {t('trips.title', 'My trips')}
          </Button>
        </div>
      </JoinShell>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <JoinShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">
            {t('sharing.join.failed', "Couldn't join the trip")}
          </CardTitle>
          <CardDescription>{phase.message}</CardDescription>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void navigate('/trips')}>
              {t('trips.title', 'My trips')}
            </Button>
            <Button onClick={retry}>{t('common.retry', 'Retry')}</Button>
          </div>
        </div>
      </JoinShell>
    );
  }

  return (
    <JoinShell>
      {joinedTrip?.remoteTripId ? (
        <IdentityStep tripId={phase.tripId} remoteTripId={joinedTrip.remoteTripId} />
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          <Check className="size-6 text-primary" aria-hidden="true" />
          <CardTitle className="text-lg">
            {t('sharing.join.joined', "You're in")}
          </CardTitle>
          <Button onClick={() => void navigate(`/trips/${phase.tripId}/calendar`)}>
            {t('sharing.join.openTrip', 'Open the trip')}
          </Button>
        </div>
      )}
    </JoinShell>
  );
}
