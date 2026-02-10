/**
 * @fileoverview Settings page for app configuration.
 * Allows users to change language, view app info, and clear data.
 *
 * @module features/settings/pages/SettingsPage
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Info, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

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
import { db } from '@/lib/db';
import { SUPPORTED_LANGUAGES, changeLanguage, getCurrentLanguage } from '@/lib/i18n';

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
   [showClearDialog, setShowClearDialog] = useState(false),
   [isClearing, setIsClearing] = useState(false),

   handleClearData = useCallback(async (): Promise<void> => {
    setIsClearing(true);
    try {
      // Delete the entire database
      await db.delete();
      // Recreate it (Dexie will recreate on next access)
      await db.open();
      
      toast.success(t('settings.dataCleared', 'All data has been cleared'));
      setShowClearDialog(false);
      
      // Reload the page to reset all state
      window.location.href = import.meta.env.BASE_URL + 'trips';
    } catch (error) {
      console.error('Failed to clear data:', error);
      toast.error(t('settings.clearDataFailed', 'Failed to clear data. Please try again.'));
    } finally {
      setIsClearing(false);
    }
  }, [t]),

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
 * - Language selector (French/English)
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
        {/* Language Section */}
        <LanguageSelector />

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


