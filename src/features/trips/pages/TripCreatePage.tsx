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
import { UsersRound, X } from 'lucide-react';
import { useOfflineAwareToast, useUnsavedChanges } from '@/hooks';

import { PageHeader } from '@/components/shared/PageHeader';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TripForm } from '@/features/trips/components/TripForm';
import { useAuth } from '@/features/auth/AuthContext';
import { getAccountGuestName } from '@/features/auth/display-name';
import {
  GuestGroupImportDialog,
  useGuestGroups,
  type GuestGroupSelection,
} from '@/features/guest-groups';
import {
  createTrip,
  setCurrentTrip,
  cloneRoomsToTrip,
  createPersonWithAutoColor,
} from '@/lib/db';
import { captureUsage } from '@/lib/posthog';
import type { GuestGroupId, TripFormData, TripId } from '@/types';

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
  const guestNamesRef = useRef<readonly string[]>([]);

  // ============================================================================
  // Guest Group Selection
  // ============================================================================

  /*
    The trip does not exist yet, so the picker cannot write. Selections are
    parked here and `handleSubmit` replays them once there is a trip to write
    into — the same shape the room import beside it already uses.

    A list, not one slot: "two families and the neighbours" is an ordinary trip,
    and a single slot would silently replace the first group the moment a second
    was picked.
  */
  const { importMembers } = useGuestGroups();
  const [isGroupPickerOpen, setIsGroupPickerOpen] = useState(false);
  const [pendingGroups, setPendingGroups] = useState<readonly GuestGroupSelection[]>([]);

  const handleOpenGroupPicker = useCallback(() => {
    setIsGroupPickerOpen(true);
  }, []);

  /**
   * Takes what the picker returned as the complete set.
   *
   * The picker is seeded with what is already pending, so it edits the queue
   * rather than appending to it — which is what lets somebody un-tick a person
   * from a group they added a moment ago instead of removing the whole group
   * and starting again.
   */
  const handleGroupsSelected = useCallback((selections: readonly GuestGroupSelection[]) => {
    setPendingGroups(selections);
  }, []);

  const handleClearGroup = useCallback((groupId: GuestGroupId) => {
    setPendingGroups((prev) => prev.filter((entry) => entry.group.id !== groupId));
  }, []);

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
   * Tracks the guest names typed into TripForm's list.
   *
   * A ref rather than state, like the import source above: nothing renders off
   * it, and re-rendering the page on every keystroke in the guest list would
   * cost the form its own state.
   */
  const handleGuestsChange = useCallback((guestNames: readonly string[]) => {
    guestNamesRef.current = guestNames;
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

        Sequential on purpose: `createPersonWithAutoColor` picks its colour from
        the trip's *current* person count, so a `Promise.all` over the list
        would read the same count in every call and hand every guest the same
        colour — on a feature whose entire job is telling guests apart.
      */
      const guestNames = guestNamesRef.current;
      let addedGuestCount = 0;
      for (const guestName of guestNames) {
        try {
          await createPersonWithAutoColor(newTrip.id, guestName);
          addedGuestCount += 1;
        } catch (error) {
          console.error('Failed to add guest to new trip:', error);
        }
      }

      // The trip exists either way, so a failed guest is a warning rather than
      // a rolled-back creation — the same call the room import above makes.
      if (addedGuestCount < guestNames.length) {
        toast.error(t('trips.guestsCreateFailed', 'Trip created but some guests could not be added'));
      }

      /*
        And the saved groups the user picked before the trip existed — several
        of them, because a trip is often two families rather than one.

        One group failing does not abandon the rest: each is a separate
        transaction, and the trip is already real, so the failure posture
        matches the room clone and the guest loop above.
      */
      let importedGuestCount = 0;
      let failedGroupCount = 0;
      for (const selection of pendingGroups) {
        try {
          const result = await importMembers(
            newTrip.id,
            selection.group.id,
            selection.memberIds,
          );
          importedGuestCount += result.persons.length;
        } catch (error) {
          console.error('Failed to import guest group into the new trip:', error);
          failedGroupCount += 1;
        }
      }

      if (failedGroupCount > 0) {
        toast.error(t('guestGroups.importFailed', "Could not add the group's guests"));
      }

      // Set the new trip as the current trip so CalendarPage can display it
      await setCurrentTrip(newTrip.id);

      captureUsage('trip_created', {
        imported_rooms: didImportRooms,
        guest_count: addedGuestCount,
        imported_guests: importedGuestCount,
        imported_groups: pendingGroups.length,
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
    [importMembers, navigate, pendingGroups, skipNextBlock, successToast, t],
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
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onDirtyChange={handleDirtyChange}
            onImportSourceChange={handleImportSourceChange}
            currentUserName={currentUserName}
            onGuestsChange={handleGuestsChange}
          >
            {/*
              Saved groups queued for this trip. A list rather than a single
              slot: a trip is often two families, and replacing the first the
              moment a second is picked is the shape of that bug.

              No label of its own — the form's guest fieldset already carries
              one, and these rows are guests by another route.
            */}
            {pendingGroups.length > 0 && (
              <ul className="space-y-2">
                {pendingGroups.map((selection) => (
                  <li
                    key={selection.group.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-3"
                  >
                    <span className="text-sm">
                      {t('guestGroups.importPending', '{{count}} people from {{name}}', {
                        count: selection.memberIds.length,
                        name: selection.group.name,
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleClearGroup(selection.group.id)}
                      aria-label={t('guestGroups.importClearNamed', 'Remove {{name}}', {
                        name: selection.group.name,
                      })}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenGroupPicker}
            >
              <UsersRound className="size-4" aria-hidden="true" />
              {pendingGroups.length > 0
                ? t('guestGroups.importMore', 'Add another group')
                : t('guestGroups.importAction', 'Add from a group')}
            </Button>
          </TripForm>
        </CardContent>
      </Card>

      <GuestGroupImportDialog
        open={isGroupPickerOpen}
        onOpenChange={setIsGroupPickerOpen}
        onConfirm={handleGroupsSelected}
        initialSelection={pendingGroups}
        confirmLabel={t('guestGroups.importSelect', 'Choose people')}
      />

      <UnsavedChangesDialog open={isBlocked} onStay={reset} onLeave={proceed} />
    </div>
  );
});
