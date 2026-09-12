/**
 * @fileoverview Scope control for trip vs all-trips analytics — same Tabs pattern as Calendar/Rooms view toggles.
 *
 * @module features/analytics/components/AnalyticsScopeSelector
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ViewSwitcher } from '@/components/ui/view-switcher';

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
    <ViewSwitcher
      className="mb-4"
      value={active === 'trip' ? 'trip' : 'all'}
      onValueChange={handleValueChange}
      ariaLabel={t('analytics.scopeAriaLabel')}
      options={[
        { value: 'trip', label: t('analytics.scopeThisTrip') },
        { value: 'all', label: t('analytics.scopeAllTrips') },
      ]}
    />
  );
});

export { AnalyticsScopeSelector };
