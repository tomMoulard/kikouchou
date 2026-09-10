/**
 * @fileoverview The first trip, one question per screen.
 *
 * Shown on `/trips/new` for a device that holds no trip yet, behind the
 * `first-trip-wizard` feature flag, and compared against the one-page form on
 * `trip_created`. Five questions — name, dates, place, guests, rooms — and a
 * screen that says the trip is ready. Enter advances, Back goes back, and
 * everything after the dates can be skipped: a trip needs a name and two
 * dates, nothing else, and the rooms page is a fine place to add rooms.
 *
 * The writes are `createTripWithDetails`, the same call the one-page form
 * makes, so the two arms differ in their screens and in nothing else.
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
import { ArrowLeft, Check, PartyPopper, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker';
import { ShareDialog } from '@/features/sharing/components/ShareDialog';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { announceStatus } from '@/lib/notifications';
import posthog, { captureUsage } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import type { ISODateString, Trip, TripFormData } from '@/types';
import { LocationAutocomplete, type TripImportData } from './LocationAutocomplete';
import type { NewTripGuest, NewTripRoom } from './TripForm';
import { createTripWithDetails, type TripCreationOutcome } from '../lib/create-trip-with-details';

// ============================================================================
// Type Definitions
// ============================================================================

export interface TripCreateWizardProps {
  /** What to pre-fill the first guest, "you", with. */
  readonly currentUserName?: string | undefined;
  /**
   * Called the moment creation starts, before the first write.
   *
   * The page decides between the wizard and the form from the trip list, and
   * the list grows as soon as the trip row lands — before the guests, the
   * rooms and the done screen. This is how the page knows to keep the wizard
   * on screen through that.
   */
  readonly onCreating?: (() => void) | undefined;
  /** Called from the done screen when the user opens the trip. */
  readonly onCreated: (trip: Trip) => void;
  readonly onCancel: () => void;
  /** Whether the wizard holds anything worth an unsaved-changes prompt. */
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

/** The questions, in order; `done` follows the last one. */
type Step = 'name' | 'dates' | 'place' | 'guests' | 'rooms' | 'done';

// ============================================================================
// Constants
// ============================================================================

const QUESTIONS: readonly Step[] = ['name', 'dates', 'place', 'guests', 'rooms'];

/** The date shape `Trip` stores. */
const ISO_DATE_FORMAT = 'yyyy-MM-dd';

const MIN_ROOM_CAPACITY = 1;
const DEFAULT_ROOM_CAPACITY = 2;

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
 * Walks a first trip through five questions and a celebration.
 *
 * @param props - See {@link TripCreateWizardProps}
 * @returns The wizard
 */
