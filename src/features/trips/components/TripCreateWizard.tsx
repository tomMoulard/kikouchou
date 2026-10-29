/**
 * @fileoverview The first trip: a name, two dates, then the invite link.
 *
 * Shown on `/trips/new` for a device that holds no trip of its own yet. It won
 * the `first-trip-wizard` experiment against the one-page form, which is still
 * what a later trip gets. Two questions (name, dates), one per screen, then the
 * trip is created and the last screen hands over its invite link. Enter
 * advances and Back goes back.
 *
 * The invitation is part of the creation, not a button after it. The place,
 * the guests and the rooms used to be three more questions before the link,
 * and almost nobody reached the link: the group fills those in the trip, once
 * they have it. A signed-out visitor, which is nearly every first visitor,
 * signs in on that same screen, and `pending-invite` carries the trip across
 * the sign-in redirect so the link opens when they are back.
 *
 * The writes are `createTripWithDetails`, the same call the one-page form
 * makes, so the two paths differ in their screens and in nothing else.
 *
 * It is also the screen behind a trip template link. A `prefill` carries the
 * place, the map pin, the description, the currency and the rooms the
 * enterprise published, and the customer answers the same two questions. The
 * name starts as the template's and the dates as today, so a customer with
 * nothing to change reaches the link by pressing Next twice.
 *
 * @module features/trips/components/TripCreateWizard
 */

import {
  type ReactElement,
  type SyntheticEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ArrowLeft, Check, PartyPopper } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker';
import { ShareLinkPanel } from '@/features/sharing/components/ShareLinkPanel';
import type { ShareLinkState } from '@/features/sharing/hooks/useTripShareLink';
import {
  forgetPendingInvite,
  rememberPendingInvite,
} from '@/features/sharing/utils/pending-invite';
import { useToday } from '@/hooks/useToday';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { announceStatus } from '@/lib/notifications';
import { pushDataLayerEvent } from '@/lib/google-tag';
import { captureEvent, captureUsage } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import type { CurrencyCode, ISODateString, Trip, TripFormData } from '@/types';
import type { NewTripGuest, NewTripRoom } from './TripForm';
import { createTripWithDetails, type TripCreationOutcome } from '../lib/create-trip-with-details';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What a trip template hands the wizard before the first question.
 *
 * Everything here is already decided by whoever published the template, so the
 * wizard neither asks for it nor shows it: it travels straight into the trip.
 *
 * `name` is the one exception: it is only where the name question starts, and
 * the customer may type over it.
 */
export interface TripCreateWizardPrefill {
  readonly name: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly coordinates: TripFormData['coordinates'];
  readonly currency: CurrencyCode | null;
  /** The template's cover photo, already downloaded. */
  readonly photo?: Blob | undefined;
  readonly rooms: readonly NewTripRoom[];
}

