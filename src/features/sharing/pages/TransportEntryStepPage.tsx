/**
 * @fileoverview Transport Entry Step — Step 4 of the guest onboarding wizard.
 * Allows guests to enter their arrival and departure details, including
 * datetime, location, transport mode, and whether they need a pickup.
 *
 * @module features/sharing/pages/TransportEntryStepPage
 *
 * Route: /share/:shareId/transport
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
import { Check, Plus, SearchX, Train } from 'lucide-react';

import { LoadingState } from '@/components/shared/LoadingState';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { onboardingSurface, statusVariants } from '@/components/ui/status.variants';

import {
  createTransport,
  getTransportsByPersonId,
  getTripByShareId,
} from '@/lib/db';
import { toCanonicalDatetime } from '@/lib/db/transport-datetime';
import { cn } from '@/lib/utils';
import type {
  PersonId,
  ShareId,
  Transport,
  TransportFormData,
  TransportMode,
  TransportType,
  Trip,
} from '@/types';
import { formatDatetime, getTransportIcon } from '../components/transport-display-helpers';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * URL parameters for the transport entry step route.
 */
type TransportEntryStepParams = {
  /** The share ID from the URL */
  shareId: string;
};

/**
 * Form validation errors.
 */
interface FormErrors {
  datetime?: string;
  location?: string;
  submit?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Returns the localStorage key used to persist guest identity.
 *
 * @param shareId - The share ID from the URL
 * @returns The localStorage key string
 */
const getGuestStorageKey = (shareId: string): string =>
  `kikouchou_guest_${shareId}`;

/**
 * Available transport modes for the select dropdown.
 */
const TRANSPORT_MODES: readonly TransportMode[] = [
  'train',
  'plane',
  'car',
  'bus',
  'other',
] as const;


// ============================================================================
// Component
// ============================================================================

/**
 * Transport entry step for the guest onboarding wizard.
 *
 * Features:
 * - Guards against missing identity (redirects to identity step)
 * - Loads trip and existing transports on mount
 * - Compact form with type toggle, datetime, location, mode, number, pickup switch
 * - Shows already-entered transports as summary cards above the form
 * - "Add another" flow: after submit, form resets with opposite type pre-selected
 * - "Skip for now" navigates to summary step without creating transports
 * - Uses repository-only data access (AR-10 — outside AppProviders)
 * - Uses isMountedRef + cancelled-flag pattern for async safety
 *
 * @returns The transport entry step page element
 *
 * @example
 * ```tsx
 * // In router configuration
 * <Route path="/share/:shareId/transport" element={<TransportEntryStepPage />} />
 * ```
 */
export const TransportEntryStepPage = memo(function TransportEntryStepPage(): ReactElement {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { shareId } = useParams<TransportEntryStepParams>();

  // ============================================================================
  // State
  // ============================================================================

  const [trip, setTrip] = useState<Trip | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  /** The personId of the guest retrieved from localStorage */
  const [guestPersonId, setGuestPersonId] = useState<PersonId | undefined>();
  /**
   * The tripId from the stored identity, kept as a ref so the load effect
   * can cross-check it without re-running when it changes.
   */
  const storedTripIdRef = useRef<string | undefined>(undefined);

  /** Transports already entered by the guest */
  const [enteredTransports, setEnteredTransports] = useState<Transport[]>([]);

  /** Form state */
  const [transportType, setTransportType] = useState<TransportType>('arrival');
  const [datetime, setDatetime] = useState('');
  const [location, setLocation] = useState('');
  const [transportMode, setTransportMode] = useState<TransportMode | ''>('');
  const [transportNumber, setTransportNumber] = useState('');
  const [needsPickup, setNeedsPickup] = useState(false);

  /** Form validation errors */
  const [errors, setErrors] = useState<FormErrors>({});

  /** Whether form is currently submitting */
  const [isSubmitting, setIsSubmitting] = useState(false);

  /** Brief success indicator after adding transport */
  const [showSuccess, setShowSuccess] = useState(false);

  /** Timer ref for success indicator cleanup */
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ============================================================================
  // Refs for Async Operation Safety
  // ============================================================================

  /**
   * Tracks whether the component is still mounted.
   * Used to prevent state updates after unmount.
   */
  const isMountedRef = useRef(true);

  /**
   * Prevents double-submission of the form.
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
      if (successTimerRef.current !== undefined) clearTimeout(successTimerRef.current);
    };
  }, []);

  /**
   * Guard: read guest identity from localStorage on mount.
   * If missing or malformed, redirect to the identity step.
   */
  useEffect(() => {
    if (!shareId) return;

    const stored = localStorage.getItem(getGuestStorageKey(shareId));
    if (!stored) {
      navigate(`/share/${shareId}/identity`, { replace: true });
      return;
    }
    try {
      const identity = JSON.parse(stored) as { personId: string; tripId: string };
      // Trim and validate — whitespace-only strings are treated as missing
      if (!identity.personId?.trim() || !identity.tripId?.trim()) {
        navigate(`/share/${shareId}/identity`, { replace: true });
        return;
      }
      setGuestPersonId(identity.personId.trim() as PersonId);
      storedTripIdRef.current = identity.tripId.trim();
    } catch {
      navigate(`/share/${shareId}/identity`, { replace: true });
    }
  }, [shareId, navigate]);

  /**
   * Load trip and existing transports when shareId and guestPersonId are available.
   * Uses cancelled flag pattern to prevent stale updates.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadData(): Promise<void> {
      if (!shareId || !guestPersonId) {
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

        // Cross-validate stored identity tripId against the loaded trip.
        // A stale identity from a different trip must not be used here.
        if (storedTripIdRef.current !== undefined && storedTripIdRef.current !== tripData.id) {
          // Clear the stale identity and send the user back to identify themselves
          try { localStorage.removeItem(getGuestStorageKey(shareId)); } catch { /* non-fatal */ }
          navigate(`/share/${shareId}/identity`, { replace: true });
          return;
        }

