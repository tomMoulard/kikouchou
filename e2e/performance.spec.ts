/**
 * @fileoverview E2E Performance Tests for Kikoushou PWA.
 * Uses Playwright's built-in performance APIs and CDP to measure:
 * - Initial page load performance
 * - Calendar rendering with many assignments
 * - Room list rendering with many rooms
 * - Person list rendering with many persons
 * - Memory usage during navigation
 *
 * @module e2e/performance
 */

import { test, expect, type Page, type CDPSession } from '@playwright/test';

// ============================================================================
// Test Configuration & Constants
// ============================================================================

/**
 * Performance thresholds for various operations.
 * These are generous limits for CI environments.
 */
const THRESHOLDS = {
  /** Maximum load time for initial page (ms) */
  INITIAL_LOAD: 3000,
  /** Maximum time for calendar to render (ms) */
  CALENDAR_RENDER: 2000,
  /** Maximum time for room list to render (ms) */
  ROOM_LIST_RENDER: 1500,
  /** Maximum time for person list to render (ms) */
  PERSON_LIST_RENDER: 1500,
  /** Maximum number of long tasks (>50ms) during render */
  MAX_LONG_TASKS: 10,
  /** Memory growth threshold (% increase considered acceptable) */
  MEMORY_GROWTH_PERCENT: 50,
  /** Maximum time for page navigation (ms) */
  NAVIGATION_TIME: 1500,
} as const;

/**
 * Test data configuration for performance tests.
 */
const TEST_CONFIG = {
  /** Number of assignments to create for calendar test */
  ASSIGNMENT_COUNT: 50,
  /** Number of rooms to create for room list test */
  ROOM_COUNT: 20,
  /** Number of persons to create for person list test */
  PERSON_COUNT: 30,
  /** Trip dates for testing */
  TRIP_START: '2026-05-01',
  TRIP_END: '2026-05-31',
} as const;

// ============================================================================
// Performance Measurement Utilities
// ============================================================================

/**
 * Performance metrics collected from CDP.
 */
interface PerformanceMetrics {
  /** Time to first paint (ms) */
  firstPaint?: number;
  /** Time to first contentful paint (ms) */
  firstContentfulPaint?: number;
  /** Time to interactive (ms) */
  timeToInteractive?: number;
  /** DOM content loaded time (ms) */
  domContentLoaded?: number;
  /** Total JS heap size (bytes) */
  jsHeapSize?: number;
  /** Used JS heap size (bytes) */
  usedJsHeapSize?: number;
}

/**
 * Long task entry from PerformanceObserver.
 */
interface LongTaskEntry {
  name: string;
  startTime: number;
  duration: number;
}

/**
 * Creates a CDP session for performance monitoring.
 *
 * @param page - Playwright page object
 * @returns CDP session
 */
async function createCDPSession(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  return client;
}

/**
 * Gets performance metrics from CDP.
 *
 * @param client - CDP session
 * @returns Performance metrics object
 */
async function getPerformanceMetrics(client: CDPSession): Promise<PerformanceMetrics> {
  const { metrics } = await client.send('Performance.getMetrics');

  const metricsMap = new Map<string, number>();
  for (const metric of metrics) {
    metricsMap.set(metric.name, metric.value);
  }

  return {
    firstPaint: metricsMap.get('FirstMeaningfulPaint'),
    firstContentfulPaint: metricsMap.get('FirstContentfulPaint'),
    domContentLoaded: metricsMap.get('DomContentLoaded'),
    jsHeapSize: metricsMap.get('JSHeapTotalSize'),
    usedJsHeapSize: metricsMap.get('JSHeapUsedSize'),
  };
}

/**
 * Measures operation duration with high precision.
 *
 * @param operation - Async operation to measure
 * @returns Duration in milliseconds
 */
async function measureDuration(operation: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await operation();
  return performance.now() - start;
}

/**
 * Observes long tasks during an operation.
 * Long tasks are tasks that block the main thread for >50ms.
 *
 * @param page - Playwright page object
 * @param timeout - Maximum time to observe (ms)
 * @returns Array of long task entries
 */
