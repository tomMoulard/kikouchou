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
      `Database initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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

    // Clear all tables in a single transaction for efficiency
    await db.transaction(
      'rw',
      [db.trips, db.rooms, db.persons, db.roomAssignments, db.transports, db.settings],
      async () => {
        await Promise.all([
          db.trips.clear(),
          db.rooms.clear(),
          db.persons.clear(),
          db.roomAssignments.clear(),
          db.transports.clear(),
          db.settings.clear(),
        ]);
      }
    );
  } catch (error) {
    console.error('Failed to reset test database:', error);
    throw new Error(
      `Database reset failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
});

/**
 * Cleanup React testing trees after each test.
 * This prevents memory leaks and test pollution.
 */
afterEach(() => {
  cleanup();
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
      language: 'en',
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
    language: 'en',
  },
}));

/**
 * Mock the application's i18n module
 */
vi.mock('@/lib/i18n', () => ({
  default: {
    t: (key: string) => key,
    changeLanguage: vi.fn().mockResolvedValue(undefined),
    language: 'en',
  },
  i18nReady: Promise.resolve(),
  changeLanguage: vi.fn().mockResolvedValue(undefined),
  getCurrentLanguage: vi.fn().mockReturnValue('en'),
  isLanguageSupported: vi.fn().mockReturnValue(true),
  isI18nInitialized: vi.fn().mockReturnValue(true),
  SUPPORTED_LANGUAGES: ['en', 'fr'],
  DEFAULT_LANGUAGE: 'fr',
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
