/**
 * @fileoverview Identity Selection Step — Step 2 of the guest onboarding wizard.
 * Allows guests to select themselves from the participant list or add themselves
 * as a new participant. Stores selected identity in localStorage before advancing.
 *
 * @module features/sharing/pages/IdentityStepPage
 *
 * Route: /share/:shareId/identity
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Palmtree } from 'lucide-react';
import { toast } from 'sonner';

import { LoadingState } from '@/components/shared/LoadingState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import {
  createPersonWithAutoColor,
  getPersonsByTripId,
  getTripByShareId,
} from '@/lib/db';
import type { Person, PersonId, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * URL parameters for the identity step route.
 */
type IdentityStepParams = {
  /** The share ID from the URL */
  shareId: string;
};

/**
 * Shape of the guest identity stored in localStorage.
 */
interface StoredGuestIdentity {
  personId: string;
  tripId: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Returns the localStorage key used to persist guest identity across visits.
 *
 * @param shareId - The share ID from the URL
 * @returns The localStorage key string
 */
const getGuestStorageKey = (shareId: string): string =>
  `kikoushou_guest_${shareId}`;

// ============================================================================
// Component
// ============================================================================

/**
 * Identity selection step for the guest onboarding wizard.
 *
 * Features:
 * - Lists all trip participants as selectable cards with name + color swatch
 * - Selected state shown with ring highlight and checkmark
 * - Inline "Add myself" form for guests not in the list
 * - Stores identity to localStorage on "Next" and navigates to room step
 * - Uses repository-only data access (AR-10 — outside AppProviders)
 * - Uses isMountedRef + cancelled-flag pattern for async safety
 *
 * @returns The identity step page element
 *
 * @example
 * ```tsx
 * // In router configuration
 * <Route path="/share/:shareId/identity" element={<IdentityStepPage />} />
 * ```
 */
export const IdentityStepPage = memo(function IdentityStepPage(): ReactElement {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { shareId } = useParams<IdentityStepParams>();

  // ============================================================================
  // State
  // ============================================================================

  const [trip, setTrip] = useState<Trip | null>(null);
  const [persons, setPersons] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<PersonId | undefined>();

  // Inline "add myself" form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [isAdding, setIsAdding] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  // ============================================================================
  // Refs for Async Operation Safety
  // ============================================================================

  /**
   * Tracks whether the component is still mounted.
   * Used to prevent state updates after unmount.
   */
  const isMountedRef = useRef(true);

  /**
   * Prevents double-submission of the "Add myself" form.
   */
  const isSubmittingRef = useRef(false);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Cleanup effect to track component unmount.
   */
  useEffect(() => () => {
      isMountedRef.current = false;
    }, []);

  /**
   * Load trip and participants when shareId changes.
   * Uses cancelled flag pattern to prevent stale updates.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadData(): Promise<void> {
      if (!shareId) {
        if (!cancelled && isMountedRef.current) {
          setNotFound(true);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        const tripData = await getTripByShareId(shareId as ShareId);
        if (cancelled || !isMountedRef.current) return;
        if (!tripData) {
          setNotFound(true);
          return;
        }

        const personsData = await getPersonsByTripId(tripData.id as TripId);
        if (cancelled || !isMountedRef.current) return;

        setTrip(tripData);
        setPersons(personsData);
      } catch (error) {
        console.error('Failed to load identity step data:', error);
        if (!cancelled && isMountedRef.current) setNotFound(true);
      } finally {
        if (!cancelled && isMountedRef.current) setIsLoading(false);
      }
    }

    void loadData();
    return () => { cancelled = true; };
  }, [shareId]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Selects a participant card.
   */
  const handleSelectPerson = useCallback((personId: PersonId): void => {
    setSelectedPersonId(personId);
  }, []);

  /**
   * Toggles the "Add myself" inline form.
   */
  const handleToggleAddForm = useCallback((): void => {
    setShowAddForm(prev => !prev);
    setNameError(undefined);
    setNewName('');
  }, []);

  /**
   * Submits the "Add myself" form — creates a new participant with auto-assigned color.
   */
  const handleAddMyself = useCallback(async (): Promise<void> => {
    if (isSubmittingRef.current || !trip) return;
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setNameError(t('sharing.identityNameRequired', 'Please enter your name'));
      return;
    }
    setNameError(undefined);
    isSubmittingRef.current = true;
    setIsAdding(true);
    try {
      const person = await createPersonWithAutoColor(trip.id as TripId, trimmedName);
      if (isMountedRef.current) {
        setPersons(prev => [...prev, person]);
        setSelectedPersonId(person.id);
        setShowAddForm(false);
        setNewName('');
      }
    } catch (error) {
      console.error('Failed to create person:', error);
      if (isMountedRef.current) toast.error(t('errors.saveFailed', 'Failed to save'));
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) setIsAdding(false);
    }
  }, [newName, trip, t]);