export interface TripCreateWizardProps {
  /** The creator's own guest row, when the account gives a name. */
  readonly currentUserName?: string | undefined;
  /**
   * A template's values, when the visitor arrived through a template link.
   *
   * Absent for the ordinary first-trip wizard.
   */
  readonly prefill?: TripCreateWizardPrefill | undefined;
  /**
   * Called the moment creation starts, before the first write.
   *
   * The page decides between the wizard and the form from the trip list, and
   * the list grows as soon as the trip row lands — before the guests, the
   * rooms and the invite screen. This is how the page knows to keep the wizard
   * on screen through that.
   */
  readonly onCreating?: (() => void) | undefined;
  /** Called from the invite screen when the user opens the trip. */
  readonly onCreated: (trip: Trip) => void;
  readonly onCancel: () => void;
  /** Whether the wizard holds anything worth an unsaved-changes prompt. */
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

/** The questions, in order; `invite` follows the last one. */
type Step = 'name' | 'dates' | 'invite';

// ============================================================================
// Constants
// ============================================================================

const QUESTIONS: readonly Step[] = ['name', 'dates'];

/**
 * The screens the progress dots count: the questions, and the link after
 * them, so the person sees the invitation coming before the trip exists.
 */
const STEP_COUNT = QUESTIONS.length + 1;

/** The date shape `Trip` stores. */
const ISO_DATE_FORMAT = 'yyyy-MM-dd';

// ============================================================================
// Helpers
// ============================================================================

function toIsoDate(date: Date): ISODateString {
  return format(date, ISO_DATE_FORMAT) as ISODateString;
}

/** Whether the visitor asked for less motion; confetti is motion. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Walks a first trip through two questions and hands over its invite link.
 *
 * @param props - See {@link TripCreateWizardProps}
 * @returns The wizard
 */
export const TripCreateWizard = memo(function TripCreateWizard({
  currentUserName,
  prefill,
  onCreating,
  onCreated,
  onCancel,
  onDirtyChange,
}: TripCreateWizardProps): ReactElement {
  const { t } = useTranslation();

  const { today } = useToday();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState(() =>
    (prefill?.name ?? '').slice(0, MAX_LENGTHS.tripName),
  );
  // A template trip starts and ends today until the customer says otherwise,
  // so the dates question can be passed with Next alone. `today` is a local
  // midnight, which is what `toIsoDate` reads.
  const [range, setRange] = useState<DateRange | undefined>(() =>
    prefill === undefined ? undefined : { from: today, to: today },
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [created, setCreated] = useState<TripCreationOutcome | null>(null);
  const [linkState, setLinkState] = useState<ShareLinkState['kind']>('loading');
  const isMountedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isMountedRef.current = true;
    captureEvent('trip_wizard_started');
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Anything typed is worth an unsaved-changes prompt; a finished trip is not.
  const isDirty = created === null && (name !== '' || range !== undefined || step !== 'name');
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // The question's own field takes focus as each screen arrives, so Enter has
  // somewhere to land without a click.
  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  // The celebration: once, on the invite screen, and not for somebody who
  // asked the OS for less motion. Loaded on demand so the form pays nothing.
  useEffect(() => {
    if (step !== 'invite' || prefersReducedMotion()) {
      return undefined;
    }
    let cancelled = false;
    void import('canvas-confetti').then(({ default: confetti }) => {
      if (!cancelled) {
        void confetti({ particleCount: 140, spread: 75, origin: { y: 0.65 } });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [step]);

  const stepIndex = QUESTIONS.indexOf(step);

  const report = useCallback((outcome: 'next' | 'skip' | 'back', from: Step): void => {
    captureEvent('trip_wizard_step', { step: from, outcome });
  }, []);

  const goTo = useCallback((next: Step): void => {
    setProblem(null);
    setStep(next);
  }, []);

  const back = useCallback((): void => {
    if (stepIndex <= 0) {
      onCancel();
      return;
    }
    report('back', step);
    goTo(QUESTIONS[stepIndex - 1] ?? 'name');
  }, [goTo, onCancel, report, step, stepIndex]);

  const create = useCallback(async (): Promise<void> => {
    if (!range?.from || !range.to) {
      goTo('dates');
      setProblem(t('trips.wizard.datesRequired', 'Pick the first and the last day to continue.'));
      return;
    }
    setIsCreating(true);
    setProblem(null);
    onCreating?.();
    // The creator is on the guest list when the account gives a name. Every
    // other guest adds themself through the link.
    const guests: NewTripGuest[] = currentUserName ? [{ name: currentUserName, isSelf: true }] : [];
    try {
      const outcome = await createTripWithDetails({
        form: {
          name: name.trim(),
          startDate: toIsoDate(range.from),
          endDate: toIsoDate(range.to),
          // A template's own fields. The wizard asks for none of them, so they
          // are here or they are nowhere.
          ...(prefill?.location?.trim() ? { location: prefill.location.trim() } : {}),
          ...(prefill?.coordinates === undefined ? {} : { coordinates: prefill.coordinates }),
          ...(prefill?.description ? { description: prefill.description } : {}),
          ...(prefill?.currency ? { currency: prefill.currency } : {}),
        },
        guests,
        rooms: [...(prefill?.rooms ?? [])],
        ...(prefill?.photo === undefined ? {} : { photo: prefill.photo }),
        importSourceTripId: null,
        // The page selects the trip when the user opens it; selecting it here
        // would remount the route and lose the invite screen.
        selectAsCurrent: false,
      });
      if (!isMountedRef.current) {
        return;
      }
      captureUsage('trip_created', {
        via: prefill === undefined ? 'wizard' : 'template',
        imported_rooms: outcome.counts.importedRooms,
        guest_count: outcome.counts.guests,
        imported_guests: outcome.counts.importedGuests,
        room_count: outcome.counts.rooms,
      });
      // The conversion Google Ads optimises against, through a GTM trigger.
      // Counts and the enum only, like every other Google tag event.
      pushDataLayerEvent('trip_created', {
        via: prefill === undefined ? 'wizard' : 'template',
        guest_count: outcome.counts.guests,
        room_count: outcome.counts.rooms,
      });
      announceStatus(
        t('trips.wizard.createdAnnouncement', {
          tripName: outcome.trip.name,
          defaultValue: 'Trip {{tripName}} created',
        }),
      );
      setCreated(outcome);
      setStep('invite');
    } catch (error) {
      console.error('Wizard could not create the trip:', error);
      if (isMountedRef.current) {
        setProblem(t('trips.wizard.failed', 'The trip could not be created. Try again.'));
      }
    } finally {
      if (isMountedRef.current) {
        setIsCreating(false);
      }
    }
  }, [currentUserName, goTo, name, onCreating, prefill, range, t]);

  /** Enter, or the Next button: validate this question, move to the next. */
  const advance = useCallback((): void => {
    switch (step) {
      case 'name': {
        if (name.trim() === '') {
          setProblem(t('trips.wizard.nameRequired', 'Give the trip a name to continue.'));
          return;
        }
        report('next', step);
        goTo('dates');
        return;
      }
      case 'dates': {
        if (!range?.from || !range.to) {
          setProblem(
            t('trips.wizard.datesRequired', 'Pick the first and the last day to continue.'),
          );
          return;
        }
        report('next', step);
        void create();
        return;
      }
      case 'invite':
        return;
    }
  }, [create, goTo, name, range, report, step, t]);

  const handleSubmit = useCallback(
    (event: SyntheticEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (isCreating) {
        return;
      }
      advance();
    },
    [advance, isCreating],
  );

  /**
   * Where a sign-in started here comes back to.
   *
   * Google and a magic link leave the page, so the trip is remembered while
   * the screen asks for an account, and forgotten once the link is on screen:
   * a store app's sheet and a wallet sign in without leaving, and this screen
   * shows the link itself.
   */
  const handleLinkState = useCallback(
    (kind: ShareLinkState['kind']): void => {
      setLinkState(kind);
      if (created === null) {
        return;
      }
      if (kind === 'needs-account') {
        rememberPendingInvite(created.trip.id);
      } else if (kind === 'invite') {
        forgetPendingInvite();
      }
    },
    [created],
  );

  const openTrip = useCallback((): void => {
    if (created === null) {
      return;
    }
    forgetPendingInvite();
    // `next` once the link was on screen, `skip` when the person left
    // without one: the share of first trips that leave with a link.
    report(linkState === 'invite' ? 'next' : 'skip', 'invite');
    onCreated(created.trip);
  }, [created, linkState, onCreated, report]);

  const progressLabel = useMemo(
    () =>
      t('trips.wizard.progress', {
        step: Math.max(stepIndex, 0) + 1,
        total: STEP_COUNT,
        defaultValue: 'Step {{step}} of {{total}}',
      }),
    [stepIndex, t],
  );

  // --------------------------------------------------------------------------
  // Invite
  // --------------------------------------------------------------------------

  if (step === 'invite' && created !== null) {
    const signInFirst = linkState === 'needs-account';
    return (
      <div className="flex flex-col gap-6 py-4" data-testid="trip-wizard-invite">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PartyPopper className="size-8" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold">
              {t('trips.wizard.inviteTitle', {
                tripName: created.trip.name,
                defaultValue: '{{tripName}} is ready: invite the group',
              })}
            </h2>
            <p className="text-muted-foreground">
              {t(
                'trips.wizard.inviteHint',
                'Send this link. Each person adds their name and when they arrive, and the rooms fill in from there.',
              )}
            </p>
          </div>
        </div>
        <ShareLinkPanel
          trip={created.trip}
          active
          signIn="inline"
          withShareSheet
          onStateChange={handleLinkState}
        />
        <div className="flex justify-center">
          <Button variant={signInFirst ? 'ghost' : 'default'} onClick={openTrip}>
            {signInFirst
              ? t('trips.wizard.later', 'Later, open the trip')
              : t('trips.wizard.openCalendar', 'Open the calendar')}
          </Button>
        </div>
      </div>
    );
  }

  const isLastQuestion = stepIndex === QUESTIONS.length - 1;

  // --------------------------------------------------------------------------
  // Questions
  // --------------------------------------------------------------------------

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6" data-testid="trip-wizard">
      <ol className="flex justify-center gap-2" aria-label={progressLabel}>
        {[...QUESTIONS, 'invite' as const].map((screen, index) => (
          <li
            key={screen}
            aria-current={index === stepIndex ? 'step' : undefined}
            className={cn(
              'size-2.5 rounded-full transition-colors',
              index <= stepIndex ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          >
            <span className="sr-only">{screen}</span>
          </li>
        ))}
      </ol>

      {step === 'name' ? (
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">
            {t('trips.wizard.nameQuestion', 'What is the trip called?')}
          </h2>
          <p className="text-muted-foreground">
            {t(
              'trips.wizard.nameHint',
              'The house, the town, the occasion, whatever the group calls it.',
            )}
          </p>
          <Label htmlFor="wizard-trip-name" className="sr-only">
            {t('trips.wizard.nameLabel', 'Trip name')}
          </Label>
          <Input
            id="wizard-trip-name"
            ref={inputRef}
            value={name}
            maxLength={MAX_LENGTHS.tripName}
            placeholder={t('trips.wizard.namePlaceholder', 'Summer at the lake house')}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="h-12 text-lg"
            autoComplete="off"
          />
        </div>
      ) : null}

      {step === 'dates' ? (
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">{t('trips.wizard.datesQuestion', 'When is it?')}</h2>
          <p className="text-muted-foreground">
            {t(
              'trips.wizard.datesHint',
              'First and last day. Guests can arrive and leave in between.',
            )}
          </p>
          <DateRangePicker
            id="wizard-trip-dates"
            value={range}
            onChange={setRange}
            aria-label={t('trips.wizard.datesLabel', 'Trip dates')}
            className="h-12 w-full justify-start text-base"
          />
        </div>
      ) : null}

      {problem !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={back} disabled={isCreating}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('trips.wizard.back', 'Back')}
        </Button>
        <div className="flex gap-2">
          {isLastQuestion ? (
            <Button type="button" disabled={isCreating} onClick={advance}>
              <Check className="size-4" aria-hidden="true" />
              {isCreating
                ? t('trips.wizard.creating', 'Creating…')
                : t('trips.wizard.create', 'Create the trip')}
            </Button>
          ) : (
            <Button type="submit">{t('trips.wizard.next', 'Next')}</Button>
          )}
        </div>
      </div>
    </form>
  );
});
