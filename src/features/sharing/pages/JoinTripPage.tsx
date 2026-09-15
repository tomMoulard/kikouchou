/**
 * @fileoverview The screen an invite link lands on.
 *
 * Two ways in, and both end on the trip's calendar:
 *
 * - **Signed out** — the trip is read through the token and lands on this
 *   device read-only. The screen says whose trip this is, and asks which guest
 *   the visitor is so the calendar can show their own room and travel. That
 *   answer is device-local; nothing is written to the server. This is where a
 *   wall used to stand — "Create an account so the others can see your room" —
 *   and most invitees left rather than climb it.
 * - **Signed in** — the account is put on the roster, the trip downloads, and
 *   the same question is asked as a server-side claim, so two accounts cannot
 *   both be Alice.
 *
 * Each step is visible because any of them can take a moment or fail.
 *
 * @module features/sharing/pages/JoinTripPage
 */

import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Calendar,
  Check,
  Loader2,
  MapPin,
  Palmtree,
  Smartphone,
  UserRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { onboardingSurface, statusVariants } from '@/components/ui/status.variants';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { useInstallPromptState } from '@/contexts/InstallPromptContext';
import { useTripContext } from '@/contexts/TripContext';
import { captureEvent } from '@/lib/posthog';
import { reportFailure } from '@/lib/errors/report-failure';
import { db } from '@/lib/db/database';
import { useAuth } from '@/features/auth/AuthContext';
import { getSupabaseClient } from '@/lib/supabase/client';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cacheClaimedPersonId } from '@/lib/identity/trip-identity';
import { notify } from '@/lib/notifications';
import { isRunningStandalone } from '@/lib/pwa/display-mode';
import { useHereManifest } from '@/lib/pwa/use-here-manifest';
import { getTripGuestPersonId, writeGuestIdentity } from '@/lib/sharing/guest-identity';
import { claimParticipant, fetchClaimedParticipants } from '@/lib/sync/join-trip';
import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import { cn } from '@/lib/utils';
import { formatDateRange } from '@/lib/utils/date-format';
import { useJoinTrip } from '../hooks/useJoinTrip';
import type { PersonId, Trip, TripId } from '@/types';

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
// Identity step — members
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

      // Everything below runs inside this try for one reason: a single pending
      // claim disables *every* name in the list, so any throw between here and
      // the reset used to leave the whole picker permanently dead — a spinner
      // on one row, no error anywhere, and a reload the only way forward. The
      // awaits below reach a dynamic import and the network, both of which
      // fail on an invitee opening a link for the first time on a phone.
      let result: Awaited<ReturnType<typeof claimParticipant>>;
      try {
        const client = await getSupabaseClient();
        if (!client) {
          // No backend configured. Say so rather than looking like a dead tap.
          setError(t('errors.generic', 'Something went wrong'));
          return;
        }

        result = await claimParticipant(client, remoteTripId, user.id, personId);
      } catch (error) {
        reportFailure(
          'JoinTripPage.handleClaim',
          error,
          t('errors.generic', 'Something went wrong'),
        );
        setError(t('errors.generic', 'Something went wrong'));
        return;
      } finally {
        setClaiming(null);
      }

      if (result.status === 'taken') {
        captureEvent('trip_identity_claim_failed', { reason: 'taken' });
        // Somebody claimed this person between the list loading and the tap.
        setClaimed((current) => new Set(current).add(personId));
        setError(t('sharing.join.identityTaken', 'Somebody else just took that name.'));
        return;
      }
      if (result.status === 'not-a-member') {
        captureEvent('trip_identity_claim_failed', { reason: 'not-a-member' });
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

      captureEvent('trip_identity_claimed', { scope: 'account' });

      // Cache the confirmed claim locally. The server row stays authoritative,
      // but until this line existed the claim was written to Postgres and never
      // read back — so an account-joined guest reached the trip with no local
      // sense of being anybody, and every "my travel" view showed them nothing.
      await cacheClaimedPersonId(tripId, user.id, personId);

      // Only on a confirmed claim.
      void navigate(`/trips/${tripId}/calendar`);
    },
    [navigate, remoteTripId, t, tripId, user],
  );

  const skip = useCallback(() => {
    // Distinguished from claiming, because somebody entering a trip as nobody in
    // particular will not see their own room or travel — a quiet drop-off worth
    // measuring rather than guessing at.
    captureEvent('trip_identity_skipped', { scope: 'account' });
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
// Welcome — viewers
// ============================================================================

interface ViewerWelcomeProps {
  readonly trip: Trip;
  /**
   * The visitor is here to install the app from this page, not to go on to
   * the calendar: the install nudge sent them, or the link said `?install=1`.
   */
  readonly installRequested: boolean;
}

/**
 * The invite, for somebody with no account.
 *
 * Whose trip, when and where, then "which one are you?" — answered on this
 * device only, through the same storage the share wizard uses, so the calendar
 * can point at the visitor's own room and travel. A visitor who already
 * answered on this device is sent straight in, like a returning guest of the
 * share wizard.
 *
 * Styled like that wizard rather than like the account flow above: warm,
 * because this is the first thing most people ever see of the app, and the
 * tagline says what the app is when the page is not running as an installed
 * app — an icon on a Home Screen has already said so.
 */
function ViewerWelcome({ trip, installRequested }: ViewerWelcomeProps): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const personsQuery = useLiveQuery(
    () => db.persons.where('tripId').equals(trip.id).toArray(),
    [trip.id],
  );
  const persons = useMemo(() => personsQuery ?? [], [personsQuery]);

  const dateRange = useMemo(
    () => formatDateRange(trip.startDate, trip.endDate, getDateLocale(i18n.language)),
    [i18n.language, trip.endDate, trip.startDate],
  );

  const showTagline = !isRunningStandalone();

  const openTrip = useCallback((): void => {
    void navigate(`/trips/${trip.id}/calendar`);
  }, [navigate, trip.id]);

  const alreadyIdentified = getTripGuestPersonId(trip) !== undefined;

  // A returning viewer already said who they are; the wizard would ask again
  // and the calendar is what they came back for. Unless they came back to
  // install: then this page has to stay under the share sheet, because an app
  // added to the Home Screen from here opens here.
  useEffect(() => {
    if (alreadyIdentified && !installRequested) {
      openTrip();
    }
  }, [alreadyIdentified, installRequested, openTrip]);

  const handlePick = useCallback(
    (personId: PersonId): void => {
      if (!writeGuestIdentity(trip.shareId, { personId, tripId: trip.id })) {
        // The trip is on the device whatever storage says; the calendar just
        // will not know whose room to point at until they pick again.
        notify.error(
          t(
            'sharing.identityStorageFailed',
            'Could not save your identity. You may need to re-select on your next visit.',
          ),
        );
      }
      captureEvent('trip_identity_claimed', { scope: 'device' });
      openTrip();
    },
    [openTrip, t, trip.id, trip.shareId],
  );

  const skip = useCallback((): void => {
    captureEvent('trip_identity_skipped', { scope: 'device' });
    openTrip();
  }, [openTrip]);

  return (
    <div
      className={cn(
        'flex min-h-svh items-center justify-center p-4',
        // The global banner is showing the install steps along the bottom of
        // the screen — `bottom-above-stack` puts its top about 20rem up on a
        // phone. Room for it, so the card's own button stays reachable.
        installRequested && 'pb-96',
        onboardingSurface,
      )}
    >
      <Card className="w-full max-w-md border-warning-border shadow-lg">
        <CardHeader className="pb-4 pt-8 text-center">
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-warning/20">
            <Palmtree
              className={cn('size-10', statusVariants({ tone: 'warning', emphasis: 'text' }))}
              aria-hidden="true"
            />
          </div>

          {showTagline ? (
            <p className="mb-2 text-sm text-muted-foreground">
              {t(
                'sharing.join.welcomeTagline',
                'Welcome to Kikouchou, the app for a house full of friends.',
              )}
            </p>
          ) : null}

          <CardTitle className="text-2xl font-bold text-warning-on-surface">
            {t('sharing.join.welcomeTo', {
              tripName: trip.name,
              defaultValue: "You're invited to {{tripName}}",
            })}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6 pb-8">
          <div
            className={cn(
              'space-y-3 rounded-xl p-4',
              statusVariants({ tone: 'warning', emphasis: 'surface' }),
            )}
          >
            {trip.location ? (
              <div className="flex items-center gap-3 text-sm text-foreground">
                <MapPin className="size-4 shrink-0 text-warning-on-surface" aria-hidden="true" />
                <span>{trip.location}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-3 text-sm text-foreground">
              <Calendar className="size-4 shrink-0 text-warning-on-surface" aria-hidden="true" />
              <span>{dateRange}</span>
            </div>
          </div>

          {installRequested ? (
            <div
              className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-left text-sm"
              data-testid="install-here-hint"
            >
              <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-foreground">
                {t(
                  'sharing.join.installHere',
                  'Add Kikouchou to your Home Screen from this page, and the app opens on this trip.',
                )}
              </p>
            </div>
          ) : null}

          {installRequested && alreadyIdentified ? (
            <Button type="button" variant="outline" className="h-11 w-full" onClick={openTrip}>
              {t('sharing.join.openTrip', 'Open the trip')}
            </Button>
          ) : (
            <>
              <div className="space-y-1 text-center">
                <p className="text-lg font-semibold text-foreground">
                  {t('sharing.join.whoAreYou', 'Which one are you?')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'sharing.join.viewerHint',
                    'Pick your name and the trip shows your room and your travel. You can look at everything; changing anything needs a sign-in.',
                  )}
                </p>
              </div>

              {persons.length === 0 ? (
                <p
                  className={cn(
                    'rounded-xl p-4 text-center text-sm',
                    statusVariants({ tone: 'warning' }),
                  )}
                >
                  {t(
                    'sharing.join.noParticipantsHint',
                    "Either nobody has been added to this trip yet, or their details haven't reached this device. You can open the trip and carry on.",
                  )}
                </p>
              ) : (
                <ul className="space-y-2">
                  {persons.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => {
                          handlePick(person.id);
                        }}
                        className={cn(
                          'flex w-full min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border-2 p-4 text-left transition-colors',
                          'border-warning-border bg-card hover:border-warning',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        )}
                      >
                        <span
                          className="size-8 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: person.color }}
                          aria-hidden="true"
                        />
                        <span className="flex-1 font-medium text-foreground">{person.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full text-warning-on-surface hover:bg-warning-surface hover:text-warning-on-surface dark:hover:bg-warning-surface dark:hover:text-warning-on-surface"
                onClick={skip}
              >
                {persons.length === 0
                  ? t('sharing.join.lookAround', 'Have a look around')
                  : t('sharing.join.notListed', "I'm not on the list")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
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
  const { installIntent, isInstalled } = useInstallPromptState();

  // An iPhone that installs from this page opens the installed app on this
  // page — the one place the trip can be fetched again without Safari's
  // storage. Restored when the page is left.
  useHereManifest();

  // Not inside the installed app, where the same URL is just the invite.
  const installRequested = installIntent && !isInstalled;

  // Selecting the trip is what mounts the sync provider, which is what fills the
  // participant list the identity step needs — and, for a viewer, what starts
  // refreshing the copy.
  useEffect(() => {
    if (phase.kind === 'joined' || phase.kind === 'viewing') {
      void setCurrentTrip(phase.tripId);
    }
  }, [phase, setCurrentTrip]);

  const landedTrip = useMemo(
    () =>
      phase.kind === 'joined' || phase.kind === 'viewing'
        ? trips.find((candidate) => candidate.id === phase.tripId)
        : undefined,
    [phase, trips],
  );

  if (phase.kind === 'joining') {
    return (
      <JoinShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-lg">
            {t('sharing.join.opening', 'Opening the trip…')}
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

  if (phase.kind === 'viewing') {
    if (!landedTrip) {
      // The row was just written; the live query behind `trips` has a tick to
      // catch up.
      return (
        <JoinShell>
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-lg">
              {t('sharing.join.opening', 'Opening the trip…')}
            </CardTitle>
          </div>
        </JoinShell>
      );
    }
    return <ViewerWelcome trip={landedTrip} installRequested={installRequested} />;
  }

  return (
    <JoinShell>
      {landedTrip?.remoteTripId ? (
        <IdentityStep tripId={phase.tripId} remoteTripId={landedTrip.remoteTripId} />
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          <Check className="size-6 text-primary" aria-hidden="true" />
          <CardTitle className="text-lg">{t('sharing.join.joined', "You're in")}</CardTitle>
          <Button onClick={() => void navigate(`/trips/${phase.tripId}/calendar`)}>
            {t('sharing.join.openTrip', 'Open the trip')}
          </Button>
        </div>
      )}
    </JoinShell>
  );
}