  /**
   * Handles the "Next" button — writes identity to localStorage and navigates.
   */
  const handleNext = useCallback((): void => {
    if (!selectedPersonId || !trip || isNavigating || !shareId) return;

    setIsNavigating(true);
    try {
      const identity: StoredGuestIdentity = {
        personId: selectedPersonId,
        tripId: trip.id,
      };
      try {
        localStorage.setItem(getGuestStorageKey(shareId), JSON.stringify(identity));
      } catch {
        // Non-fatal: if localStorage write fails, continue anyway.
        // Returning-guest detection in Story 2.1 won't work, but wizard can proceed.
        console.warn('Failed to save guest identity to localStorage');
      }

      if (isMountedRef.current) {
        navigate(`/share/${shareId}/room`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsNavigating(false);
      }
    }
  }, [selectedPersonId, trip, isNavigating, shareId, navigate]);

  // ============================================================================
  // Render
  // ============================================================================

  // Loading state
  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  // Not found / error state — friendly message, no technical jargon
  if (notFound || !trip) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50 p-4">
        <Card className="w-full max-w-md border-amber-200 text-center shadow-lg">
          <CardHeader className="pb-2 pt-8">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-amber-100 text-3xl">
              🔍
            </div>
            <CardTitle className="text-xl text-amber-900">
              {t('sharing.notFoundWizard', "This trip link doesn't seem to work")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-8">
            <p className="text-sm text-amber-700">
              {t(
                'sharing.notFoundWizardDescription',
                'The link may be incorrect or the trip may no longer exist.',
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isEmpty = persons.length === 0;

  return (
    <div className="flex min-h-svh items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50 p-4">
      <Card className="w-full max-w-md border-amber-200 shadow-lg">
        <CardHeader className="pb-4 pt-8 text-center">
          {/* Warm vacation icon */}
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-amber-100">
            <Palmtree className="size-10 text-amber-600" aria-hidden="true" />
          </div>

          <CardTitle className="text-2xl font-bold text-amber-900">
            {t('sharing.identityTitle', 'Who are you?')}
          </CardTitle>

          <p className="mt-1 text-sm text-amber-700">
            {t('sharing.identitySubtitle', 'Select yourself from the list below')}
          </p>
        </CardHeader>

        <CardContent className="space-y-4 pb-8">
          {/* Empty list state — show add form prominently */}
          {isEmpty ? (
            <p className="rounded-xl bg-amber-50 p-4 text-center text-sm text-amber-700 ring-1 ring-amber-200">
              {t('sharing.identityEmptyList', 'No guests yet. Add yourself to get started!')}
            </p>
          ) : (
            /* Participant card list */
            <div className="space-y-2">
              {persons.map((person) => {
                const isSelected = selectedPersonId === person.id;
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => { handleSelectPerson(person.id); }}
                    aria-pressed={isSelected}
                    aria-label={isSelected
                      ? `${person.name} — ${t('sharing.identitySelected', 'Selected')}`
                      : person.name}
                    className={[
                      'flex w-full min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border-2 p-4 text-left transition-colors',
                      isSelected
                        ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-500'
                        : 'border-amber-200 bg-white hover:border-amber-300',
                    ].join(' ')}
                  >
                    {/* Color swatch */}
                    <span
                      className="size-8 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: person.color }}
                      aria-hidden="true"
                    />
                    {/* Person name */}
                    <span className="flex-1 font-medium text-amber-900">
                      {person.name}
                    </span>
                    {/* Checkmark for selected state */}
                    {isSelected && (
                      <Check className="size-5 text-amber-600" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* "I'm not on the list" section */}
          {!isEmpty && !showAddForm && (
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full text-amber-700 hover:bg-amber-50 hover:text-amber-900"
              onClick={handleToggleAddForm}
            >
              {t('sharing.identityNotOnList', "I'm not on the list")}
            </Button>
          )}

          {/* Inline "Add myself" form — shown when empty list or when toggled */}
          {(isEmpty || showAddForm) && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="space-y-1">
                <Input
                  id="new-person-name"
                  type="text"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (nameError) setNameError(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAddMyself();
                    }
                  }}
                  placeholder={t('sharing.identityAddName', 'Your name')}
                  aria-label={t('sharing.identityAddName', 'Your name')}
                  aria-invalid={nameError !== undefined}
                  aria-describedby={nameError !== undefined ? 'name-error' : undefined}
                  className="border-amber-300 bg-white focus-visible:ring-amber-500"
                  autoComplete="given-name"
                />
                {nameError !== undefined && (
                  <p id="name-error" role="alert" className="text-xs text-destructive">
                    {nameError}
                  </p>
                )}
              </div>
              <Button
                type="button"
                onClick={() => { void handleAddMyself(); }}
                disabled={isAdding}
                className="h-11 w-full bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                {isAdding
                  ? t('sharing.identityAdding', 'Adding...')
                  : t('sharing.identityAddMyself', 'Add myself')}
              </Button>
            </div>
          )}

          {/* "Next" CTA — only enabled when a person is selected */}
          <Button
            type="button"
            onClick={handleNext}
            disabled={!selectedPersonId || isNavigating}
            className="h-12 w-full bg-amber-500 text-base font-semibold text-white hover:bg-amber-600 focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-40"
          >
            {isNavigating
              ? t('common.loading', 'Loading...')
              : t('sharing.identityNext', 'Next')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
});

export default IdentityStepPage;
