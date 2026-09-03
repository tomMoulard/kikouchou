/**
 * @fileoverview Test utilities for the Kikoushou application.
 * Provides custom render functions, helpers, and re-exports testing library utilities.
 *
 * @module test/utils
 *
 * @example
 * ```tsx
 * import { render, screen, userEvent } from '@/test/utils';
 *
 * test('button click works', async () => {
 *   const user = userEvent.setup();
 *   render(<MyComponent />);
 *   await user.click(screen.getByRole('button'));
 *   expect(screen.getByText('Clicked')).toBeInTheDocument();
 * });
 * ```
 */

import type { ReactElement, ReactNode } from 'react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import type { i18n as I18nInstance, Resource } from 'i18next';

import { render as rtlRender } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { AppProviders } from '@/contexts/AppProviders';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Options for the custom render function.
 * Extends RTL RenderOptions with routing configuration.
 */
export interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  /**
   * Initial route for MemoryRouter.
   * @default '/'
   */
  readonly initialRoute?: string;

  /**
   * Array of initial history entries for MemoryRouter.
   * If provided, takes precedence over initialRoute.
   */
  readonly initialEntries?: string[];

  /**
   * Whether to wrap with AppProviders.
   * Set to false for testing components in isolation.
   * @default true
   */
  readonly withProviders?: boolean;
}

/**
 * Result of the custom render function.
 * Extends RTL RenderResult with additional utilities.
 */
export interface CustomRenderResult extends RenderResult {
  /**
   * User event instance for simulating user interactions.
   */
  readonly user: ReturnType<typeof userEvent.setup>;
}

// ============================================================================
// Wrapper Components
// ============================================================================

/**
 * Props for the AllProviders wrapper component.
 */
interface AllProvidersProps {
  readonly children: ReactNode;
  readonly initialEntries: string[];
}

/**
 * Wrapper component that provides all application context providers and routing.
 *
 * @param props - Wrapper props including children and initial route entries
 * @returns Wrapped component tree
 */
function AllProviders({ children, initialEntries }: AllProvidersProps): ReactElement {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AppProviders>{children}</AppProviders>
    </MemoryRouter>
  );
}

/**
 * Props for the RouterOnly wrapper component.
 */
interface RouterOnlyProps {
  readonly children: ReactNode;
  readonly initialEntries: string[];
}

/**
 * Wrapper component that provides only routing without context providers.
 * Useful for testing components that don't depend on application contexts.
 *
 * @param props - Wrapper props including children and initial route entries
 * @returns Wrapped component tree
 */
function RouterOnly({ children, initialEntries }: RouterOnlyProps): ReactElement {
  return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
}

// ============================================================================
// Custom Render Function
// ============================================================================

/**
 * Custom render function that wraps components with application providers.
 *
 * @param ui - React element to render
 * @param options - Render options including routing configuration
 * @returns Render result with user event instance
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { user } = render(<MyComponent />);
 * await user.click(screen.getByRole('button'));
 *
 * // With initial route
 * render(<MyComponent />, { initialRoute: '/trips/123' });
 *
 * // With multiple history entries
 * render(<MyComponent />, { initialEntries: ['/trips', '/trips/123'] });
 *
 * // Without providers (isolated testing)
 * render(<MyComponent />, { withProviders: false });
 * ```
 */
export function render(
  ui: ReactElement,
  options: CustomRenderOptions = {}
): CustomRenderResult {
  return renderInternal(ui, options);
}

/**
 * Options {@link render} accepts, plus the outermost wrapper that
 * {@link renderWithRealI18n} needs and no caller outside this module may set.
 *
 * @internal
 */
interface InternalRenderOptions extends CustomRenderOptions {
  /**
   * Wraps the *whole* tree — router and app providers included, not just the
   * element under test. An i18next provider has to sit out there: the
   * providers in {@link AppProviders} translate too, and a provider nested
   * inside them would leave their strings resolving against a different
   * instance.
   */
  readonly outerWrapper?: (children: ReactNode) => ReactElement;
}

/**
 * The single render path. {@link render} and {@link renderWithRealI18n} differ
 * only in whether they pass an `outerWrapper`, so the routing, provider and
 * user-event setup below stays in one place.
 *
 * @param ui - React element to render
 * @param options - Render options, including the internal outer wrapper
 * @returns Render result with user event instance
 * @internal
 */
