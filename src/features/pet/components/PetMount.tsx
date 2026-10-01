/**
 * @fileoverview Puts the pet on screen while it is turned on.
 *
 * The overlay is a lazy chunk: the pet is off by default, so most visitors
 * never download its drawing or its physics. This file is what `App` imports,
 * and it holds nothing but the switch.
 *
 * @module features/pet/components/PetMount
 */

import { type ReactElement, Suspense, lazy, memo } from 'react';

import { usePetPreferences } from '../hooks/usePetPreferences';

// ============================================================================
// Constants
// ============================================================================

const PetOverlay = lazy(() =>
  import('./PetOverlay').then((module) => ({ default: module.PetOverlay })),
);

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

  return (
    <Suspense fallback={null}>
      <PetOverlay />
    </Suspense>
  );
});
