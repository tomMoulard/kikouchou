/**
 * @fileoverview Settings page for app configuration.
 * Allows users to change language and theme, view app info, and clear data.
 *
 * @module features/settings/pages/SettingsPage
 */

import { type ReactElement, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe, Info, Luggage, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useOfflineAwareToast } from '@/hooks';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { AccountSection } from '@/features/auth/components/AccountSection';
import { GuestIdentitySelector } from '@/features/settings/components/GuestIdentitySelector';
import { ThemeSelector } from '@/features/settings/components/ThemeSelector';
import { TripForm } from '@/features/trips/components/TripForm';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db';
import { deleteTrip, updateTrip } from '@/lib/db';
import { SUPPORTED_LANGUAGES, changeLanguage, getCurrentLanguage, isLanguageSupported } from '@/lib/i18n';
import type { TripFormData } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Application version from package.json.
 * In a real app, this would be injected at build time.
 */
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'devel';

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Language selector component.
 * Allows switching between supported languages.
 */
const LanguageSelector = memo(function LanguageSelector(): ReactElement {
  const { t } = useTranslation(),
   currentLanguage = getCurrentLanguage(),

   handleLanguageChange = useCallback((value: string): void => {
    // Guarded against `isLanguageSupported`, not against a second hand-written
    // `value === 'fr' || value === 'en'`. The options are rendered from
    // `SUPPORTED_LANGUAGES`, so a literal list here is a duplicate of it that
    // nothing keeps in step: adding a language would render its option, fire
    // this handler, fall through the guard, and leave the dropdown silently
    // doing nothing.
    if (isLanguageSupported(value)) {
      void changeLanguage(value);
      // Deliberately a raw toast: the language lives in localStorage and never
      // syncs, so the offline-aware "Saved on this device" wording adds
      // nothing. That helper is for writes to shared trip data.
      toast.success(t('settings.languageChanged', 'Language changed'));
    }
  }, [t]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <Globe className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">{t('settings.language', 'Language')}</CardTitle>
            <CardDescription>
              {t('settings.languageDescription', 'Choose your preferred language')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Select value={currentLanguage} onValueChange={handleLanguageChange}>
          <SelectTrigger className="w-full sm:w-[200px]" aria-label={t('settings.language', 'Language')}>
            <SelectValue placeholder={t('settings.language', 'Language')} />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {t(`settings.languages.${lang}`, lang === 'fr' ? 'Français' : 'English')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
});

/**
 * Account card.
 *
 * Placed above Language because it is the only section whose state changes what
 * the rest of the app can do — sharing a trip is gated on it. Everything else
 * here is a preference.
 */
const AccountCard = memo(function AccountCard(): ReactElement {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <UserRound className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">{t('auth.account.title', 'Account')}</CardTitle>
            <CardDescription>
              {t('auth.account.description', 'Needed only to share a trip')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <AccountSection />
      </CardContent>
    </Card>
  );
});

/**
 * About section component.
 * Displays app information and version.
 */
const AboutSection = memo(function AboutSection(): ReactElement {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <Info className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">{t('settings.about', 'About')}</CardTitle>
            <CardDescription>
              {t('settings.aboutDescription', 'Application information')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('app.name', 'Kikouchou')}</span>
          <span className="text-sm font-medium">{t('app.tagline', 'Organize your vacation with friends')}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('settings.version', 'Version')}</span>
          <span className="text-sm font-mono">{APP_VERSION}</span>
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * Data management section component.
 * Allows clearing all app data.
 */
const DataSection = memo(function DataSection(): ReactElement {
  const { t } = useTranslation(),
   { successToast: dataSuccessToast } = useOfflineAwareToast(),
   [showClearDialog, setShowClearDialog] = useState(false),
   [isClearing, setIsClearing] = useState(false),

   handleClearData = useCallback(async (): Promise<void> => {
    setIsClearing(true);
    try {
      // Delete the entire database
      await db.delete();
      // Recreate it (Dexie will recreate on next access)
      await db.open();
      
      dataSuccessToast(t('settings.dataCleared', 'All data has been cleared'));
      setShowClearDialog(false);
      
      // Reload the page to reset all state
      window.location.href = import.meta.env.BASE_URL + 'trips';
    } catch (error) {
      console.error('Failed to clear data:', error);
      toast.error(t('settings.clearDataFailed', 'Failed to clear data. Please try again.'));
    } finally {
      setIsClearing(false);
    }
  }, [t, dataSuccessToast]),

   handleOpenChange = useCallback((open: boolean): void => {
    if (!isClearing) {
      setShowClearDialog(open);
    }
  }, [isClearing]);

  return (
    <>
      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
              <Trash2 className="size-5 text-destructive" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">{t('settings.dataManagement', 'Data Management')}</CardTitle>
              <CardDescription>
                {t('settings.dataManagementDescription', 'Manage your app data')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {t('settings.clearDataWarning', 'This will permanently delete all trips, rooms, persons, and transports.')}
            </div>
            <Button
              variant="destructive"
              onClick={() => setShowClearDialog(true)}
              className="w-full sm:w-auto"
            >
              <Trash2 className="size-4 mr-2" aria-hidden="true" />
              {t('settings.clearData', 'Clear All Data')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showClearDialog}
        onOpenChange={handleOpenChange}
        title={t('confirm.clearAllData')}
        description={t('confirm.clearAllDataDescription')}
        confirmLabel={t('settings.clearData', 'Clear All Data')}
        variant="destructive"
        onConfirm={handleClearData}
      />
    </>
  );
});

/**
 * Current trip section component.
 * Displays the current trip edit form and delete option.
 *
 * The card is always mounted so the section has the same four states as every
 * other page in the app: loading while IndexedDB resolves, an error with a
 * retry, an empty state when no trip is selected, and the form itself. It used
 * to render `null` for all three non-form cases, which meant a cold open of
 * /settings showed a hole where the trip card would land.
 *
 * Only the trip card waits — account, language, about and data management
 * render immediately, because none of them depends on the trip query (and the
 * account panel must never wait on auth; see AuthContext's docblock).
 */
const CurrentTripSection = memo(function CurrentTripSection(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentTrip, setCurrentTrip, trips, isLoading, error, checkConnection } =
    useTripContext();
  const { successToast } = useOfflineAwareToast();

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const isDeletingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false
    // forever, silently turning every guarded setState into a no-op.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  const handleSubmit = useCallback(
    async (data: TripFormData): Promise<void> => {
      if (!currentTrip) return;
      await updateTrip(currentTrip.id, data);
      setIsDirty(false);
      successToast(t('trips.updated', 'Trip updated successfully'));
    },
    [currentTrip, successToast, t],
  );

  const handleCancel = useCallback(() => {
    setIsDirty(false);
  }, []);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (isDeletingRef.current || !currentTrip) return;
    isDeletingRef.current = true;

    const tripIdToDelete = currentTrip.id;

    try {
      await deleteTrip(tripIdToDelete);
      try {
        await setCurrentTrip(null);
      } catch (clearErr) {
        console.error('Failed to clear current trip after delete:', clearErr);
      }
      successToast(t('trips.deleted', 'Trip deleted successfully'));
      navigate('/trips', { replace: true });
    } catch (deleteError) {
      console.error('Failed to delete trip:', deleteError);
      if (isMountedRef.current) {
        toast.error(t('errors.deleteFailed', 'Failed to delete. Please try again.'));
      }
    } finally {
      isDeletingRef.current = false;
    }
  }, [currentTrip, navigate, setCurrentTrip, successToast, t]);

  const handleOpenDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []);

  const handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    setIsDeleteDialogOpen(open);
  }, []);

  // `checkConnection` re-throws after storing the error on the context, so the
  // rejection has to be swallowed here — `void` alone would surface it as an
  // unhandled rejection. Same shape as TripListPage's retry.
  const handleRetry = useCallback(async (): Promise<void> => {
    try {
      await checkConnection();
    } catch {
      // Error is captured in context and rendered by ErrorDisplay.
    }
  }, [checkConnection]);

  const handleRetryClick = useCallback(() => {
    void handleRetry();
  }, [handleRetry]);

  // With no trip selected the call to action depends on whether there is
  // anything to select: send people to the list when trips exist, straight to
  // the create form when the device is empty.
  const hasTrips = trips.length > 0;

  const handleEmptyAction = useCallback(() => {
    navigate(hasTrips ? '/trips' : '/trips/new');
  }, [hasTrips, navigate]);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <Luggage className="size-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">{t('settings.currentTrip', 'Current Trip')}</CardTitle>
              <CardDescription>
                {t('settings.currentTripDescription', 'Edit your current trip settings')}
              </CardDescription>
            </div>
            {currentTrip && (
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" onClick={handleOpenDeleteDialog}>
                  <Trash2 className="mr-2 size-4" aria-hidden="true" />
                  {t('common.delete')}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6">
              <LoadingState
                variant="inline"
                size="lg"
                label={t('settings.currentTripLoading', 'Loading your trip…')}
              />
            </div>
          ) : currentTrip ? (
            // A trip in hand beats a stale error. `error` is the whole trip
            // context's error, and a `setCurrentTrip` that failed on another
            // page leaves it set until someone clears it — showing the error
            // here would unmount an editable form (and any unsaved edits in
            // it) over something that has nothing to do with this trip.
            <>
              <TripForm
                trip={currentTrip}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                onDirtyChange={handleDirtyChange}
              />
              {isDirty && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('settings.unsavedTripChanges', 'You have unsaved changes')}
                </p>
              )}
            </>
          ) : error ? (
            <ErrorDisplay
              error={error}
              size="compact"
              title={t('settings.currentTripError', 'Could not load your trip')}
              onRetry={handleRetryClick}
            />
          ) : (
            <EmptyState
              icon={Luggage}
              title={t('settings.noCurrentTrip', 'No trip selected')}
              description={
                hasTrips
                  ? t(
                      'settings.noCurrentTripDescription',
                      'Open a trip and its name, dates and location become editable here.',
                    )
                  : t(
                      'settings.noTripsYetDescription',
                      'Create your first trip and its name, dates and location become editable here.',
                    )
              }
              action={{
                label: hasTrips
                  ? t('settings.chooseTrip', 'Choose a trip')
                  : t('settings.createFirstTrip', 'Create a trip'),
                onClick: handleEmptyAction,
              }}
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={handleDeleteDialogOpenChange}
        title={t('confirm.deleteTrip')}
        description={t('confirm.deleteTripDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={handleDelete}
        variant="destructive"
      />
    </>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * Settings page component.
 *
 * Features:
 * - Current trip: edit or delete, with loading, error and empty states
 * - Guest identity: which guest this browser is on the current trip
 * - Account: sign in with Google, sign out
 * - Language selector (French/English)
 * - Theme selector (light/dark/system)
 * - App version display
 * - Clear data option with confirmation
 * - About section
 *
 * @returns The settings page element
 *
 * @example
 * ```tsx
 * // In router configuration
 * {
 *   path: 'settings',
 *   element: <SettingsPage />,
 * }
 * ```
 */
function SettingsPageComponent(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="container mx-auto max-w-2xl">
      <PageHeader
        title={t('settings.title', 'Settings')}
        description={t('settings.description', 'Manage your app preferences')}
      />

      <div className="mt-6 space-y-6">
        {/* Current Trip Section — carries its own loading, error and empty states */}
        <CurrentTripSection />

        {/* Which guest this browser is — directly under the trip it belongs to,
            because the answer is per trip and means nothing without one. */}
        <GuestIdentitySelector />

        {/* Account Section */}
        <AccountCard />

        {/* Language Section */}
        <LanguageSelector />

        {/* Theme Section - grouped with Language: both are presentation preferences */}
        <ThemeSelector />

        {/* About Section */}
        <AboutSection />

        {/* Data Management Section */}
        <DataSection />
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Memoized Settings page component.
 */
export const SettingsPage = memo(SettingsPageComponent);


