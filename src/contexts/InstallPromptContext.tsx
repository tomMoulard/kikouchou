/**
 * @fileoverview One install prompt for the whole app.
 *
 * `useInstallPrompt` listens for `beforeinstallprompt` and `appinstalled` and
 * reports the install to PostHog. Two components calling it would hold two
 * copies of the browser's one deferred prompt and count one install twice, so
 * the hook runs once, here, and anything that offers the install — the global
 * banner, the nudge on a shared trip's calendar — reads the result from this
 * context.
 *
 * @module contexts/InstallPromptContext
 */

import { type ReactElement, type ReactNode, createContext, useContext } from 'react';

import { type UseInstallPromptResult, useInstallPrompt } from '@/hooks/useInstallPrompt';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What the hook reports, shared by every component that offers the install.
 */
export type InstallPromptState = UseInstallPromptResult;

// ============================================================================
// Context
// ============================================================================

/**
 * What a component sees outside any provider: nothing to install.
 *
 * A default rather than a throw so a component that *can* offer the install —
 * the layout, a page — renders unchanged in a test tree or a storybook without
 * the provider. Nothing installable is exactly what such a tree has.
 */
const NO_INSTALL: InstallPromptState = {
  canInstall: false,
  isInstalled: false,
  isInstalling: false,
  installIntent: false,
  install: async () => false,
};

const InstallPromptContext = createContext<InstallPromptState>(NO_INSTALL);

// ============================================================================
// Provider
// ============================================================================

interface InstallPromptProviderProps {
  readonly children: ReactNode;
}

/**
 * Runs the install hook once and shares its result.
 *
 * Mount it once, above the router and above the global banner, and outside
 * anything that remounts on the no-trip → trip transition: a remount would
 * drop the captured `beforeinstallprompt`, which the browser fires once.
 */
export function InstallPromptProvider({ children }: InstallPromptProviderProps): ReactElement {
  const prompt = useInstallPrompt();

  return <InstallPromptContext.Provider value={prompt}>{children}</InstallPromptContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * The app's one install prompt.
 *
 * @returns The shared install state; "nothing to install" outside a provider
 */
export function useInstallPromptState(): InstallPromptState {
  return useContext(InstallPromptContext);
}
