/**
 * @fileoverview Global test setup for Vitest.
 * Configures testing environment with DOM matchers, IndexedDB mocking,
 * and browser API polyfills.
 *
 * @remarks
 * IMPORTANT: fake-indexeddb/auto MUST be imported before any Dexie code
 * to ensure IndexedDB is properly mocked.
 *
 * @module test/setup
 */

// ============================================================================
// IndexedDB Mock (MUST be first import)
// ============================================================================

// Import fake-indexeddb before any Dexie code executes
import 'fake-indexeddb/auto';

// ============================================================================
// Testing Library Extensions
// ============================================================================

import '@testing-library/jest-dom';

// ============================================================================
// Imports
// ============================================================================

import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

// Import database statically (after fake-indexeddb is loaded)
import { db } from '@/lib/db/database';

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Initialize database once at the start of each test file.
 * This ensures the database schema is created before any tests run.
 */
beforeAll(async () => {
  try {
    // Close if already open from previous test file
    if (db.isOpen()) {
      db.close();
    }
    // Delete and recreate for clean schema
    await db.delete();
    await db.open();
  } catch (error) {
    console.error('Failed to initialize test database:', error);
    throw new Error(
      `Database initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
});

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

/**
 * Clear all database tables before each test to ensure test isolation.
 * This is more efficient than delete/recreate cycle and prevents test pollution.
 */
beforeEach(async () => {
  try {
    // Ensure database is open
    if (!db.isOpen()) {
      await db.open();
    }

    // Clear every table in a single transaction. The list is DERIVED from
    // db.tables rather than hand-maintained: the old literal array silently
    // missed `activities` when DB v6 added it, and `yjsUpdates` before that,
    // leaking rows between tests in whichever file wrote them.
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  } catch (error) {
    console.error('Failed to reset test database:', error);
    throw new Error(
      `Database reset failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
});

/**
 * Cleanup React testing trees after each test.
 * This prevents memory leaks and test pollution.
 *
 * `restoreAllMocks` matters as much as `cleanup`. This hook used to call only
 * `clearAllMocks`, which clears a spy's call history — `mock.calls`, `results`,
 * `instances` — and nothing else. The spy stays installed, and in Vitest 4 it
 * keeps the fake implementation too: `mockClear` does not touch it, only
 * `mockReset` and `mockRestore` do. So `vi.spyOn(console, 'error')
 * .mockImplementation(() => {})` in one test went on swallowing errors for
 * every later test in the file, and a `mockReturnValue` went on returning it.
 * The next test saw a global that quietly did not do what its name says.
 *
 * That is a shared-state channel between tests with no syntax to point at, and
 * it makes the order tests run in part of their meaning.
 * `src/test/mock-restoration.test.ts` pins the fixed behaviour.
 *
 * `restoreAllMocks` only undoes `vi.spyOn` installs, so `clearAllMocks` still
 * runs afterwards to reset call history on the plain `vi.fn()`s in the module
 * mocks and browser stubs below — which are meant to live for the whole file.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ============================================================================
// Browser API Mocks
// ============================================================================

/**
 * Mock window.matchMedia for responsive component tests.
 * Returns a mock MediaQueryList that matches nothing by default.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated but still used by some libraries
    removeListener: vi.fn(), // Deprecated but still used by some libraries
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

/**
 * Mock ResizeObserver for Radix UI components.
 * Many Radix primitives use ResizeObserver for layout calculations.
 */
class MockResizeObserver {
  observe(): void {
    // No-op
  }
  unobserve(): void {
    // No-op
  }
  disconnect(): void {
    // No-op
  }
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});

/**
 * Mock IntersectionObserver for lazy loading and visibility tests.
 */
class MockIntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];

  observe(): void {
    // No-op
  }
  unobserve(): void {
    // No-op
  }
  disconnect(): void {
    // No-op
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});

/**
 * Mock scrollTo for components that programmatically scroll.
 */
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

/**
 * Mock URL.createObjectURL for file/blob handling in tests.
 */
if (typeof URL.createObjectURL === 'undefined') {
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: vi.fn(() => 'blob:mock-url'),
  });
}