function renderInternal(
  ui: ReactElement,
  options: InternalRenderOptions
): CustomRenderResult {
  const {
    initialRoute = '/',
    initialEntries,
    withProviders = true,
    outerWrapper,
    ...renderOptions
  } = options;

  // Determine initial entries for MemoryRouter
  const entries = initialEntries ?? [initialRoute];

  // Create user event instance
  const user = userEvent.setup();

  // Create wrapper function
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    const tree = withProviders ? (
      <AllProviders initialEntries={entries}>{children}</AllProviders>
    ) : (
      <RouterOnly initialEntries={entries}>{children}</RouterOnly>
    );

    return outerWrapper ? outerWrapper(tree) : tree;
  }

  // Render with wrapper
  const result = rtlRender(ui, { wrapper: Wrapper, ...renderOptions });

  return {
    ...result,
    user,
  };
}

// ============================================================================
// Real i18n Rendering
// ============================================================================

/**
 * A language the app ships a bundle for.
 *
 * Mirrors `SUPPORTED_LANGUAGES` in `@/lib/i18n`, which cannot be imported here:
 * `src/test/setup.ts` mocks that module for the whole suite.
 */
export type TestLanguage = 'en' | 'fr';

/** Every language {@link renderWithRealI18n} loads, in both directions. */
const TEST_LANGUAGES: readonly TestLanguage[] = ['en', 'fr'];

/**
 * The language a test renders in unless it says otherwise.
 *
 * Matches the language the suite-wide mock reports, so switching a file over to
 * {@link renderWithRealI18n} changes the *strings* under assertion and nothing
 * else.
 */
const DEFAULT_TEST_LANGUAGE: TestLanguage = 'en';

/**
 * The app's fallback language: what a user actually sees for a key the active
 * bundle is missing. Mirrors `DEFAULT_LANGUAGE` in `@/lib/i18n` — which is
 * French, so an English-only key gap is a French string on an English screen,
 * not a raw key.
 */
const FALLBACK_TEST_LANGUAGE: TestLanguage = 'fr';

/** Told to the caller whenever a mocked i18n module reaches the helper. */
const UNMOCK_HINT =
  "Add `vi.unmock('i18next')` and `vi.unmock('react-i18next')` at the top of the " +
  'test file. `src/test/setup.ts` mocks both for the whole suite, and a mocked ' +
  '`t` returns the key instead of the translation, which is exactly what this ' +
  'helper exists to stop.';

/**
 * Reads a named export without letting Vitest's mocked-module proxy throw.
 *
 * A `vi.mock` factory produces a namespace that raises on any export it did not
 * define, so a plain destructure here would surface as
 * `No "createInstance" export is defined on the mock` — true, but it names
 * neither the helper nor the fix.
 *
 * @param module - Imported module namespace
 * @param name - Export to read
 * @returns The export, or undefined when the module is a mock without it
 */
function readExport(module: object, name: string): unknown {
  try {
    return (module as Record<string, unknown>)[name];
  } catch {
    return undefined;
  }
}

/**
 * Imports the real `i18next`, failing loudly when the suite mock is still in
 * place.
 *
 * @returns The unmocked i18next module
 * @throws Error if the test file has not called `vi.unmock('i18next')`
 */
async function importRealI18next(): Promise<typeof import('i18next')> {
  const module = await import('i18next');

  if (typeof readExport(module, 'createInstance') !== 'function') {
    throw new Error(`i18next is still mocked in this test file. ${UNMOCK_HINT}`);
  }

  return module;
}

/**
 * Imports the real `react-i18next`, failing loudly when the suite mock is still
 * in place.
 *
 * @returns The unmocked react-i18next module
 * @throws Error if the test file has not called `vi.unmock('react-i18next')`
 */
async function importRealReactI18next(): Promise<typeof import('react-i18next')> {
  const module = await import('react-i18next');

  if (typeof readExport(module, 'I18nextProvider') !== 'function') {
    throw new Error(`react-i18next is still mocked in this test file. ${UNMOCK_HINT}`);
  }

  return module;
}

/** Parsed once per test file — the two bundles are ~95 KB of JSON together. */
let bundlesPromise: Promise<Resource> | undefined;

/**
 * Loads the shipped locale files as an i18next resource tree.
 *
 * Deliberately a dynamic import: a static one would add the JSON parse to all
 * 186 test files, nearly none of which render real translations.
 *
 * @returns Resources for every {@link TEST_LANGUAGES} entry
 */
async function loadBundles(): Promise<Resource> {
  bundlesPromise ??= (async () => {
    const [en, fr] = await Promise.all([
      import('@/locales/en/translation.json'),
      import('@/locales/fr/translation.json'),
    ]);

    return {
      en: { translation: en.default },
      fr: { translation: fr.default },
    } satisfies Resource;
  })();

  return bundlesPromise;
}

/** One instance per language per test file; building one parses both bundles. */
const instancesByLanguage = new Map<TestLanguage, Promise<I18nInstance>>();

/**
 * Builds a real i18next instance over the shipped locale files.
 *
 * @param language - Language to render in
 * @returns An initialised i18next instance
 */
