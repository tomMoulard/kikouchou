/**
 * @fileoverview Internationalization (i18n) configuration for Kikoushou PWA.
 * Sets up react-i18next with automatic language detection and French as the default language.
 *
 * @module lib/i18n
 *
 * @description
 * This module configures i18next for the application with the following features:
 * - Automatic language detection (localStorage → browser navigator)
 * - French ('fr') as the default/fallback language
 * - Support for English ('en') and French ('fr')
 * - React integration via react-i18next
 * - Type-safe translation keys (when translation files are added)
 *
 * @example
 * ```tsx
 * // In a component
 * import { useTranslation } from 'react-i18next';
 *
 * function MyComponent() {
 *   const { t, i18n } = useTranslation();
 *
 *   return (
 *     <div>
 *       <h1>{t('app.name')}</h1>
 *       <button onClick={() => i18n.changeLanguage('en')}>
 *         English
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see {@link https://react.i18next.com/ | react-i18next documentation}
 * @see {@link https://www.i18next.com/ | i18next documentation}
 */

import i18n, { type InitOptions, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector, {
  type DetectorOptions,
} from 'i18next-browser-languagedetector';

import type { Language } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Supported languages in the application.
 * Matches the Language type from @/types.
 *
 * @remarks
 * Uses `satisfies` to preserve literal types while ensuring conformance to Language[].
 */
export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const satisfies readonly Language[];

/**
 * Set version for O(1) language lookup.
 * @internal
 */
const SUPPORTED_LANGUAGES_SET: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

/**
 * Default/fallback language for the application.
 * Used when detected language is not supported or detection fails.
 */
export const DEFAULT_LANGUAGE: Language = 'fr';

/**
 * LocalStorage key used for persisting the user's language preference.
 * i18next-browser-languagedetector uses this key by default.
 */
export const LANGUAGE_STORAGE_KEY = 'i18nextLng';

// ============================================================================
// Translation Resources
// ============================================================================

/**
 * Translation resources imported from JSON files.
 *
 * @remarks
 * These files contain all UI strings for their respective languages.
 * The JSON files are statically imported and bundled with the application.
 *
 * @see {@link src/locales/en/translation.json} English translations
 * @see {@link src/locales/fr/translation.json} French translations
 */
import enTranslations from '@/locales/en/translation.json';
import frTranslations from '@/locales/fr/translation.json';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Translation namespace type.
 * Currently only 'translation' is used, but this allows for future expansion.
 */
type TranslationNamespace = 'translation';

/**
 * Type-safe resources configuration.
 */
type I18nResources = {
  [K in Language]: {
    [N in TranslationNamespace]: Record<string, unknown>;
  };
};

// ============================================================================
// Configuration
// ============================================================================

/**
 * I18next resources configuration.
 * Maps each supported language to its translation namespace.
 */
const resources: I18nResources = {
  en: {
    translation: enTranslations,
  },
  fr: {
    translation: frTranslations,
  },
} satisfies Resource,

/**
 * Language detector configuration.
 *
 * Detection order:
 * 1. localStorage - Persisted user preference
 * 2. navigator - Browser's language setting
 *
 * The detected language is cached in localStorage for subsequent visits.
 */
 detectionOptions: DetectorOptions = {
  // Detection order priority
  order: ['localStorage', 'navigator'],

  // Cache detected language in localStorage
  caches: ['localStorage'],

  // LocalStorage key for caching
  lookupLocalStorage: LANGUAGE_STORAGE_KEY,

  // Do not cache in cookies (PWA, localStorage is sufficient)
  lookupCookie: undefined,

  // Exclude query string and path detection (not needed for PWA)
  lookupQuerystring: undefined,
  lookupFromPathIndex: undefined,
  lookupFromSubdomainIndex: undefined,
},

/**
 * Main i18next initialization options.
 */
 initOptions: InitOptions = {
  // Translation resources
  resources,

  // Supported languages - restricts to valid Language values only
  supportedLngs: [...SUPPORTED_LANGUAGES],

  // Default/fallback language (French)
  fallbackLng: DEFAULT_LANGUAGE,

  // Default namespace
  defaultNS: 'translation',
  ns: ['translation'],

  // Language detection configuration
  detection: detectionOptions,

  // Interpolation settings
  interpolation: {
    // React already escapes values to prevent XSS
    escapeValue: false,

    // Format function for dates, numbers, etc. (can be extended later)
    // Format: (value, format, lng) => { ... }
  },

  // React-specific settings
  react: {
    // Use Suspense for loading translations (recommended for React 18+)
    useSuspense: false, // Disabled since translations are bundled, not lazy-loaded
  },

  // Return empty string for missing keys in development
  // This makes missing translations more visible during development
  returnEmptyString: false,

  // Log missing keys in development
  saveMissing: false, // Enable if using a translation management system

  // Debug mode (can be enabled via environment variable)
  debug: false,
};

// ============================================================================
// Initialization
// ============================================================================

/**
 * Promise that resolves when i18n initialization is complete.
 *
 * @remarks
 * Use this to coordinate app startup and ensure translations are ready
 * before rendering components that depend on them.
 *
 * Plugin order matters:
 * 1. LanguageDetector - Detects user's preferred language
 * 2. initReactI18next - Integrates with React
 *
 * @example
 * ```tsx
 * // In main.tsx
 * import { i18nReady } from '@/lib/i18n';
 *
 * async function main() {
 *   await i18nReady;
 *   createRoot(document.getElementById('root')!).render(<App />);
 * }
 * main();
 * ```
 */
export const i18nReady: Promise<void> = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init(initOptions)
  .then(() => undefined);

/**
 * Checks if i18n has been fully initialized.
 *
 * @returns True if i18n is ready to use
 *
 * @example
 * ```tsx
 * import { isI18nInitialized } from '@/lib/i18n';
 *
 * if (!isI18nInitialized()) {
 *   return <LoadingSpinner />;
 * }
 * ```
 */
export function isI18nInitialized(): boolean {
  return i18n.isInitialized;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Changes the application language.
 *
 * @param language - The language code to switch to
 * @returns Promise that resolves when the language change is complete
 *
 * @remarks
 * This is a convenience wrapper around i18n.changeLanguage().
 * The language is automatically persisted to localStorage by the detector.
 *
 * @example
 * ```tsx
 * import { changeLanguage } from '@/lib/i18n';
 *
 * // In a language switcher component
 * const handleLanguageChange = async (lang: Language) => {
 *   await changeLanguage(lang);
 *   // Language is now changed and persisted
 * };
 * ```
 *
 * @todo Integrate with IndexedDB settings storage for cross-tab synchronization
 *       The app stores language preference in AppSettings.language (IndexedDB).
 *       Consider adding a listener to sync localStorage ↔ IndexedDB.
 */
export async function changeLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
}

/**
 * Gets the currently active language.
 *
 * @returns The current language code
 *
 * @remarks
 * Returns the default language if i18n is not yet initialized,
 * preventing race condition issues during app startup.
 *
 * @example
 * ```tsx
 * import { getCurrentLanguage } from '@/lib/i18n';
 *
 * const lang = getCurrentLanguage(); // 'fr' or 'en'
 * ```
 */
export function getCurrentLanguage(): Language {
  // Return default if not yet initialized (prevents race condition)
  if (!i18n.isInitialized) {
    return DEFAULT_LANGUAGE;
  }

  const current = i18n.language,

  // Ensure we return a valid Language type
  // Handle cases like 'en-US' by extracting the base language
   baseLanguage = current?.split('-')[0];

  // Use isLanguageSupported for consistent validation
  if (baseLanguage && isLanguageSupported(baseLanguage)) {
    return baseLanguage;
  }

  // Fallback to default if language is not recognized
  return DEFAULT_LANGUAGE;
}

/**
 * Checks if a language code is supported.
 * Uses O(1) Set lookup for efficiency.
 *
 * @param language - The language code to check
 * @returns True if the language is supported
 *
 * @example
 * ```tsx
 * import { isLanguageSupported } from '@/lib/i18n';
 *
 * if (isLanguageSupported(userPreference)) {
 *   changeLanguage(userPreference);
 * }
 * ```
 */
export function isLanguageSupported(language: string): language is Language {
  return SUPPORTED_LANGUAGES_SET.has(language);
}

// ============================================================================
// Type Augmentation for react-i18next
// ============================================================================

/**
 * Type augmentation for react-i18next.
 *
 * @remarks
 * This augmentation provides type safety for the `t` function and `useTranslation` hook.
 * Once translation files are created with proper structure, update the CustomTypeOptions
 * to include the actual translation key types.
 *
 * @see {@link https://react.i18next.com/latest/typescript | react-i18next TypeScript docs}
 *
 * @todo Update with actual translation types after Tasks 3.2 and 3.3
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: Record<string, unknown>;
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

export default i18n;