        setTrip(tripData);

        // Load existing transports for this guest
        try {
          const existing = await getTransportsByPersonId(guestPersonId);
          if (!cancelled && isMountedRef.current) {
            // Filter to only this trip's transports
            setEnteredTransports(existing.filter((t) => t.tripId === tripData.id));
          }
        } catch (fetchError) {
          console.error('Failed to load existing transports:', fetchError);
          // Non-fatal — continue without existing transports
        }
      } catch (error) {
        console.error('Failed to load transport entry data:', error);
        if (!cancelled && isMountedRef.current) setNotFound(true);
      } finally {
        if (!cancelled && isMountedRef.current) setIsLoading(false);
      }
    }

    void loadData();
    return () => { cancelled = true; };
  }, [shareId, guestPersonId, navigate]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles form submission to create a new transport.
   */
  const handleSubmit = useCallback(async (): Promise<void> => {
    if (isSubmittingRef.current || !trip || !guestPersonId) return;

    // Inline validation. The datetime-local input yields a local wall clock
    // with no offset ("2026-09-03T14:30"); normalising here is what stops that
    // string reaching storage, where it would sort and bucket as characters
    // rather than as an instant.
    const instant = toCanonicalDatetime(datetime),
      newErrors: FormErrors = {};
    if (instant === undefined) {
      newErrors.datetime = t('sharing.transportDatetimeRequired', 'Date and time is required');
    }
    if (!location.trim()) {
      newErrors.location = t('sharing.transportLocationRequired', 'Location is required');
    }
    if (instant === undefined || Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrors({});

    try {
      const formData: TransportFormData = {
        personId: guestPersonId,
        type: transportType,
        datetime: instant,
        location: location.trim(),
        transportMode: transportMode || undefined,
        transportNumber: transportNumber.trim() || undefined,
        needsPickup,
      };

      const newTransport = await createTransport(trip.id, formData);
      if (!isMountedRef.current) return;

      // Add to local display list
      setEnteredTransports((prev) => [...prev, newTransport]);

      // Show brief success indicator
      setShowSuccess(true);
      if (successTimerRef.current !== undefined) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) setShowSuccess(false);
        successTimerRef.current = undefined;
      }, 2000);

      // Reset form with opposite type
      setTransportType(transportType === 'arrival' ? 'departure' : 'arrival');
      setDatetime('');
      setLocation('');
      setTransportMode('');
      setTransportNumber('');
      setNeedsPickup(false);
    } catch (error) {
      console.error('Failed to create transport:', error);
      if (isMountedRef.current) {
        setErrors({ submit: t('sharing.transportCreateError', 'Failed to add transport. Please try again.') });
      }
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  }, [trip, guestPersonId, transportType, datetime, location, transportMode, transportNumber, needsPickup, t]);

  /**
   * Navigates to the summary step.
   */
  const handleNavigateToSummary = useCallback((): void => {
    if (!shareId) return;
    navigate(`/share/${shareId}/summary`);
  }, [shareId, navigate]);

  /**
   * Handles type toggle click.
   */
  const handleTypeChange = useCallback((type: TransportType): void => {
    setTransportType(type);
  }, []);

  /**
   * Handles transport mode select change.
   */
  const handleModeChange = useCallback((value: string): void => {
    setTransportMode(value as TransportMode | '');
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  // Loading state
  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  // Not found / error state — friendly message
  if (notFound || trip === undefined) {
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

  const hasEnteredTransports = enteredTransports.length > 0;

  return (
    <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
      <Card className="w-full max-w-md border-warning-border shadow-lg">
        <CardHeader className="pb-4 pt-8 text-center">
          {/* Warm transport icon */}
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-warning/20">
            <Train className="size-10 text-warning-on-surface" aria-hidden="true" />
          </div>

          <CardTitle className="text-2xl font-bold text-warning-on-surface">
            {t('sharing.transportTitle', 'Your travel details')}
          </CardTitle>

          <p className="mt-1 text-sm text-muted-foreground">
            {t('sharing.transportSubtitle', "Tell us when you're arriving and departing")}
          </p>
        </CardHeader>

        <CardContent className="space-y-4 pb-8">
          {/* Success indicator */}
          {showSuccess && (
            <div className={cn('flex items-center gap-2 rounded-xl p-3 text-sm', statusVariants({ tone: 'success' }))}>
              <Check className="size-4" aria-hidden="true" />
              {t('sharing.transportAdded', 'Transport added!')}
            </div>
          )}

          {/* Submit error message */}
          {errors.submit !== undefined && (
            <p id="submit-error" role="alert" className={cn('rounded-xl p-3 text-sm', statusVariants({ tone: 'danger' }))}>
              {errors.submit}
            </p>
          )}

          {/* Already-entered transports as summary cards */}
          {hasEnteredTransports && (
            <div className="space-y-2">
              {enteredTransports.map((transport) => (
                <div
                  key={transport.id}
                  className="rounded-lg border border-warning-border bg-card p-3"
                >
                  <div className="flex items-center gap-2">
                    {getTransportIcon(transport.transportMode, t)}
                    <span className="font-medium text-warning-on-surface capitalize">
                      {transport.type === 'arrival'
                        ? t('sharing.transportArrival', 'Arrival')
                        : t('sharing.transportDeparture', 'Departure')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDatetime(transport.datetime, i18n.language)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {transport.location}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    {transport.transportNumber && (
                      <span>{transport.transportNumber}</span>
                    )}
                    {transport.needsPickup && (
                      <span className="rounded bg-warning-surface px-2 py-0.5 text-warning-on-surface">
                        {t('sharing.transportNeedsPickupBadge', 'Needs pickup')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Transport entry form */}
          <div className="space-y-4">
            {/* Type toggle */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-warning-on-surface">
                {t('sharing.transportType', 'Type')}
              </Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  aria-pressed={transportType === 'arrival'}
                  onClick={() => handleTypeChange('arrival')}
                  className={cn(
                    'h-12 flex-1 text-base font-medium',
                    transportType === 'arrival'
                      ? statusVariants({ tone: 'warning', emphasis: 'solid' })
                      : 'border border-warning-border bg-card text-warning-on-surface hover:bg-warning-surface hover:text-warning-on-surface',
                  )}
                >
                  {t('sharing.transportArrival', 'Arrival')}
                </Button>
                <Button
                  type="button"
                  aria-pressed={transportType === 'departure'}
                  onClick={() => handleTypeChange('departure')}
                  className={cn(
                    'h-12 flex-1 text-base font-medium',
                    transportType === 'departure'
                      ? statusVariants({ tone: 'warning', emphasis: 'solid' })
                      : 'border border-warning-border bg-card text-warning-on-surface hover:bg-warning-surface hover:text-warning-on-surface',
                  )}
                >
                  {t('sharing.transportDeparture', 'Departure')}
                </Button>
              </div>
            </div>

            {/* Datetime input */}
            <div className="space-y-2">
              <Label htmlFor="transport-datetime" className="text-sm font-medium text-warning-on-surface">
                {t('sharing.transportDatetime', 'Date and time')}
              </Label>
              <Input
                id="transport-datetime"
                type="datetime-local"
                inputMode="numeric"
                value={datetime}
                onChange={(e) => setDatetime(e.target.value)}
                className="h-12"
                aria-invalid={errors.datetime !== undefined}
                aria-describedby={errors.datetime ? 'datetime-error' : undefined}
              />
              {errors.datetime !== undefined && (
                <p id="datetime-error" role="alert" className="text-sm text-destructive">
                  {errors.datetime}
                </p>
              )}
            </div>

            {/* Location input */}
            <div className="space-y-2">
              <Label htmlFor="transport-location" className="text-sm font-medium text-warning-on-surface">
                {t('sharing.transportLocation', 'Station / Airport')}
              </Label>
              <Input
                id="transport-location"
                type="text"
                inputMode="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t('sharing.transportLocationPlaceholder', 'e.g. Gare de Vannes')}
                className="h-12"
                aria-invalid={errors.location !== undefined}
                aria-describedby={errors.location ? 'location-error' : undefined}
              />
              {errors.location !== undefined && (
                <p id="location-error" role="alert" className="text-sm text-destructive">
                  {errors.location}
                </p>
              )}
            </div>

            {/* Transport mode select */}
            <div className="space-y-2">
              <Label htmlFor="transport-mode" className="text-sm font-medium text-warning-on-surface">
                {t('sharing.transportMode', 'Transport mode')}
                <span className="ml-1 text-muted-foreground">
                  ({t('common.optional', 'optional')})
                </span>
              </Label>
              <Select value={transportMode} onValueChange={handleModeChange}>
                <SelectTrigger id="transport-mode" className="h-12">
                  <SelectValue placeholder={t('sharing.transportModePlaceholder', 'Select mode')} />
                </SelectTrigger>
                <SelectContent>
                  {TRANSPORT_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`transports.modes.${mode}`, mode)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Transport number input */}
            <div className="space-y-2">
              <Label htmlFor="transport-number" className="text-sm font-medium text-warning-on-surface">
                {t('sharing.transportNumber', 'Number (optional)')}
              </Label>
              <Input
                id="transport-number"
                type="text"
                inputMode="text"
                value={transportNumber}
                onChange={(e) => setTransportNumber(e.target.value)}
                placeholder={t('sharing.transportNumberPlaceholder', 'e.g. TGV 8541')}
                className="h-12"
              />
            </div>

            {/* Needs pickup switch */}
            <div className="flex items-center justify-between rounded-lg border border-warning-border bg-card p-4">
              <div className="space-y-0.5">
                <Label htmlFor="needs-pickup" className="text-sm font-medium text-warning-on-surface">
                  {t('sharing.transportNeedsPickup', 'Need a pickup?')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('sharing.transportNeedsPickupDescription', 'Let others know you need a ride from the station')}
                </p>
              </div>
              <Switch
                id="needs-pickup"
                checked={needsPickup}
                onCheckedChange={setNeedsPickup}
              />
            </div>
          </div>

          {/* Add transport button */}
          <Button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={isSubmitting}
            className={cn('h-12 w-full text-base font-semibold', statusVariants({ tone: 'warning', emphasis: 'solid' }))}
            aria-describedby={errors.submit ? 'submit-error' : undefined}
          >
            {isSubmitting ? (
              t('sharing.transportAdding', 'Adding...')
            ) : (
              <>
                <Plus className="mr-2 size-4" aria-hidden="true" />
                {hasEnteredTransports
                  ? t('sharing.transportAddAnother', 'Add another?')
                  : t('sharing.transportAdd', 'Add transport')}
              </>
            )}
          </Button>

          {/* Next / Done button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleNavigateToSummary}
            disabled={isSubmitting}
            className="h-12 w-full border-warning-border text-base font-semibold text-warning-on-surface hover:bg-warning-surface hover:text-warning-on-surface dark:border-warning-border dark:bg-transparent dark:hover:bg-warning-surface dark:hover:text-warning-on-surface"
          >
            {hasEnteredTransports
              ? t('sharing.transportDone', 'Done')
              : t('sharing.transportNext', 'Next')}
          </Button>

          {/* Skip for now — always visible secondary action */}
          <Button
            type="button"
            variant="ghost"
            onClick={handleNavigateToSummary}
            disabled={isSubmitting}
            className="h-12 w-full text-warning-on-surface hover:bg-warning-surface hover:text-warning-on-surface dark:hover:bg-warning-surface dark:hover:text-warning-on-surface"
          >
            {t('sharing.transportSkip', 'Skip for now')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
});

export default TransportEntryStepPage;