async function initRealI18n(language: TestLanguage): Promise<I18nInstance> {
  const [{ createInstance }, { initReactI18next }, resources] = await Promise.all([
    importRealI18next(),
    importRealReactI18next(),
    loadBundles(),
  ]);

  const instance = createInstance();

  // Mirrors src/lib/i18n's init, minus the browser language detector: a test
  // states the language it is asserting rather than inheriting jsdom's.
  await instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: FALLBACK_TEST_LANGUAGE,
    supportedLngs: [...TEST_LANGUAGES],
    defaultNS: 'translation',
    ns: ['translation'],
    resources,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

  return instance;
}

/**
 * Returns a real i18next instance for the given language, built from the two
 * bundles the app ships.
 *
 * Use it when the assertion is about a string rather than a component: plural
 * selection, interpolation, or the French wording of a key. To assert what a
 * component renders, prefer {@link renderWithRealI18n}.
 *
 * The test file must unmock both i18n modules first — see {@link UNMOCK_HINT}.
 *
 * @param language - Language to resolve keys in (default: `'en'`)
 * @returns An initialised i18next instance, cached per language per test file
 *
 * @example
 * ```tsx
 * vi.unmock('i18next');
 * vi.unmock('react-i18next');
 *
 * const i18n = await createRealI18n('fr');
 * expect(i18n.t('calendar.nights', { count: 0 })).toBe('0 nuit');
 * ```
 */
export function createRealI18n(
  language: TestLanguage = DEFAULT_TEST_LANGUAGE
): Promise<I18nInstance> {
  const cached = instancesByLanguage.get(language);

  if (cached) {
    return cached;
  }

  // Drop a failed instance rather than caching the rejection, so a second call
  // reports the same problem instead of an unrelated "already rejected".
  const created = initRealI18n(language).catch((error: unknown) => {
    instancesByLanguage.delete(language);
    throw error;
  });

  instancesByLanguage.set(language, created);

  return created;
}

/**
 * Options for {@link renderWithRealI18n}.
 */
export interface RealI18nRenderOptions extends CustomRenderOptions {
  /**
   * Language to render in.
   * @default 'en'
   */
  readonly language?: TestLanguage;
}

/**
 * Result of {@link renderWithRealI18n}.
 */
export interface RealI18nRenderResult extends CustomRenderResult {
  /** The instance the tree renders through, for `t()` in expectations. */
  readonly i18n: I18nInstance;
}

/**
 * Renders through a real i18next over the shipped locale files, instead of the
 * suite-wide mock that returns translation keys verbatim.
 *
 * @remarks
 * `src/test/setup.ts` mocks `react-i18next` so that `t('common.save')` returns
 * `'common.save'`. That keeps 186 test files free of translation churn, at a
 * price: an assertion on a key proves nothing about the catalogue. Delete both
 * locale files and every one of those tests still passes. Plural selection is
 * never exercised (the mock drops `count`), French is unreachable, and an
 * accessible name asserted as `common.save` is a name no user ever hears.
 *
 * This helper is the opt-in escape hatch. Reach for it where a translation
 * regression would actually hurt — icon-only controls whose accessible name is
 * their only label, counted strings, and anything whose French wording differs
 * in form from its English.
 *
 * It is deliberately **not** the default: converting the whole suite is a much
 * larger change, and key-identity rendering is genuinely convenient for tests
 * about behaviour rather than wording.
 *
 * The test file must unmock both i18n modules first — `vi.mock` and
 * `vi.unmock` are per-file, so no helper can do it on the caller's behalf.
 *
 * @param ui - React element to render
 * @param options - Render options, plus the language to render in
 * @returns Render result with the user event instance and the i18next instance
 *
 * @example
 * ```tsx
 * vi.unmock('i18next');
 * vi.unmock('react-i18next');
 *
 * it('names the previous-month button in French', async () => {
 *   await renderWithRealI18n(<CalendarHeader {...props} />, {
 *     language: 'fr',
 *     withProviders: false,
 *   });
 *
 *   expect(screen.getByRole('button', { name: 'Mois précédent' })).toBeInTheDocument();
 * });
 * ```
 */
export async function renderWithRealI18n(
  ui: ReactElement,
  options: RealI18nRenderOptions = {}
): Promise<RealI18nRenderResult> {
  const { language = DEFAULT_TEST_LANGUAGE, ...renderOptions } = options;

  const [instance, { I18nextProvider }] = await Promise.all([
    createRealI18n(language),
    importRealReactI18next(),
  ]);

  const result = renderInternal(ui, {
    ...renderOptions,
    outerWrapper: (children) => (
      <I18nextProvider i18n={instance}>{children}</I18nextProvider>
    ),
  });

  return {
    ...result,
    i18n: instance,
  };
}

// ============================================================================
// Database Test Helpers
// ============================================================================

