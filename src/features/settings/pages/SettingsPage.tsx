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

import { PageHeader } from '@/components/shared/PageHeader';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
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
import { AccountSection } from '@/features/auth/components/AccountSection';
import { ThemeSelector } from '@/features/settings/components/ThemeSelector';
import { TripForm } from '@/features/trips/components/TripForm';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db';
import { deleteTrip, updateTrip } from '@/lib/db';
import { SUPPORTED_LANGUAGES, changeLanguage, getCurrentLanguage } from '@/lib/i18n';
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
    if (value === 'fr' || value === 'en') {
      void changeLanguage(value);
      // Language change is stored in localStorage (not IndexedDB),
      // so use standard toast instead of offline-aware toast
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
          <span className="text-sm text-muted-foreground">{t('app.name', 'Kikoushou')}</span>
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
 * Only shown when a trip is currently selected.
 */
const CurrentTripSection = memo(function CurrentTripSection(): ReactElement | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentTrip, setCurrentTrip } = useTripContext();

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
      toast.success(t('trips.updated', 'Trip updated successfully'));
    },
    [currentTrip, t],
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
      toast.success(t('trips.deleted', 'Trip deleted successfully'));
      navigate('/trips', { replace: true });
    } catch (error) {
      console.error('Failed to delete trip:', error);
      if (isMountedRef.current) {
        toast.error(t('errors.deleteFailed', 'Failed to delete. Please try again.'));
      }
    } finally {
      isDeletingRef.current = false;
    }
  }, [currentTrip, navigate, setCurrentTrip, t]);

  const handleOpenDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []);

  const handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    setIsDeleteDialogOpen(open);
  }, []);

  if (!currentTrip) {
    return null;
  }

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
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={handleOpenDeleteDialog}>
                <Trash2 className="mr-2 size-4" aria-hidden="true" />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
        {/* Current Trip Section - only shown when a trip is selected */}
        <CurrentTripSection />

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


