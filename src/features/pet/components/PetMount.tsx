/**
 * @fileoverview Puts the pet on screen while it is turned on.
 *
 * The overlay is a lazy chunk: the pet is off by default, and only a device's
 * first open turns it on (`main.tsx`, beside the sample trip), so a visitor
 * who turned it off, or a device that ran the app before, never downloads its
 * drawing or its physics. This file is what `App` imports, and it holds
 * nothing but the switch.
 *
 * It also asks the `onboarding-small-pet` experiment which pet to draw. The
 * flag is read only once the pet is on, because reading it is what records
 * the exposure: a visitor with no pet never met the experiment. Nothing is
 * drawn while PostHog is asked, so the big pet never flashes before the small
 * one; without analytics the answer is `false` at once, the shipped pet.
 *
 * @module features/pet/components/PetMount
 */

import { type ReactElement, Suspense, lazy, memo } from 'react';

import { useFeatureFlagVariant } from '@/hooks/useFeatureFlag';

import { SMALL_PET_FLAG, SMALL_PET_VARIANT } from '../constants';
import { usePetPreferences } from '../hooks/usePetPreferences';

// ============================================================================
// Constants
// ============================================================================

const PetOverlay = lazy(() =>
  import('./PetOverlay').then((module) => ({ default: module.PetOverlay })),
);

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Asks the experiment, which records the exposure, and draws its arm.
 *
 * A separate component so the flag is read only while the pet is on: a hook
 * cannot be called conditionally.
 */
const PetExperiment = memo(function PetExperiment(): ReactElement | null {
  const variant = useFeatureFlagVariant(SMALL_PET_FLAG);

  if (variant === undefined) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <PetOverlay compact={variant === SMALL_PET_VARIANT} />
    </Suspense>
  );
});

// ============================================================================
// Component
// ============================================================================

/**
 * Renders the pet when the setting is on, and nothing otherwise.
 *
 * @returns The pet, or `null`
 */
export const PetMount = memo(function PetMount(): ReactElement | null {
  const { enabled } = usePetPreferences();

  if (!enabled) {
    return null;
  }

  return <PetExperiment />;
});
