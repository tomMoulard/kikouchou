/**
 * @fileoverview Minimal placeholder page for onboarding wizard sub-routes.
 * This stub will be replaced by the full implementations in stories 2.2–2.5.
 *
 * @module features/sharing/pages/OnboardingPlaceholderPage
 *
 * Routes:
 * - /share/:shareId/identity  (story 2.2)
 * - /share/:shareId/room      (story 2.3)
 * - /share/:shareId/transport (story 2.4)
 * - /share/:shareId/summary   (story 2.5)
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { onboardingSurface } from '@/components/ui/status.variants';

import { cn } from '@/lib/utils';

// ============================================================================
// Component
// ============================================================================

/**
 * Placeholder page rendered for onboarding wizard sub-routes while stories
 * 2.2–2.5 are not yet implemented.
 *
 * @returns A "Coming soon" card element
 */
export const OnboardingPlaceholderPage = memo(
  function OnboardingPlaceholderPage(): ReactElement {
    const { t } = useTranslation();

    return (
      <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
        <Card className="w-full max-w-md border-warning-border text-center shadow-lg">
          <CardHeader className="pb-2 pt-8">
            <div className="mx-auto mb-4 text-4xl" aria-hidden="true">
              🚧
            </div>
            <CardTitle className="text-xl text-warning-on-surface">
              {t('common.comingSoon', 'Coming soon')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-8">
            <p className="text-sm text-muted-foreground">
              {t(
                'sharing.onboardingComingSoon',
                'This step will be available soon.',
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  },
);

export default OnboardingPlaceholderPage;
