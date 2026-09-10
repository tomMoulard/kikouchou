/**
 * @fileoverview Trip Create Page for creating new vacation trips.
 * Provides a form interface to create trips, with navigation and user feedback.
 *
 * @module features/trips/pages/TripCreatePage
 */

import { type ReactElement, memo, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UsersRound } from 'lucide-react';
import { useOfflineAwareNotify, useUnsavedChanges } from '@/hooks';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';

import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTripContext } from '@/contexts/TripContext';
import { TripCreateWizard } from '@/features/trips/components/TripCreateWizard';
import {
  TripForm,
  type NewTripGuest,
  type NewTripRoom,
  type TripFormHandle,
} from '@/features/trips/components/TripForm';
import {
  createTripWithDetails,
  type TripCreationWarning,
} from '@/features/trips/lib/create-trip-with-details';
import { useAuth } from '@/features/auth/AuthContext';
import { getAccountGuestName } from '@/features/auth/display-name';
import {
  GuestGroupImportDialog,
  type GuestGroupSelection,
} from '@/features/guest-groups';
import { setCurrentTrip } from '@/lib/db';
import { captureUsage } from '@/lib/posthog';
import { notify } from '@/lib/notifications';
import type { Trip, TripFormData, TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * The PostHog flag that swaps the one-page form for the first-trip wizard.
 *
 * Only for a device that holds no trip yet: the comparison is about the first
 * creation, and somebody who has made a trip before knows the form.
 */
export const FIRST_TRIP_WIZARD_FLAG = 'first-trip-wizard';

// ============================================================================
// Component
// ============================================================================

/**
 * Page component for creating a new trip.
 *
 * Features:
 * - Uses TripForm component for form UI and validation
 * - Confirms success as an OS notification, reports errors as a toast
 * - Navigates to trip calendar on successful creation
 * - Prevents double-submission during async operations
 * - Handles unmount during async operations to prevent memory leaks
 *
 * @returns The trip create page element
 *
 * @example
 * ```tsx
 * // In router configuration
 * <Route path="/trips/new" element={<TripCreatePage />} />
 * ```
 */
export const TripCreatePage = memo(function TripCreatePage(): ReactElement {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { notifySuccess } = useOfflineAwareNotify();
  const { user } = useAuth();
  const { trips, isLoading: tripsLoading } = useTripContext();
  const wizardFlag = useFeatureFlag(FIRST_TRIP_WIZARD_FLAG);

  /**
   * Which experience this visit gets.
   *
   * The wizard only ever replaces the form for a first trip, and only once the
   * flag has answered: rendering the form and then swapping it for the wizard
   * a second later would be the worst of both. A device with a trip already
   * skips the question entirely.
   */
  const isFirstTrip = !tripsLoading && trips.length === 0;
  /**
   * Latched the moment the wizard starts writing: the trip list grows with the
   * first write, which would otherwise swap the wizard for the form between
   * the last question and the done screen.
   */
  const [wizardBusy, setWizardBusy] = useState(false);
  const showWizard = wizardFlag === true && (isFirstTrip || wizardBusy);
  const decidingWizard = isFirstTrip && wizardFlag === undefined && !wizardBusy;

  /**
   * What to pre-fill the first guest — "you" — with.
   *
   * `undefined` signed out, and signed out is a first-class way to use this
   * app, so the row is then simply the user's to fill in. A plain string, so
   * the form compares it by value across the render where the session resolves.
   */
  const currentUserName = getAccountGuestName(user);

  // ============================================================================
  // Dirty State & Unsaved Changes Guard
  // ============================================================================

  const [isDirty, setIsDirty] = useState(false);
  const { isBlocked, proceed, reset, skipNextBlock } = useUnsavedChanges(isDirty);
  const importSourceRef = useRef<TripId | null>(null);
  const guestsRef = useRef<readonly NewTripGuest[]>([]);
  const roomsRef = useRef<readonly NewTripRoom[]>([]);

  // ============================================================================
  // Guest Group Selection
  // ============================================================================

  /*
    The trip does not exist yet, so the picker cannot write — but the guest list
    does not need it to. Picked people go straight into the form's list as
    ordinary rows, editable and removable like the typed ones, and the page
    creates all of them together once there is a trip.

    That replaces a queue of "2 people from Family" chips sitting below the
    guest list. It read as two kinds of guest, and it was not one: the same
    people, split across two places, one of which could not be edited.
  */
  const formRef = useRef<TripFormHandle>(null);
  const [isGroupPickerOpen, setIsGroupPickerOpen] = useState(false);

  const handleOpenGroupPicker = useCallback(() => {
    setIsGroupPickerOpen(true);
  }, []);

  const handleGroupsSelected = useCallback(
    (selections: readonly GuestGroupSelection[]) => {
      formRef.current?.addGuests(
        selections.flatMap(({ group, memberIds }) =>
          group.members
            .filter((member) => memberIds.includes(member.id))
            .map((member) => ({
              sourceMemberId: member.id,
              name: member.name,
              color: member.color,
              ...(member.headcount === undefined ? {} : { headcount: member.headcount }),
              ...(member.notes === undefined ? {} : { notes: member.notes }),
              ...(member.phone === undefined ? {} : { phone: member.phone }),
            })),
        ),
      );
    },
    [],
  );

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  /**
   * Tracks the import source trip ID from TripForm.
   */
  const handleImportSourceChange = useCallback((sourceTripId: TripId | null) => {
    importSourceRef.current = sourceTripId;
  }, []);

  /**
   * Tracks the guest list TripForm is holding — typed rows and imported ones
   * alike, since the form keeps them in one list.
   *
   * A ref rather than state, like the import source above: nothing renders off
   * it, and re-rendering the page on every keystroke in the guest list would
   * cost the form its own state.
   */
  const handleGuestsChange = useCallback((guests: readonly NewTripGuest[]) => {
    guestsRef.current = guests;
  }, []);

  /**
   * Tracks the room list TripForm is holding, for the same reasons as the
   * guests above: rooms are not a trip field, and a ref keeps the keystrokes
   * out of this page's render.
   */
  const handleRoomsChange = useCallback((rooms: readonly NewTripRoom[]) => {
    roomsRef.current = rooms;
  }, []);

  // ============================================================================
  // Submission Handler
  // ============================================================================

  /**
   * Submission handler that creates the trip and navigates on success.
   * TripForm handles its own useFormSubmission internally — this is the
   * business logic callback passed as onSubmit.
   */
  const handleSubmit = useCallback(
    async (data: TripFormData): Promise<void> => {
      // The writes are shared with the first-trip wizard; see
      // `lib/create-trip-with-details`. What is left here is what the form
      // says about them.
      const outcome = await createTripWithDetails({
        form: data,
        guests: guestsRef.current,
        rooms: roomsRef.current,
        importSourceTripId: importSourceRef.current,
      });

      // The trip exists either way, so each of these is a warning rather than
      // a rolled-back creation.
      const warningMessages: Record<TripCreationWarning, string> = {
        'rooms-import': t('trips.importRoomsFailed', 'Trip created but room import failed'),
        guests: t('trips.guestsCreateFailed', 'Trip created but some guests could not be added'),
        rooms: t('trips.roomsCreateFailed', 'Trip created but some rooms could not be added'),
        // Same message the settings picker shows, because it is the same failure.
        identity: t(
          'sharing.identityStorageFailed',
          'Could not save your identity. You may need to re-select on your next visit.',
        ),
      };
      for (const warning of outcome.warnings) {
        notify.error(warningMessages[warning]);
      }

      captureUsage('trip_created', {
        via: 'form',
        imported_rooms: outcome.counts.importedRooms,
        guest_count: outcome.counts.guests,
        imported_guests: outcome.counts.importedGuests,
        room_count: outcome.counts.rooms,
      });

      // Reset dirty state and skip blocker before navigation.
      // skipNextBlock() prevents the blocker from firing if setIsDirty(false)
      // hasn't re-rendered yet when navigate() executes.
      setIsDirty(false);
      skipNextBlock();

      // Offline-aware, like every other entity: a trip created on a train is
      // saved on this device and not yet anywhere else, and the confirmation says so.
      if (outcome.counts.importedRooms) {
        notifySuccess(t('trips.createdWithImport', 'Trip created with rooms imported'));
      } else if (!importSourceRef.current) {
        notifySuccess(t('trips.created', 'Trip created successfully'));
      }

      // Navigate to the new trip's calendar
      navigate(`/trips/${outcome.trip.id}/calendar`);
    },
    [navigate, skipNextBlock, notifySuccess, t],
  );

  const handleWizardCreating = useCallback((): void => {
    setWizardBusy(true);
  }, []);

  /**
   * The wizard's way out: it has already created the trip and celebrated.
   *
   * The trip is selected here rather than at creation — see `selectAsCurrent`
   * in `lib/create-trip-with-details` — so the wizard survives to its done
   * screen.
   */
  const handleWizardCreated = useCallback(
    async (trip: Trip): Promise<void> => {
      setIsDirty(false);
      skipNextBlock();
      await setCurrentTrip(trip.id);
      navigate(`/trips/${trip.id}/calendar`);
    },
    [navigate, skipNextBlock],
  );

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles cancel action by navigating back to trips list.
   * Reset dirty state first so the unsaved changes dialog doesn't appear.
   */
  const handleCancel = useCallback(() => {
    setIsDirty(false);
    skipNextBlock();
    navigate('/trips');
  }, [navigate, skipNextBlock]);

  // ============================================================================
  // Render
  // ============================================================================

  if (decidingWizard) {
    return (
      <div className="container mx-auto max-w-2xl py-6 md:py-8">
        <PageHeader title={t('trips.new')} backLink="/trips" />
        <LoadingState variant="inline" />
      </div>
    );
  }

  if (showWizard) {
    return (
      <div className="container mx-auto max-w-2xl py-6 md:py-8">
        <PageHeader title={t('trips.wizard.title', 'Your first trip')} backLink="/trips" />
        <Card>
          <CardContent className="pt-6">
            <TripCreateWizard
              currentUserName={currentUserName}
              onCreating={handleWizardCreating}
              onCreated={(trip) => void handleWizardCreated(trip)}
              onCancel={handleCancel}
              onDirtyChange={handleDirtyChange}
            />
          </CardContent>
        </Card>
        <UnsavedChangesDialog open={isBlocked} onStay={reset} onLeave={proceed} />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-6 md:py-8">
      <PageHeader title={t('trips.new')} backLink="/trips" />

      <Card>
        <CardContent className="pt-6">
          <TripForm
            ref={formRef}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onDirtyChange={handleDirtyChange}
            onImportSourceChange={handleImportSourceChange}
            currentUserName={currentUserName}
            onGuestsChange={handleGuestsChange}
            onRoomsChange={handleRoomsChange}
          >
            {/*
              One button, and no queue beside it: whatever the picker returns
              goes into the guest list above as ordinary rows. What the user
              picked is then visible in the one place they are already reading.
            */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenGroupPicker}
            >
              <UsersRound className="size-4" aria-hidden="true" />
              {t('guestGroups.importAction', 'Add from a group')}
            </Button>
          </TripForm>
        </CardContent>
      </Card>

      <GuestGroupImportDialog
        open={isGroupPickerOpen}
        onOpenChange={setIsGroupPickerOpen}
        onConfirm={handleGroupsSelected}
      />

      <UnsavedChangesDialog open={isBlocked} onStay={reset} onLeave={proceed} />
    </div>
  );
});