if (typeof URL.revokeObjectURL === 'undefined') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    value: vi.fn(),
  });
}

// ============================================================================
// i18n Mock
// ============================================================================

/**
 * The language the suite renders in.
 *
 * `en` is what the real detector picks here: jsdom reports `navigator.language`
 * as `en-US`, nothing has written `i18nextLng` to localStorage, and the app
 * detects `localStorage → navigator`. So the mocks below agree with the app
 * rather than inventing a third answer.
 *
 * This is *not* `DEFAULT_LANGUAGE`. That constant is the **fallback** — the
 * language a user gets for a key the active bundle is missing, which is French.
 * The two used to sit side by side as bare literals (`language: 'en'` next to
 * `DEFAULT_LANGUAGE: 'fr'`) and read as a contradiction; they are answers to
 * different questions, and both are right. Naming them separately is the fix:
 * the active language now has one definition that all three mocks share, so it
 * cannot drift, and the fallback keeps mirroring the real module's export.
 *
 * Nothing in this file can exercise the fallback, because `t` returns the key —
 * a missing translation and a present one are indistinguishable. Tests that
 * need the real resolution path (plural selection, French wording, accessible
 * names) opt in with `renderWithRealI18n` from `@/test/utils`.
 */
const { TEST_LANGUAGE, FALLBACK_LANGUAGE } = vi.hoisted(() => ({
  TEST_LANGUAGE: 'en' as const,
  FALLBACK_LANGUAGE: 'fr' as const,
}));

/**
 * Mock react-i18next to return translation keys directly.
 * This simplifies testing by avoiding async i18n loading.
 */
vi.mock('react-i18next', () => ({
  // Mock useTranslation hook
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      // Return key with interpolated values for debugging
      if (options && typeof options === 'object') {
        let result = key;
        for (const [k, v] of Object.entries(options)) {
          if (k !== 'count' && k !== 'context') {
            result = result.replace(`{{${k}}}`, String(v));
          }
        }
        return result;
      }
      return key;
    },
    i18n: {
      language: TEST_LANGUAGE,
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockReturnValue(true),
    },
  }),

  // Mock Trans component - returns children directly
  Trans: ({ children }: { readonly children?: unknown }) => children,

  // Mock initReactI18next
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
}));

/**
 * Mock i18next core module
 */
vi.mock('i18next', () => ({
  default: {
    use: vi.fn().mockReturnThis(),
    init: vi.fn().mockResolvedValue(undefined),
    t: (key: string) => key,
    changeLanguage: vi.fn().mockResolvedValue(undefined),
    language: TEST_LANGUAGE,
  },
}));

/**
 * Mock the application's i18n module
 */
vi.mock('@/lib/i18n', () => ({
  default: {
    t: (key: string) => key,
    changeLanguage: vi.fn().mockResolvedValue(undefined),
    language: TEST_LANGUAGE,
  },
  i18nReady: Promise.resolve(),
  changeLanguage: vi.fn().mockResolvedValue(undefined),
  // The *active* language, and so the same value the two mocks above report.
  getCurrentLanguage: vi.fn().mockReturnValue(TEST_LANGUAGE),
  isLanguageSupported: vi.fn().mockReturnValue(true),
  isI18nInitialized: vi.fn().mockReturnValue(true),
  // The set the app supports, which is not derived from either constant above:
  // it happens to contain both, and building it out of them would collapse to
  // ['fr', 'fr'] the moment someone runs the suite in French.
  SUPPORTED_LANGUAGES: ['en', 'fr'],
  // The *fallback*, mirroring the real module's export. Not the active
  // language: see the note above TEST_LANGUAGE.
  DEFAULT_LANGUAGE: FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY: 'i18nextLng',
}));

// ============================================================================
// Console Suppression (Optional)
// ============================================================================

/**
 * Optionally suppress specific console warnings during tests.
 * Uncomment to reduce noise from known warnings.
 */
// const originalWarn = console.warn;
// console.warn = (...args: unknown[]) => {
//   const message = args[0];
//   if (typeof message === 'string') {
//     // Suppress known warnings
//     if (message.includes('ReactDOM.render is no longer supported')) return;
//   }
//   originalWarn.apply(console, args);
// };