/**
 * Wait for IndexedDB operations to complete.
 * Useful when testing components that perform async database operations.
 *
 * @param ms - Milliseconds to wait (default: 10, allows microtasks to flush)
 * @returns Promise that resolves after the specified delay
 *
 * @remarks
 * IndexedDB operations are microtask-based and may require multiple event loop
 * ticks to complete. This helper provides a reliable way to wait for them.
 *
 * @example
 * ```tsx
 * await waitForDb();
 * expect(screen.getByText('Trip loaded')).toBeInTheDocument();
 * ```
 */
export async function waitForDb(ms = 10): Promise<void> {
  // Wait for specified time
  await new Promise((resolve) => setTimeout(resolve, ms));
  // Additional flush for microtasks
  await Promise.resolve();
}

/**
 * Create test data in the database.
 * Helper for setting up test scenarios with pre-populated data.
 *
 * @param data - Trip data
 * @returns Created trip ID
 * @throws Error if trip creation fails
 *
 * @example
 * ```tsx
 * import { createTestTrip, render, screen } from '@/test/utils';
 * import type { TripId } from '@/types';
 *
 * const tripId = await createTestTrip({ name: 'Test Trip', startDate: '2024-01-01' });
 * render(<TripList />);
 * expect(screen.getByText('Test Trip')).toBeInTheDocument();
 * ```
 */
export async function createTestTrip(data: {
  name: string;
  startDate: string;
  endDate?: string;
  location?: string;
}): Promise<import('@/types').TripId> {
  try {
    const { createTrip } = await import('@/lib/db/repositories/trip-repository');
    const { toISODateStringFromString } = await import('@/lib/db/utils');
    const trip = await createTrip({
      name: data.name,
      startDate: toISODateStringFromString(data.startDate),
      endDate: toISODateStringFromString(data.endDate ?? data.startDate),
      location: data.location,
    });
    return trip.id;
  } catch (error) {
    throw new Error(
      `Failed to create test trip "${data.name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

/**
 * Create a test person in the database.
 *
 * @param tripId - ID of the trip to add the person to
 * @param data - Person data
 * @returns Created person ID
 * @throws Error if person creation fails
 */
export async function createTestPerson(
  tripId: import('@/types').TripId,
  data: { name: string; color?: string }
): Promise<import('@/types').PersonId> {
  try {
    const { createPerson } = await import('@/lib/db/repositories/person-repository');
    const { toHexColor } = await import('@/lib/db/utils');
    const person = await createPerson(tripId, {
      name: data.name,
      color: toHexColor(data.color ?? '#3b82f6'),
    });
    return person.id;
  } catch (error) {
    throw new Error(
      `Failed to create test person "${data.name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

/**
 * Create a test room in the database.
 *
 * @param tripId - ID of the trip to add the room to
 * @param data - Room data
 * @returns Created room ID
 * @throws Error if room creation fails
 */
export async function createTestRoom(
  tripId: import('@/types').TripId,
  data: { name: string; capacity?: number; description?: string }
): Promise<import('@/types').RoomId> {
  try {
    const { createRoom } = await import('@/lib/db/repositories/room-repository');
    const room = await createRoom(tripId, {
      name: data.name,
      capacity: data.capacity ?? 2,
      description: data.description,
    });
    return room.id;
  } catch (error) {
    throw new Error(
      `Failed to create test room "${data.name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

// ============================================================================
// Branded Type Test Helpers
// ============================================================================

import type { HexColor, ISODateString } from '@/types';

/**
 * Creates an ISODateString for use in tests.
 * This is a type-safe way to create test fixtures with branded types.
 *
 * @param value - A valid YYYY-MM-DD string
 * @returns Branded ISODateString
 * @example
 * ```tsx
 * const trip = {
 *   startDate: isoDate('2024-07-15'),
 *   endDate: isoDate('2024-07-20'),
 * };
 * ```
 */
export function isoDate(value: string): ISODateString {
  return value as ISODateString;
}

/**
 * Creates a HexColor for use in tests.
 * This is a type-safe way to create test fixtures with branded types.
 *
 * @param value - A valid #RRGGBB string
 * @returns Branded HexColor
 * @example
 * ```tsx
 * const person = {
 *   color: hexColor('#ef4444'),
 * };
 * ```
 */
export function hexColor(value: string): HexColor {
  return value as HexColor;
}

// ============================================================================
// Re-exports
// ============================================================================

// Re-export everything from @testing-library/react
// This includes: screen, within, waitFor, waitForElementToBeRemoved, etc.
export * from '@testing-library/react';

// Re-export userEvent for user interaction simulation
export { userEvent };

// Re-export branded type helpers from utils for convenience
export { toISODateStringFromString, toHexColor } from '@/lib/db/utils';
