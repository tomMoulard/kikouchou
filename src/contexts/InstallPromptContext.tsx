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
 * The context also owns something the hook cannot: an install request raised
 * *after* the page loaded. The hook reads `?install=1` once, on arrival. The
 * nudge sends an iPhone to the invite page to install from there, and that is a
 * client-side navigation with nothing to re-read, so it raises the request
 * through `requestInstall()` and the banner answers it with the browser's own
 * steps exactly as if the visit had started with the parameter.
 *
 * @module contexts/InstallPromptContext
 */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { type UseInstallPromptResult, useInstallPrompt } from '@/hooks/useInstallPrompt';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What the hook reports, plus the one thing a component can ask of it.
 */
export interface InstallPromptState extends UseInstallPromptResult {
  /**
   * Treats the rest of this visit as an install request, as `?install=1` on
   * arrival would have. Idempotent.
   */
  readonly requestInstall: () => void;
}

// ============================================================================
// Context
// ============================================================================

/**
 * What a component sees outside any provider: nothing to install, no request.
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
  manualInstallPlatform: 'generic',
  install: async () => false,
  requestInstall: () => {},
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
  const [requested, setRequested] = useState(false);

  const requestInstall = useCallback((): void => {
    setRequested(true);
  }, []);

  const value = useMemo<InstallPromptState>(
    () => ({
      ...prompt,
      installIntent: prompt.installIntent || requested,
      requestInstall,
    }),
    [prompt, requested, requestInstall],
  );

  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * The app's one install prompt, and the request flag.
 *
 * @returns The shared install state; "nothing to install" outside a provider
 */
export function useInstallPromptState(): InstallPromptState {
  return useContext(InstallPromptContext);
}
