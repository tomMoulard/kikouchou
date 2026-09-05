/**
 * @fileoverview Trip Create Page for creating new vacation trips.
 * Provides a form interface to create trips with navigation and toast feedback.
 *
 * @module features/trips/pages/TripCreatePage
 */

import { type ReactElement, memo, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { UsersRound } from 'lucide-react';
import { useOfflineAwareToast, useUnsavedChanges } from '@/hooks';

import { PageHeader } from '@/components/shared/PageHeader';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  TripForm,
  type NewTripGuest,
  type TripFormHandle,
} from '@/features/trips/components/TripForm';
import { useAuth } from '@/features/auth/AuthContext';
import { getAccountGuestName } from '@/features/auth/display-name';
import {
  GuestGroupImportDialog,
  type GuestGroupSelection,
} from '@/features/guest-groups';
import {
  createTrip,
  setCurrentTrip,
  cloneRoomsToTrip,
  createPerson,
  createPersonWithAutoColor,
} from '@/lib/db';
import { captureUsage } from '@/lib/posthog';
import type { TripFormData, TripId } from '@/types';

// ============================================================================
// Component
// ============================================================================

/**
 * Page component for creating a new trip.
 *
 * Features:
 * - Uses TripForm component for form UI and validation
 * - Shows toast notifications on success/error
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
  const { successToast } = useOfflineAwareToast();
  const { user } = useAuth();

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
      const newTrip = await createTrip(data);

      // Validate trip was created with valid ID (defensive check for database quirks)
      if (!newTrip?.id) {
        throw new Error('Trip creation failed: missing trip ID');
      }

      // Clone rooms from import source if one was selected
      let didImportRooms = false;
      if (importSourceRef.current) {
        try {
          await cloneRoomsToTrip(importSourceRef.current, newTrip.id);
          didImportRooms = true;
        } catch (error) {
          console.error('Failed to clone rooms from import source:', error);
          // Trip is created — show warning but don't block navigation
          toast.error(t('trips.importRoomsFailed', 'Trip created but room import failed'));
        }
      }

      /*
        Add the guests the form collected, one at a time and in list order.

        One loop for the whole list, typed and imported alike: they are the same
        list on screen and there is no reason for them to be two here. A guest
        that came from a saved group brings its own colour and whatever else was
        stored with it; a typed one gets a colour from the palette.

        Sequential on purpose: `createPersonWithAutoColor` picks its colour from
        the trip's *current* person count, so a `Promise.all` over the list
        would read the same count in every call and hand every guest the same
        colour — on a feature whose entire job is telling guests apart.
      */
      const guests = guestsRef.current;
      let addedGuestCount = 0,
        importedGuestCount = 0;

      for (const guest of guests) {
        try {
          if (guest.color) {
            await createPerson(newTrip.id, {
              name: guest.name,
              color: guest.color,
              ...(guest.headcount === undefined ? {} : { headcount: guest.headcount }),
              ...(guest.notes === undefined ? {} : { notes: guest.notes }),
              ...(guest.phone === undefined ? {} : { phone: guest.phone }),
            });
            importedGuestCount += 1;
          } else {
            await createPersonWithAutoColor(newTrip.id, guest.name);
          }
          addedGuestCount += 1;
        } catch (error) {
          console.error('Failed to add guest to new trip:', error);
        }
      }

      // The trip exists either way, so a failed guest is a warning rather than
      // a rolled-back creation — the same call the room import above makes.
      if (addedGuestCount < guests.length) {
        toast.error(t('trips.guestsCreateFailed', 'Trip created but some guests could not be added'));
      }

      // Set the new trip as the current trip so CalendarPage can display it
      await setCurrentTrip(newTrip.id);

      captureUsage('trip_created', {
        imported_rooms: didImportRooms,
        guest_count: addedGuestCount,
        imported_guests: importedGuestCount,
      });

      // Reset dirty state and skip blocker before navigation.
      // skipNextBlock() prevents the blocker from firing if setIsDirty(false)
      // hasn't re-rendered yet when navigate() executes.
      setIsDirty(false);
      skipNextBlock();

      // Offline-aware, like every other entity: a trip created on a train is
      // saved on this device and not yet anywhere else, and the toast says so.
      if (didImportRooms) {
        successToast(t('trips.createdWithImport', 'Trip created with rooms imported'));
      } else if (!importSourceRef.current) {
        successToast(t('trips.created', 'Trip created successfully'));
      }

      // Navigate to the new trip's calendar
      navigate(`/trips/${newTrip.id}/calendar`);
    },
    [navigate, skipNextBlock, successToast, t],
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

  return (
    <div className="container max-w-2xl py-6 md:py-8">
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
