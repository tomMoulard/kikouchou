/**
 * @fileoverview Settings page for app configuration.
 * Allows users to change language and theme, view app info, and clear data.
 *
 * App settings only. The trip used to be edited here too — its name and dates
 * in a form, a "Delete this trip" button, the guest identity card and the print
 * button, all beside the language and the theme. That mixed two jobs on one
 * page: a preference belongs to this device, a trip belongs to the group that
 * is going on it. The trip's own settings page (`/trips/:tripId/edit`) owns all
 * of that now. "Clear all data" stays here, because it empties the device
 * rather than one trip.
 *
 * @module features/settings/pages/SettingsPage
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Info, Trash2, UserRound } from 'lucide-react';
import { useOfflineAwareNotify } from '@/hooks';

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
import { PageHeader } from '@/components/shared/PageHeader';
import { AccountSection } from '@/features/auth/components/AccountSection';
import { NotificationSettings } from '@/features/settings/components/NotificationSettings';
import { ThemeSelector } from '@/features/settings/components/ThemeSelector';
import { db } from '@/lib/db';
import { SUPPORTED_LANGUAGES, changeLanguage, getCurrentLanguage, isLanguageSupported } from '@/lib/i18n';
import { notify } from '@/lib/notifications';
import { formatAppVersion } from '@/lib/utils/app-version';
import { reportFailure } from '@/lib/errors/report-failure';

// ============================================================================
// Constants
// ============================================================================

/**
 * The build version, as the About card shows it.
 *
 * CI injects the git sha, so the raw value goes through
 * {@link formatAppVersion}, which prints the short sha rather than all 40
 * characters and supplies the local fallback.
 */
const APP_VERSION = formatAppVersion(import.meta.env.VITE_APP_VERSION ?? '');

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
      // Deliberately a raw confirmation: the language lives in localStorage and never
      // syncs, so the offline-aware "Saved on this device" wording adds
      // nothing. That helper is for writes to shared trip data.
      notify.success(t('settings.languageChanged', 'Language changed'));
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
   { notifySuccess: dataSuccessToast } = useOfflineAwareNotify(),
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
      reportFailure(
        'SettingsPage.clearData',
        error,
        t('settings.clearDataFailed', 'Failed to clear data. Please try again.'),
      );
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
 * - Ride alerts: opt in to OS notifications for the cars you drive
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
        {/* Account Section */}
        <AccountCard />

        {/* Language Section */}
        <LanguageSelector />

        {/* Theme Section - grouped with Language: both are presentation preferences */}
        <ThemeSelector />

        {/* Ride alerts — below the presentation preferences because it is the
            only card here that asks the browser for something, and above About
            because it is a preference rather than reference material. */}
        <NotificationSettings />

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