export const TripCreateWizard = memo(function TripCreateWizard({
  currentUserName,
  onCreating,
  onCreated,
  onCancel,
  onDirtyChange,
}: TripCreateWizardProps): ReactElement {
  const { t } = useTranslation();

  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [location, setLocation] = useState('');
  const [coordinates, setCoordinates] = useState<TripFormData['coordinates']>(undefined);
  const [importSource, setImportSource] = useState<TripImportData | null>(null);
  const [guests, setGuests] = useState<NewTripGuest[]>(() =>
    currentUserName ? [{ name: currentUserName, isSelf: true }] : [],
  );
  const [guestDraft, setGuestDraft] = useState('');
  const [rooms, setRooms] = useState<NewTripRoom[]>([]);
  const [roomDraft, setRoomDraft] = useState('');
  const [roomCapacity, setRoomCapacity] = useState(DEFAULT_ROOM_CAPACITY);
  const [problem, setProblem] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [created, setCreated] = useState<TripCreationOutcome | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const isMountedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isMountedRef.current = true;
    posthog?.capture('trip_wizard_started');
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

  // The celebration: once, on the done screen, and not for somebody who asked
  // the OS for less motion. Loaded on demand so the form pays nothing for it.
  useEffect(() => {
    if (step !== 'done' || prefersReducedMotion()) {
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
    posthog?.capture('trip_wizard_step', { step: from, outcome });
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
    try {
      const outcome = await createTripWithDetails({
        form: {
          name: name.trim(),
          startDate: toIsoDate(range.from),
          endDate: toIsoDate(range.to),
          ...(location.trim() === '' ? {} : { location: location.trim() }),
          ...(coordinates === undefined ? {} : { coordinates }),
        },
        guests,
        rooms,
        importSourceTripId: importSource?.trip.id ?? null,
        // The page selects the trip when the user opens it; selecting it here
        // would remount the route and lose the done screen.
        selectAsCurrent: false,
      });
      if (!isMountedRef.current) {
        return;
      }
      captureUsage('trip_created', {
        via: 'wizard',
        imported_rooms: outcome.counts.importedRooms,
        guest_count: outcome.counts.guests,
        imported_guests: outcome.counts.importedGuests,
        room_count: outcome.counts.rooms,
      });
      announceStatus(
        t('trips.wizard.createdAnnouncement', {
          tripName: outcome.trip.name,
          defaultValue: 'Trip {{tripName}} created',
        }),
      );
      setCreated(outcome);
      setStep('done');
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
  }, [coordinates, goTo, guests, importSource, location, name, onCreating, range, rooms, t]);

  /** Enter, or the Next button: validate this question, move to the next. */
  const advance = useCallback(
    (outcome: 'next' | 'skip'): void => {
      switch (step) {
        case 'name': {
          if (name.trim() === '') {
            setProblem(t('trips.wizard.nameRequired', 'Give the trip a name to continue.'));
            return;
          }
          report(outcome, step);
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
          report(outcome, step);
          goTo('place');
          return;
        }
        case 'place': {
          report(outcome, step);
          goTo('guests');
          return;
        }
        case 'guests': {
          report(outcome, step);
          goTo('rooms');
          return;
        }
        case 'rooms': {
          report(outcome, step);
          void create();
          return;
        }
        case 'done':
          return;
      }
    },
    [create, goTo, name, range, report, step, t],
  );

  const addGuest = useCallback((): boolean => {
    const trimmed = guestDraft.trim();
    if (trimmed === '') {
      return false;
    }
    setGuests((current) => [...current, { name: trimmed.slice(0, MAX_LENGTHS.personName) }]);
    setGuestDraft('');
    return true;
  }, [guestDraft]);

  const addRoom = useCallback((): boolean => {
    const trimmed = roomDraft.trim();
    if (trimmed === '') {
      return false;
    }
    setRooms((current) => [
      ...current,
      {
        name: trimmed.slice(0, MAX_LENGTHS.roomName),
        capacity: Math.max(MIN_ROOM_CAPACITY, Math.round(roomCapacity) || MIN_ROOM_CAPACITY),
      },
    ]);
    setRoomDraft('');
    setRoomCapacity(DEFAULT_ROOM_CAPACITY);
    return true;
  }, [roomCapacity, roomDraft]);

  /**
   * Enter on a screen. On a list screen with something typed it adds the row
   * and stays; with nothing typed it moves on, like everywhere else.
   */
  const handleSubmit = useCallback(
    (event: SyntheticEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (isCreating) {
        return;
      }
      if (step === 'guests' && addGuest()) {
        return;
      }
      if (step === 'rooms' && addRoom()) {
        return;
      }
      advance('next');
    },
    [addGuest, addRoom, advance, isCreating, step],
  );

  const handleLocationChange = useCallback(
    (value: string, nextCoordinates?: TripFormData['coordinates']): void => {
      setLocation(value);
      setCoordinates(nextCoordinates);
    },
    [],
  );

  const handleImportTrip = useCallback((data: TripImportData): void => {
    setImportSource(data);
    setLocation(data.trip.location ?? '');
    setCoordinates(data.trip.coordinates);
  }, []);

  const progressLabel = useMemo(
    () =>
      t('trips.wizard.progress', {
        step: Math.max(stepIndex, 0) + 1,
        total: QUESTIONS.length,
        defaultValue: 'Step {{step}} of {{total}}',
      }),
    [stepIndex, t],
  );

  // --------------------------------------------------------------------------
  // Done
  // --------------------------------------------------------------------------

  if (step === 'done' && created !== null) {
    return (
      <div className="flex flex-col items-center gap-6 py-8 text-center" data-testid="trip-wizard-done">
        <div className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary">
          <PartyPopper className="size-10" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">
            {t('trips.wizard.doneTitle', {
              tripName: created.trip.name,
              defaultValue: '{{tripName}} is ready',
            })}
          </h2>
          <p className="text-muted-foreground">
            {t(
              'trips.wizard.doneHint',
              'Share the link and the others can see who sleeps where and who arrives when.',
            )}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              onCreated(created.trip);
            }}
          >
            {t('trips.wizard.openCalendar', 'Open the calendar')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShareOpen(true);
            }}
          >
            {t('trips.wizard.share', 'Share the trip')}
          </Button>
        </div>
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} trip={created.trip} />
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Questions
  // --------------------------------------------------------------------------

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6" data-testid="trip-wizard">
      <ol className="flex justify-center gap-2" aria-label={progressLabel}>
        {QUESTIONS.map((question, index) => (
          <li
            key={question}
            aria-current={index === stepIndex ? 'step' : undefined}
            className={cn(
              'size-2.5 rounded-full transition-colors',
              index <= stepIndex ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          >
            <span className="sr-only">{question}</span>
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
              'The house, the town, the occasion — whatever the group calls it.',
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

      {step === 'place' ? (
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">
            {t('trips.wizard.placeQuestion', 'Where is the house?')}
          </h2>
          <p className="text-muted-foreground">
            {t(
              'trips.wizard.placeHint',
              'A town or an address. Pick a previous trip to reuse its rooms.',
            )}
          </p>
          <Label htmlFor="wizard-trip-location" className="sr-only">
            {t('trips.wizard.placeLabel', 'Location')}
          </Label>
          <LocationAutocomplete
            id="wizard-trip-location"
            value={location}
            {...(coordinates === undefined ? {} : { coordinates })}
            onChange={handleLocationChange}
            onImportTrip={handleImportTrip}
          />
        </div>
      ) : null}

      {step === 'guests' ? (
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">
            {t('trips.wizard.guestsQuestion', 'Who is coming?')}
          </h2>
          <p className="text-muted-foreground">
            {t(
              'trips.wizard.guestsHint',
              'One name at a time, Enter after each. You can add more later.',
            )}
          </p>
          {guests.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={t('trips.wizard.guestsQuestion', 'Who is coming?')}>
              {guests.map((guest, index) => (
                <li
                  key={`${guest.name}-${index}`}
                  className="flex items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1 text-sm"
                >
                  <span>{guest.name}</span>
                  {guest.isSelf ? (
                    <span className="rounded-full bg-primary/10 px-2 text-xs text-primary">
                      {t('trips.wizard.you', 'You')}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-full hover:bg-muted"
                    aria-label={t('trips.wizard.removeGuest', {
                      name: guest.name,
                      defaultValue: 'Remove {{name}}',
                    })}
                    onClick={() => {
                      setGuests((current) => current.filter((_, at) => at !== index));
                    }}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Label htmlFor="wizard-guest-name" className="sr-only">
              {t('trips.wizard.guestLabel', 'Guest name')}
            </Label>
            <Input
              id="wizard-guest-name"
              ref={inputRef}
              value={guestDraft}
              maxLength={MAX_LENGTHS.personName}
              placeholder={t('trips.wizard.guestPlaceholder', 'A first name')}
              onChange={(event) => {
                setGuestDraft(event.target.value);
              }}
              className="h-12 text-lg"
              autoComplete="off"
            />
            <Button type="button" variant="outline" className="h-12" onClick={addGuest}>
              <Plus className="size-4" aria-hidden="true" />
              {t('trips.wizard.addGuest', 'Add')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'rooms' ? (
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">
            {t('trips.wizard.roomsQuestion', 'Which rooms are there?')}
          </h2>
          <p className="text-muted-foreground">
            {t('trips.wizard.roomsHint', 'Name and beds. Skip this and add rooms as you go.')}
          </p>
          {rooms.length > 0 ? (
            <ul className="space-y-2" aria-label={t('trips.wizard.roomsQuestion', 'Which rooms are there?')}>
              {rooms.map((room, index) => (
                <li
                  key={`${room.name}-${index}`}
                  className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <span>
                    {room.name} · {room.capacity} {t('trips.wizard.bedsLabel', 'Beds').toLowerCase()}
                  </span>
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-full hover:bg-muted"
                    aria-label={t('trips.wizard.removeRoom', {
                      name: room.name,
                      defaultValue: 'Remove {{name}}',
                    })}
                    onClick={() => {
                      setRooms((current) => current.filter((_, at) => at !== index));
                    }}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="wizard-room-name" className="sr-only">
                {t('trips.wizard.roomLabel', 'Room name')}
              </Label>
              <Input
                id="wizard-room-name"
                ref={inputRef}
                value={roomDraft}
                maxLength={MAX_LENGTHS.roomName}
                placeholder={t('trips.wizard.roomPlaceholder', 'Master bedroom')}
                onChange={(event) => {
                  setRoomDraft(event.target.value);
                }}
                className="h-12 text-lg"
                autoComplete="off"
              />
            </div>
            <div className="w-24">
              <Label htmlFor="wizard-room-beds" className="sr-only">
                {t('trips.wizard.bedsLabel', 'Beds')}
              </Label>
              <Input
                id="wizard-room-beds"
                type="number"
                min={MIN_ROOM_CAPACITY}
                inputMode="numeric"
                value={roomCapacity}
                onChange={(event) => {
                  setRoomCapacity(Number(event.target.value));
                }}
                className="h-12 text-lg"
              />
            </div>
            <Button type="button" variant="outline" className="h-12" onClick={addRoom}>
              <Plus className="size-4" aria-hidden="true" />
              {t('trips.wizard.addRoom', 'Add')}
            </Button>
          </div>
          {/* Two fields and no submit button would leave Enter doing nothing:
              a form only submits implicitly with one field or a submit button.
              This one is never seen or tabbed to; it is what makes Enter add
              the room, and Enter on an empty row create the trip. */}
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
            {t('trips.wizard.addRoom', 'Add')}
          </button>
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
          {stepIndex >= 2 && step !== 'rooms' ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                advance('skip');
              }}
            >
              {t('trips.wizard.skip', 'Skip for now')}
            </Button>
          ) : null}
          {step === 'rooms' ? (
            <Button type="button" disabled={isCreating} onClick={() => advance('next')}>
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
