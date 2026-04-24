/**
 * @fileoverview Scope control for trip vs all-trips analytics — same Tabs pattern as Calendar/Rooms view toggles.
 *
 * @module features/analytics/components/AnalyticsScopeSelector
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ============================================================================
// Types
// ============================================================================

export interface AnalyticsScopeSelectorProps {
  /** Which analytics view is active (matches current route). */
  readonly active: 'trip' | 'all';
  /** Target for the “this trip” tab (trip analytics URL or trips list). */
  readonly tripHref: string;
}

// ============================================================================
// Component
// ============================================================================

const AnalyticsScopeSelector = memo(function AnalyticsScopeSelector({
  active,
  tripHref,
}: AnalyticsScopeSelectorProps): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleValueChange = useCallback(
    (value: string) => {
      if (value === 'trip') {
        void navigate(tripHref);
        return;
      }
      if (value === 'all') {
        void navigate('/analytics');
      }
    },
    [navigate, tripHref],
  );

  return (
    <Tabs
      value={active === 'trip' ? 'trip' : 'all'}
      onValueChange={handleValueChange}
      className="mb-4"
    >
      <TabsList aria-label={t('analytics.scopeAriaLabel')}>
        <TabsTrigger value="trip" className="px-1.5 sm:px-2">
          {t('analytics.scopeThisTrip')}
        </TabsTrigger>
        <TabsTrigger value="all" className="px-1.5 sm:px-2">
          {t('analytics.scopeAllTrips')}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
});

export { AnalyticsScopeSelector };