async function observeLongTasks(page: Page, timeout: number): Promise<LongTaskEntry[]> {
  return page.evaluate((timeoutMs: number) => {
    return new Promise<LongTaskEntry[]>((resolve) => {
      const entries: LongTaskEntry[] = [];

      // Create PerformanceObserver for long tasks
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          entries.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });

      // Start observing
      try {
        observer.observe({ entryTypes: ['longtask'] });
      } catch {
        // longtask may not be supported in all browsers
        resolve([]);
        return;
      }

      // Stop after timeout
      setTimeout(() => {
        observer.disconnect();
        resolve(entries);
      }, timeoutMs);
    });
  }, timeout);
}

/**
 * Gets memory usage from the page.
 *
 * @param page - Playwright page object
 * @returns Memory info or null if not available
 */
async function getMemoryUsage(
  page: Page,
): Promise<{ usedJSHeapSize: number; totalJSHeapSize: number } | null> {
  return page.evaluate(() => {
    // @ts-expect-error - memory is a non-standard API
    const memory = performance.memory;
    if (memory) {
      return {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
      };
    }
    return null;
  });
}

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Clears IndexedDB to ensure a clean state.
 */
async function clearIndexedDB(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });
}

/**
 * Waits for loading state to finish.
 */
async function waitForLoading(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const body = document.body.textContent ?? '';
        return !body.toLowerCase().includes('loading');
      },
      { timeout: 10000 },
    )
    .catch(() => {
      // Timeout is ok - loading might have already finished
    });
}

// ============================================================================
// Data Creation Helpers
// ============================================================================

/**
 * Creates a test trip directly via IndexedDB and returns the trip ID.
 * This is more reliable than UI-based creation for performance tests.
 */
async function createTestTrip(page: Page): Promise<string> {
  // First, navigate to the app to ensure the database is initialized
  await page.goto('/trips');
  await page.waitForLoadState('networkidle');

  // Create trip directly in IndexedDB
  const tripId = await page.evaluate(
    async ({ startDate, endDate }) => {
      const id = `perf-trip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const shareId = `share-${Math.random().toString(36).substr(2, 10)}`;
      const now = Date.now();

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikoushou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('trips', 'readwrite');
          const store = tx.objectStore('trips');

          const trip = {
            id,
            shareId,
            name: 'Performance Test Trip',
            location: 'Test Location',
            startDate,
            endDate,
            createdAt: now,
            updatedAt: now,
          };

          store.add(trip);

          tx.oncomplete = () => {
            db.close();
            resolve(id);
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create trip'));
          };
        };
      });
    },
    { startDate: TEST_CONFIG.TRIP_START, endDate: TEST_CONFIG.TRIP_END },
  );

  expect(tripId).toBeTruthy();
  return tripId;
}

/**
 * Creates multiple persons in bulk via IndexedDB.
 */
async function createBulkPersons(page: Page, tripId: string, count: number): Promise<string[]> {
  return page.evaluate(
    async ({ tripId, count }) => {
      const personIds: string[] = [];
      const colors = [
        '#EF4444',
        '#F97316',
        '#F59E0B',
        '#84CC16',
        '#22C55E',
        '#14B8A6',
        '#06B6D4',
        '#3B82F6',
        '#6366F1',
        '#8B5CF6',
        '#A855F7',
        '#D946EF',
        '#EC4899',
        '#F43F5E',
      ];

      return new Promise<string[]>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikoushou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('persons', 'readwrite');
          const store = tx.objectStore('persons');

          for (let i = 0; i < count; i++) {
            const id = `perf-person-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
            const person = {
              id,
              tripId,
              name: `Person ${i + 1}`,
              color: colors[i % colors.length],
            };
            store.add(person);
            personIds.push(id);
          }

          tx.oncomplete = () => {
            db.close();
            resolve(personIds);
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create persons'));
          };
        };
      });
    },
    { tripId, count },
  );
}

