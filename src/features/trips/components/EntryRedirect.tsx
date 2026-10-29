/**
 * @fileoverview Where `/` sends a visitor: the trip list, the sample's plan,
 * the first-trip wizard, or the assistant.
 *
 * Opening the app lands on the trip list, where the sample trip is the first
 * row. Of the visitors who arrive that way almost none open it: they read the
 * list, go to "New trip" and leave inside the wizard. The
 * `onboarding-planning-view` experiment asks whether showing the planning
 * view itself does better. Its planning arm opens the sample trip's calendar
 * instead of the list; its wizard arm opens `/trips/new`, which for a device
 * with no trip of its own is the first-trip wizard; its assistant arm opens
 * `/assistant` on the account model, with starter questions; its control arm
 * keeps the list.
 *
 * Only a device whose one trip is the sample takes part. Anyone with a trip of
 * their own, or who deleted the sample, goes to the list without the flag
 * being read, so the experiment counts no exposure it never showed.
 *
 * @module features/trips/components/EntryRedirect
 */

import { type ReactElement, memo } from 'react';
import { Navigate } from 'react-router-dom';

import { LoadingState } from '@/components/shared/LoadingState';

import { useFeatureFlagVariant } from '@/hooks/useFeatureFlag';
import { OPENED_ON_ENTRY } from '@/hooks/useSampleTripViewReport';

import { useTripContext } from '@/contexts/TripContext';

import type { TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** The experiment's flag, as it is spelled in PostHog. */
export const ONBOARDING_PLANNING_VIEW_FLAG = 'onboarding-planning-view';

/** The variant that opens the sample's calendar. */
const PLANNING_VIEW_VARIANT = 'planning';

/** The variant that opens the first-trip wizard. */
const WIZARD_VARIANT = 'wizard';

/** The variant that opens the assistant. */
const ASSISTANT_VARIANT = 'assistant';

// ============================================================================
// Type Definitions
// ============================================================================

interface SampleEntryProps {
  readonly sampleTripId: TripId;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Asks the flag, which records the exposure, and follows the arm.
 *
 * A separate component so the flag is read only once the visitor is known to
 * take part: a hook cannot be called conditionally.
 */
const SampleEntry = memo(function SampleEntry({ sampleTripId }: SampleEntryProps): ReactElement {
  const variant = useFeatureFlagVariant(ONBOARDING_PLANNING_VIEW_FLAG);

  if (variant === undefined) {
    return <LoadingState variant="fullPage" />;
  }
  if (variant === PLANNING_VIEW_VARIANT) {
    return <Navigate to={`/trips/${sampleTripId}/calendar`} replace state={OPENED_ON_ENTRY} />;
  }
  if (variant === WIZARD_VARIANT) {
    return <Navigate to="/trips/new" replace />;
  }
  if (variant === ASSISTANT_VARIANT) {
    // The entry state is what makes the page offer the account model.
    return <Navigate to="/assistant" replace state={OPENED_ON_ENTRY} />;
  }
  return <Navigate to="/trips" replace />;
});

/**
 * The index route: the trip list, the sample's calendar in the planning arm, the
 * first-trip wizard in the wizard arm, or the assistant in the assistant arm.
 */
export const EntryRedirect = memo(function EntryRedirect(): ReactElement {
  const { trips, sampleTripId, isLoading } = useTripContext();

  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  const onlySample =
    sampleTripId !== undefined &&
    trips.length > 0 &&
    trips.every((trip) => trip.id === sampleTripId);

  if (!onlySample) {
    return <Navigate to="/trips" replace />;
  }
  return <SampleEntry sampleTripId={sampleTripId} />;
});
