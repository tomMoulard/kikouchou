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
import { Check, Palmtree, SearchX } from 'lucide-react';
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
import { onboardingSurface, statusVariants } from '@/components/ui/status.variants';

import {
  createPersonWithAutoColor,
  getPersonsByTripId,
  getTripByShareId,
} from '@/lib/db';
import { cn } from '@/lib/utils';
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
 * Uses unbranded `string` types intentionally — localStorage serialises to JSON
 * and the branded `PersonId`/`TripId` brands are for in-memory type safety only.
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
  `kikouchou_guest_${shareId}`;

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
  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false
    // forever, silently turning every guarded setState into a no-op.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Load trip and participants when shareId changes.
   * Uses cancelled flag pattern to prevent stale updates.
   */
  useEffect(() => {
    let cancelled = false;

    // Reset selection state so a stale personId from a previous shareId cannot
    // be carried forward if the URL param ever changes.
    setSelectedPersonId(undefined);
    setTrip(null);
    setPersons([]);
    setNotFound(false);

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
    setShowAddForm(prev => {
      const opening = !prev;
      if (opening) {
        // Reset draft only when opening so a user who accidentally closes the
        // form and re-opens it does not lose in-progress input.
        setNameError(undefined);
        setNewName('');
      }
      return opening;
    });
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
        // Non-fatal: wizard can still proceed, but returning-guest detection
        // in Story 2.1 won't work for this session.
        console.warn('Failed to save guest identity to localStorage');
        toast.error(t('sharing.identityStorageFailed', 'Could not save your identity. You may need to re-select on your next visit.'));
      }

      if (isMountedRef.current) {
        navigate(`/share/${shareId}/room`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsNavigating(false);
      }
    }
  }, [selectedPersonId, trip, isNavigating, shareId, navigate, t]);

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
      <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
        <Card className="w-full max-w-md border-warning-border text-center shadow-lg">
          <CardHeader className="pb-2 pt-8">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-warning/20">
              <SearchX className="size-8 text-warning-on-surface" aria-hidden="true" />
            </div>
            <CardTitle className="text-xl text-warning-on-surface">
              {t('sharing.notFoundWizard', "This trip link doesn't seem to work")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-8">
            <p className="text-sm text-muted-foreground">
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
    <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
      <Card className="w-full max-w-md border-warning-border shadow-lg">
        <CardHeader className="pb-4 pt-8 text-center">
          {/* Warm vacation icon */}
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-warning/20">
            <Palmtree
              className={cn('size-10', statusVariants({ tone: 'warning', emphasis: 'text' }))}
              aria-hidden="true"
            />
          </div>

          <CardTitle className="text-2xl font-bold text-warning-on-surface">
            {t('sharing.identityTitle', 'Who are you?')}
          </CardTitle>

          <p className="mt-1 text-sm text-muted-foreground">
            {t('sharing.identitySubtitle', 'Select yourself from the list below')}
          </p>
        </CardHeader>

        <CardContent className="space-y-4 pb-8">
          {/* Empty list state — show add form prominently */}
          {isEmpty ? (
            <p className={cn('rounded-xl p-4 text-center text-sm', statusVariants({ tone: 'warning' }))}>
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
                    className={cn(
                      'flex w-full min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border-2 p-4 text-left transition-colors',
                      isSelected
                        ? 'border-warning bg-warning-surface ring-2 ring-warning'
                        : 'border-warning-border bg-card hover:border-warning',
                    )}
                  >
                    {/* Color swatch */}
                    <span
                      className="size-8 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: person.color }}
                      aria-hidden="true"
                    />
                    {/* Person name */}
                    <span className="flex-1 font-medium text-foreground">
                      {person.name}
                    </span>
                    {/* Checkmark for selected state */}
                    {isSelected && (
                      <Check
                        className={cn('size-5', statusVariants({ tone: 'warning', emphasis: 'text' }))}
                        aria-hidden="true"
                      />
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
              className="h-11 w-full text-warning-on-surface hover:bg-warning-surface hover:text-warning-on-surface dark:hover:bg-warning-surface dark:hover:text-warning-on-surface"
              onClick={handleToggleAddForm}
            >
              {t('sharing.identityNotOnList', "I'm not on the list")}
            </Button>
          )}

          {/* Inline "Add myself" form — shown when empty list or when toggled */}
          {(isEmpty || showAddForm) && (
            <div className={cn('space-y-3 rounded-xl p-4', statusVariants({ tone: 'warning', emphasis: 'surface' }))}>
              <div className="space-y-1">
                <label
                  htmlFor="new-person-name"
                  className="sr-only"
                >
                  {t('sharing.identityAddName', 'Your name')}
                </label>
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
                  aria-invalid={nameError !== undefined ? 'true' : 'false'}
                  aria-describedby={nameError !== undefined ? 'name-error' : undefined}
                  className="border-warning-border bg-card dark:border-warning-border dark:bg-card"
                  autoComplete="given-name"
                  maxLength={100}
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
                className={cn(
                  'h-11 w-full',
                  statusVariants({ tone: 'warning', emphasis: 'solid' }),
                )}
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
            className={cn(
              'h-12 w-full text-base font-semibold disabled:opacity-40',
              statusVariants({ tone: 'warning', emphasis: 'solid' }),
            )}
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