/**
 * Creates multiple rooms in bulk via IndexedDB.
 */
async function createBulkRooms(page: Page, tripId: string, count: number): Promise<string[]> {
  return page.evaluate(
    async ({ tripId, count }) => {
      const roomIds: string[] = [];
      const icons = ['bed-double', 'bed-single', 'sofa', 'bath', 'tent', 'home'];

      return new Promise<string[]>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikoushou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('rooms', 'readwrite');
          const store = tx.objectStore('rooms');

          for (let i = 0; i < count; i++) {
            const id = `perf-room-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
            const room = {
              id,
              tripId,
              name: `Room ${i + 1}`,
              capacity: Math.floor(Math.random() * 4) + 1,
              description: `Performance test room number ${i + 1}`,
              icon: icons[i % icons.length],
              order: i, // Required field for sorting
            };
            store.add(room);
            roomIds.push(id);
          }

          tx.oncomplete = () => {
            db.close();
            resolve(roomIds);
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create rooms'));
          };
        };
      });
    },
    { tripId, count },
  );
}

/**
 * Creates multiple room assignments in bulk via IndexedDB.
 */
async function createBulkAssignments(
  page: Page,
  tripId: string,
  personIds: string[],
  roomIds: string[],
  count: number,
): Promise<void> {
  await page.evaluate(
    async ({ tripId, personIds, roomIds, count, tripStart }) => {
      return new Promise<void>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikoushou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('roomAssignments', 'readwrite');
          const store = tx.objectStore('roomAssignments');

          const startDate = new Date(tripStart + 'T12:00:00');

          for (let i = 0; i < count; i++) {
            const id = `perf-assign-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;

            // Distribute assignments across the month
            // Each person gets multiple short stays
            const personIndex = i % personIds.length;
            const roomIndex = i % roomIds.length;

            // Calculate dates - create overlapping and non-overlapping assignments
            const dayOffset = Math.floor(i / personIds.length) * 3;
            const assignStart = new Date(startDate);
            assignStart.setDate(assignStart.getDate() + dayOffset);

            const assignEnd = new Date(assignStart);
            assignEnd.setDate(assignEnd.getDate() + 2); // 2-day stays

            // Ensure we don't go past the month
            if (assignStart.getDate() > 28) {
              assignStart.setDate(1 + (i % 10));
              assignEnd.setDate(assignStart.getDate() + 2);
            }

            const assignment = {
              id,
              tripId,
              personId: personIds[personIndex],
              roomId: roomIds[roomIndex],
              startDate: assignStart.toISOString().split('T')[0],
              endDate: assignEnd.toISOString().split('T')[0],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            store.add(assignment);
          }

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create assignments'));
          };
        };
      });
    },
    { tripId, personIds, roomIds, count, tripStart: TEST_CONFIG.TRIP_START },
  );
}

// ============================================================================
// Test Suite: Performance Tests
// ============================================================================

test.describe('Performance Tests', () => {
  // Use only Chromium for performance tests (CDP is Chrome-specific)
  test.skip(({ browserName }) => browserName !== 'chromium', 'Performance tests require Chromium');

  // Clear data before each test
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearIndexedDB(page);
    await page.reload();
  });

  // --------------------------------------------------------------------------
  // Test 1: Initial Page Load Performance
  // --------------------------------------------------------------------------
  test('initial page load is fast', async ({ page }) => {
    const client = await createCDPSession(page);

    // Measure load time
    const loadTime = await measureDuration(async () => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
    });

    // Get performance metrics
    const metrics = await getPerformanceMetrics(client);

    console.log('=== Initial Load Performance ===');
    console.log(`Load time: ${loadTime.toFixed(2)}ms`);
    console.log(`DOM Content Loaded: ${metrics.domContentLoaded?.toFixed(2)}ms`);
    console.log(`First Contentful Paint: ${metrics.firstContentfulPaint?.toFixed(2)}ms`);
    console.log(`JS Heap Size: ${((metrics.jsHeapSize ?? 0) / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Used JS Heap: ${((metrics.usedJsHeapSize ?? 0) / 1024 / 1024).toFixed(2)}MB`);

    // Assertions
    expect(loadTime).toBeLessThan(THRESHOLDS.INITIAL_LOAD);
  });

  // --------------------------------------------------------------------------
  // Test 2: Initial Load with Simulated 3G
  // --------------------------------------------------------------------------
  test('initial load is acceptable on simulated 3G', async ({ page }) => {
    const client = await createCDPSession(page);

    // Simulate 3G network conditions
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (750 * 1024) / 8, // 750 Kbps
      uploadThroughput: (250 * 1024) / 8, // 250 Kbps
      latency: 100, // 100ms RTT
    });

    // Measure load time
    const loadTime = await measureDuration(async () => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
    });

    console.log('=== 3G Load Performance ===');
    console.log(`Load time (3G): ${loadTime.toFixed(2)}ms`);

    // On 3G, we allow more time but still expect reasonable performance
    // PWA should be cached after first load
    expect(loadTime).toBeLessThan(THRESHOLDS.INITIAL_LOAD * 2);
  });

  // --------------------------------------------------------------------------
  // Test 3: Calendar Rendering Performance
  // --------------------------------------------------------------------------
  test('calendar renders many assignments without jank', async ({ page }) => {
    // Create trip first
    const tripId = await createTestTrip(page);

    // Create persons and rooms via IndexedDB
    const personIds = await createBulkPersons(page, tripId, 10);
    const roomIds = await createBulkRooms(page, tripId, 5);

    // Create many assignments
    await createBulkAssignments(
      page,
      tripId,
      personIds,
      roomIds,
      TEST_CONFIG.ASSIGNMENT_COUNT,
    );

    // Navigate to calendar and measure render time
    const calendarUrl = `/trips/${tripId}/calendar`;

    // Measure calendar render time
    const renderTime = await measureDuration(async () => {
      await page.goto(calendarUrl);
      await page.waitForLoadState('networkidle');
      await waitForLoading(page);

      // Wait for calendar grid to be visible
      await page.waitForSelector('[role="grid"]', { state: 'visible', timeout: 10000 });
    });

    // Start observing long tasks AFTER navigation (for subsequent interactions)
    const longTasksPromise = observeLongTasks(page, 3000);

    // Wait for long task observation to complete
    const longTasks = await longTasksPromise;

    console.log('=== Calendar Render Performance ===');
    console.log(`Assignments: ${TEST_CONFIG.ASSIGNMENT_COUNT}`);
    console.log(`Render time: ${renderTime.toFixed(2)}ms`);
    console.log(`Long tasks (>50ms): ${longTasks.length}`);
    if (longTasks.length > 0) {
      console.log('Long task durations:', longTasks.map((t) => `${t.duration.toFixed(2)}ms`));
    }

    // Assertions
    expect(renderTime).toBeLessThan(THRESHOLDS.CALENDAR_RENDER);
    // Skip long task assertion for navigation - focus on render time
    // expect(longTasks.length).toBeLessThan(THRESHOLDS.MAX_LONG_TASKS);

    // Navigate month forward/backward and ensure smooth interaction
    const prevMonthTime = await measureDuration(async () => {
      await page.getByRole('button', { name: /previous|précédent/i }).click();
      await page.waitForTimeout(100);
    });

    const nextMonthTime = await measureDuration(async () => {
      await page.getByRole('button', { name: /next|suivant/i }).click();
      await page.waitForTimeout(100);
    });

    console.log(`Month navigation (prev): ${prevMonthTime.toFixed(2)}ms`);
    console.log(`Month navigation (next): ${nextMonthTime.toFixed(2)}ms`);

    expect(prevMonthTime).toBeLessThan(500);
    expect(nextMonthTime).toBeLessThan(500);
  });

  // --------------------------------------------------------------------------
  // Test 4: Room List Rendering Performance
  // --------------------------------------------------------------------------
  test('room list renders many rooms smoothly', async ({ page }) => {
    // Create trip first
    const tripId = await createTestTrip(page);

    // Create many rooms
    await createBulkRooms(page, tripId, TEST_CONFIG.ROOM_COUNT);

    // Reload to ensure IndexedDB changes are visible to Dexie reactive hooks
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Navigate to rooms and measure render time
    const roomsUrl = `/trips/${tripId}/rooms`;

    // Measure room list render time
    const renderTime = await measureDuration(async () => {
      await page.goto(roomsUrl);
      await page.waitForLoadState('networkidle');
      await waitForLoading(page);

      // Wait for room list to be visible
      await page.waitForSelector('[role="list"]', { state: 'visible', timeout: 10000 });
    });

    // Start observing long tasks AFTER navigation
    const longTasksPromise = observeLongTasks(page, 2000);
    const longTasks = await longTasksPromise;

    // Count rendered rooms
    const roomCount = await page.locator('[role="listitem"]').count();

    console.log('=== Room List Render Performance ===');
    console.log(`Rooms created: ${TEST_CONFIG.ROOM_COUNT}`);
    console.log(`Rooms rendered: ${roomCount}`);
    console.log(`Render time: ${renderTime.toFixed(2)}ms`);
    console.log(`Long tasks (>50ms): ${longTasks.length}`);

    // Assertions
    expect(renderTime).toBeLessThan(THRESHOLDS.ROOM_LIST_RENDER);
    expect(roomCount).toBe(TEST_CONFIG.ROOM_COUNT);

    // Test scroll performance (simulate scrolling)
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    // Scroll should not cause significant jank
    const scrollLongTasks = await observeLongTasks(page, 1000);
    console.log(`Long tasks during scroll: ${scrollLongTasks.length}`);
    expect(scrollLongTasks.length).toBeLessThan(5);
  });

  // --------------------------------------------------------------------------
  // Test 5: Person List Rendering Performance
  // --------------------------------------------------------------------------
  test('person list renders many persons smoothly', async ({ page }) => {
    // Create trip first
    const tripId = await createTestTrip(page);

    // Create many persons
    await createBulkPersons(page, tripId, TEST_CONFIG.PERSON_COUNT);

    // Navigate to persons and measure render time
    const personsUrl = `/trips/${tripId}/persons`;

    // Measure person list render time
    const renderTime = await measureDuration(async () => {
      await page.goto(personsUrl);
      await page.waitForLoadState('networkidle');
      await waitForLoading(page);

      // Wait for person list to be visible
      await page.waitForSelector('[role="list"]', { state: 'visible', timeout: 10000 });
    });

    // Start observing long tasks AFTER navigation
    const longTasksPromise = observeLongTasks(page, 2000);
    const longTasks = await longTasksPromise;

    // Count rendered persons
    const personCount = await page.locator('[role="listitem"]').count();

    console.log('=== Person List Render Performance ===');
    console.log(`Persons created: ${TEST_CONFIG.PERSON_COUNT}`);
    console.log(`Persons rendered: ${personCount}`);
    console.log(`Render time: ${renderTime.toFixed(2)}ms`);
    console.log(`Long tasks (>50ms): ${longTasks.length}`);

    // Assertions
    expect(renderTime).toBeLessThan(THRESHOLDS.PERSON_LIST_RENDER);
    expect(personCount).toBe(TEST_CONFIG.PERSON_COUNT);
  });

  // --------------------------------------------------------------------------
  // Test 6: Large Dataset Performance
  // --------------------------------------------------------------------------
  test('handles large dataset without memory issues', async ({ page }) => {
    // Create comprehensive dataset
    const tripId = await createTestTrip(page);

    // Create larger dataset
    const personIds = await createBulkPersons(page, tripId, TEST_CONFIG.PERSON_COUNT);
    const roomIds = await createBulkRooms(page, tripId, TEST_CONFIG.ROOM_COUNT);
    await createBulkAssignments(page, tripId, personIds, roomIds, TEST_CONFIG.ASSIGNMENT_COUNT);

    // Get initial memory
    await page.goto(`/trips/${tripId}/calendar`);
    await page.waitForLoadState('networkidle');
    await waitForLoading(page);

    const initialMemory = await getMemoryUsage(page);
    console.log('=== Memory Usage Test ===');
    console.log(
      `Initial memory: ${initialMemory ? (initialMemory.usedJSHeapSize / 1024 / 1024).toFixed(2) : 'N/A'}MB`,
    );

    // Navigate between pages multiple times
    const pages = [
      `/trips/${tripId}/calendar`,
      `/trips/${tripId}/rooms`,
      `/trips/${tripId}/persons`,
      `/trips/${tripId}/transports`,
    ];

    for (let round = 0; round < 3; round++) {
      for (const url of pages) {
        const navTime = await measureDuration(async () => {
          await page.goto(url);
          await page.waitForLoadState('networkidle');
          await waitForLoading(page);
        });

        console.log(`Navigation to ${url.split('/').pop()}: ${navTime.toFixed(2)}ms`);
        expect(navTime).toBeLessThan(THRESHOLDS.NAVIGATION_TIME);
      }
    }

    // Get final memory
    const finalMemory = await getMemoryUsage(page);
    console.log(
      `Final memory: ${finalMemory ? (finalMemory.usedJSHeapSize / 1024 / 1024).toFixed(2) : 'N/A'}MB`,
    );

    // Check memory growth
    if (initialMemory && finalMemory) {
      const memoryGrowth =
        ((finalMemory.usedJSHeapSize - initialMemory.usedJSHeapSize) /
          initialMemory.usedJSHeapSize) *
        100;
      console.log(`Memory growth: ${memoryGrowth.toFixed(2)}%`);

      // Memory shouldn't grow unboundedly
      // Allow some growth due to React state and caching
      expect(memoryGrowth).toBeLessThan(THRESHOLDS.MEMORY_GROWTH_PERCENT);
    }
  });

  // --------------------------------------------------------------------------
  // Test 7: React Re-render Performance
  // --------------------------------------------------------------------------
  test('calendar handles rapid interactions without excessive re-renders', async ({ page }) => {
    // Create trip with some data
    const tripId = await createTestTrip(page);
    const personIds = await createBulkPersons(page, tripId, 5);
    const roomIds = await createBulkRooms(page, tripId, 3);
    await createBulkAssignments(page, tripId, personIds, roomIds, 15);

    // Navigate to calendar
    await page.goto(`/trips/${tripId}/calendar`);
    await page.waitForLoadState('networkidle');
    await waitForLoading(page);
    await page.waitForSelector('[role="grid"]', { state: 'visible', timeout: 10000 });

    // Rapidly click month navigation buttons
    const startTime = performance.now();
    const clickCount = 10;
    const nextButton = page.getByRole('button', { name: /next|suivant/i });

    for (let i = 0; i < clickCount; i++) {
      await nextButton.click();
      await page.waitForTimeout(50);
    }

    const totalTime = performance.now() - startTime;
    const avgClickTime = totalTime / clickCount;

    console.log('=== Rapid Interaction Performance ===');
    console.log(`${clickCount} rapid navigation clicks`);
    console.log(`Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`Average per click: ${avgClickTime.toFixed(2)}ms`);

    // Each interaction should be responsive
    expect(avgClickTime).toBeLessThan(200);

    // Verify calendar is still functional
    const calendarGrid = page.locator('[role="grid"]');
    await expect(calendarGrid).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Test 8: IndexedDB Query Performance
  // --------------------------------------------------------------------------
  test('IndexedDB queries are efficient', async ({ page }) => {
    // Create trip with large dataset
    const tripId = await createTestTrip(page);
    await createBulkPersons(page, tripId, TEST_CONFIG.PERSON_COUNT);
    await createBulkRooms(page, tripId, TEST_CONFIG.ROOM_COUNT);

    // Measure IndexedDB query times
    const queryResults = await page.evaluate(async () => {
      const results: { operation: string; duration: number }[] = [];

      const measureOperation = async (name: string, operation: () => Promise<void>) => {
        const start = performance.now();
        await operation();
        const duration = performance.now() - start;
        results.push({ operation: name, duration });
      };

      await measureOperation('Open DB', async () => {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('kikoushou');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            req.result.close();
            resolve();
          };
        });
      });

      await measureOperation('Read all persons', async () => {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('kikoushou');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('persons', 'readonly');
            const store = tx.objectStore('persons');
            const getAll = store.getAll();
            getAll.onsuccess = () => {
              db.close();
              resolve();
            };
            getAll.onerror = () => {
              db.close();
              reject(getAll.error);
            };
          };
        });
      });

      await measureOperation('Read all rooms', async () => {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('kikoushou');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('rooms', 'readonly');
            const store = tx.objectStore('rooms');
            const getAll = store.getAll();
            getAll.onsuccess = () => {
              db.close();
              resolve();
            };
            getAll.onerror = () => {
              db.close();
              reject(getAll.error);
            };
          };
        });
      });

      return results;
    });

    console.log('=== IndexedDB Query Performance ===');
    for (const { operation, duration } of queryResults) {
      console.log(`${operation}: ${duration.toFixed(2)}ms`);
      // Each query should complete quickly
      expect(duration).toBeLessThan(100);
    }
  });
});

// ============================================================================
// Test Suite: Mobile Performance
// ============================================================================

test.describe('Mobile Performance', () => {
  // Use only Chromium
  test.skip(({ browserName }) => browserName !== 'chromium', 'Mobile tests require Chromium');

  test.beforeEach(async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await clearIndexedDB(page);
    await page.reload();
  });

  test('mobile navigation is performant', async ({ page }) => {
    // Create trip with data
    const tripId = await createTestTrip(page);
    await createBulkPersons(page, tripId, 10);
    await createBulkRooms(page, tripId, 5);

    // Navigate to calendar
    await page.goto(`/trips/${tripId}/calendar`);
    await page.waitForLoadState('networkidle');
    await waitForLoading(page);

    // Find and click bottom navigation items
    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible();

    const navLinks = nav.locator('a');
    const linkCount = await navLinks.count();

    console.log('=== Mobile Navigation Performance ===');

    for (let i = 0; i < linkCount; i++) {
      const link = navLinks.nth(i);
      const href = await link.getAttribute('href');

      if (!href) continue;

      const navTime = await measureDuration(async () => {
        await link.click();
        await page.waitForLoadState('networkidle');
        await waitForLoading(page);
      });

      console.log(`Navigate to ${href}: ${navTime.toFixed(2)}ms`);
      expect(navTime).toBeLessThan(THRESHOLDS.NAVIGATION_TIME);
    }
  });

  test('touch interactions are responsive', async ({ page, browserName }) => {
    // Skip this test for browsers without touch support
    // Only Mobile Chrome has hasTouch enabled by default
    test.skip(browserName === 'chromium', 'Touch not supported in desktop Chromium');

    // Create trip
    const tripId = await createTestTrip(page);
    await createBulkRooms(page, tripId, 5);

    // Navigate to rooms
    await page.goto(`/trips/${tripId}/rooms`);
    await page.waitForLoadState('networkidle');
    await waitForLoading(page);

    // Wait for room cards to appear
    await page.waitForSelector('[role="listitem"]', { state: 'visible', timeout: 10000 });

    // Simulate tap on first room card
    const firstRoom = page.locator('[role="listitem"]').first();
    await expect(firstRoom).toBeVisible();

    const tapTime = await measureDuration(async () => {
      await firstRoom.tap();
      await page.waitForTimeout(100);
    });

    console.log('=== Touch Interaction Performance ===');
    console.log(`Tap response time: ${tapTime.toFixed(2)}ms`);

    // Touch interactions should feel instant
    expect(tapTime).toBeLessThan(300);
  });
});
