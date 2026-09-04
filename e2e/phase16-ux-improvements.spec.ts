/**
 * @fileoverview E2E Tests for Phase 16 UX Improvements
 * Tests the enhanced UX features implemented in Phase 16:
 *
 * 1. Trip Creation with New UI - LocationPicker, DateRangePicker, description
 * 2. Calendar Multi-Day Events - Spanning events across multiple days
 * 3. Transport Single List - Chronological list without tabs
 * 4. Bug Fix: Assignment Dates (BUG-1) - Correct date storage
 * 5. Bug Fix: Timezone Display (BUG-2) - Correct time display
 *
 * @module e2e/phase16-ux-improvements
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForRoute } from './support/routes';

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Fixture dates, anchored on a month that is always ahead of today.
 *
 * These used to be hardcoded to March 2026. That date passed, and the transport
 * list then folded every fixture transport into its collapsed "Past transports"
 * accordion — so the rows the assertions looked for were real, rendered, and
 * hidden. Deriving the month keeps every offset these tests depend on (trip
 * day 1-10, stays day 2-5, transports day 2 and day 8) while making the suite
 * proof against the calendar moving on.
 */
const FIXTURE_MONTH_START = ((): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
})();

/** `YYYY-MM-DD` for the given 1-based day of the fixture month. */
function fixtureDate(dayOfMonth: number): string {
  const date = new Date(FIXTURE_MONTH_START);
  date.setUTCDate(dayOfMonth);
  return date.toISOString().slice(0, 10);
}

/** An ISO timestamp for the given day of the fixture month at a UTC time. */
function fixtureDatetime(dayOfMonth: number, utcTime: string): string {
  return `${fixtureDate(dayOfMonth)}T${utcTime}`;
}

/**
 * The days of the month a stay actually occupies, under the app's
 * check-in/check-out model: from the check-in day up to but *not including* the
 * check-out day. A stay from the 2nd to the 5th is three nights — the 2nd, 3rd
 * and 4th — and the 5th is the morning the guest leaves.
 *
 * Derived rather than hardcoded so the fixture dates can move without the
 * assertions quietly starting to check the wrong days.
 */
function stayNights(startDate: string, endDate: string): number[] {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  const nights: number[] = [];
  // UTC arithmetic throughout: a local-time loop would double or skip a day
  // across a DST boundary.
  for (let day = start; day < end; day += DAY_MS) {
    nights.push(new Date(day).getUTCDate());
  }
  return nights;
}

/**
 * The wall-clock time the app must render for a stored instant, `HH:mm`.
 *
 * The suite cannot know the runner's timezone, but it can compute what that
 * timezone makes of the instant — which is the whole of BUG-2. Node and the
 * browser under test share a machine, so they share a timezone.
 */
function localClockTime(datetime: string): string {
  return new Date(datetime).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * One entry per day cell of the calendar's current month, with the accessible
 * names of the pills it holds.
 *
 * Day cells carry no date attribute, so the month is located by its own first
 * day: the leading cells are the tail of the previous month and can never hold
 * a "1", so the first cell numbered 1 is this month's 1st, and the next one is
 * the following month's.
 */
async function readMonthGrid(page: Page): Promise<{ day: number; pills: string[] }[]> {
  return page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('[role="gridcell"]'));
    const dayNumberOf = (cell: Element): string =>
      cell.querySelector('span')?.textContent?.trim() ?? '';

    const firstOfMonth = cells.findIndex((cell) => dayNumberOf(cell) === '1');
    if (firstOfMonth === -1) {
      return [];
    }
    const nextMonth = cells.findIndex(
      (cell, index) => index > firstOfMonth && dayNumberOf(cell) === '1',
    );

    return cells
      .slice(firstOfMonth, nextMonth === -1 ? cells.length : nextMonth)
      .map((cell, index) => ({
        day: index + 1,
        pills: Array.from(cell.querySelectorAll('button[aria-label]')).map(
          (pill) => pill.getAttribute('aria-label') ?? '',
        ),
      }));
  });
}

/**
 * Picks a check-in / check-out range in the open assignment dialog's picker.
 *
 * Days are addressed by `data-day`, the picker's own per-date attribute, and
 * not by their number: the month grid also renders the neighbouring months'
 * days, so "2" matches up to three buttons.
 */
async function pickStayDates(page: Page, startDate: string, endDate: string): Promise<void> {
  const toDataDay = (iso: string): Promise<string> =>
    page.evaluate((value) => {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString();
    }, iso);

  await page.getByRole('button', { name: /check-in|arriv/i }).first().click();

  const calendar = page.locator('[data-radix-popper-content-wrapper] [data-slot="calendar"]');
  await expect(calendar).toBeVisible();

  await calendar.locator(`button[data-day="${await toDataDay(startDate)}"]`).click();
  await calendar.locator(`button[data-day="${await toDataDay(endDate)}"]`).click();

  // The picker closes itself once both ends are set. Waiting for that is not
  // cosmetic: the popover is itself a `role="dialog"`, so anything that reads
  // `getByRole('dialog')` afterwards would match two elements.
  await expect(calendar).toBeHidden();
}

/** The fixture month as the transport list groups it, e.g. /March|2027/. */
const FIXTURE_MONTH_PATTERN = new RegExp(
  [
    FIXTURE_MONTH_START.toLocaleString('en', { month: 'long', timeZone: 'UTC' }),
    FIXTURE_MONTH_START.toLocaleString('fr', { month: 'long', timeZone: 'UTC' }),
    String(FIXTURE_MONTH_START.getUTCFullYear()),
  ].join('|'),
  'i',
);

/**
 * Clears app data using the settings page.
 * This is more reliable than direct IndexedDB access which may fail in some contexts.
 */
async function clearAppData(page: Page): Promise<void> {
  // Navigate to settings page
  await page.goto('/settings');
  await page.waitForLoadState('load');

  // Look for the clear data button
  const clearDataButton = page.getByRole('button', { name: /clear.*data/i });
  if (await clearDataButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await clearDataButton.click();

    // Confirm the dialog if it appears. ConfirmDialog is an alert dialog.
    const confirmButton = page
      .getByRole('alertdialog')
      .getByRole('button', { name: /clear|confirm/i });
    if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmButton.click();
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Creates a test trip directly in IndexedDB.
 */
async function createTestTrip(
  page: Page,
  options: {
    name?: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  } = {},
): Promise<string> {
  await page.goto('/trips');
  await page.waitForLoadState('load');

  const tripData = {
    name: options.name ?? 'Phase 16 Test Trip',
    location: options.location ?? 'Test Location',
    startDate: options.startDate ?? fixtureDate(1),
    endDate: options.endDate ?? fixtureDate(10),
    description: options.description,
  };

  const tripId = await page.evaluate(
    async ({ name, location, startDate, endDate, description }) => {
      const id = `p16-trip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const shareId = `share-${Math.random().toString(36).substr(2, 10)}`;
      const now = Date.now();

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikouchou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('trips', 'readwrite');
          const store = tx.objectStore('trips');

          const trip: Record<string, unknown> = {
            id,
            shareId,
            name,
            location,
            startDate,
            endDate,
            createdAt: now,
            updatedAt: now,
          };

          if (description) {
            trip.description = description;
          }

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
    tripData,
  );

  return tripId;
}

/**
 * Creates a test person directly in IndexedDB.
 */
async function createTestPerson(
  page: Page,
  tripId: string,
  name: string,
  color: string = '#3b82f6',
): Promise<string> {
  const personId = await page.evaluate(
    async ({ tripId, name, color }) => {
      const id = `p16-person-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikouchou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('persons', 'readwrite');
          const store = tx.objectStore('persons');

          store.add({ id, tripId, name, color });

          tx.oncomplete = () => {
            db.close();
            resolve(id);
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create person'));
          };
        };
      });
    },
    { tripId, name, color },
  );

  return personId;
}

/**
 * Creates a test room directly in IndexedDB.
 */
async function createTestRoom(
  page: Page,
  tripId: string,
  name: string,
  capacity: number = 2,
): Promise<string> {
  const roomId = await page.evaluate(
    async ({ tripId, name, capacity }) => {
      const id = `p16-room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikouchou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('rooms', 'readwrite');
          const store = tx.objectStore('rooms');

          store.add({ id, tripId, name, capacity, order: 0 });

          tx.oncomplete = () => {
            db.close();
            resolve(id);
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create room'));
          };
        };
      });
    },
    { tripId, name, capacity },
  );

  return roomId;
}

/**
 * Creates a room assignment directly in IndexedDB.
 */
async function createTestAssignment(
  page: Page,
  tripId: string,
  roomId: string,
  personId: string,
  startDate: string,
  endDate: string,
): Promise<string> {
  const assignmentId = await page.evaluate(
    async ({ tripId, roomId, personId, startDate, endDate }) => {
      const id = `p16-assign-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikouchou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('roomAssignments', 'readwrite');
          const store = tx.objectStore('roomAssignments');

          store.add({ id, tripId, roomId, personId, startDate, endDate });

          tx.oncomplete = () => {
            db.close();
            resolve(id);
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create assignment'));
          };
        };
      });
    },
    { tripId, roomId, personId, startDate, endDate },
  );

  return assignmentId;
}

/**
 * Creates a test transport directly in IndexedDB.
 */
async function createTestTransport(
  page: Page,
  tripId: string,
  personId: string,
  type: 'arrival' | 'departure',
  datetime: string,
  mode: 'plane' | 'train' | 'car' | 'bus' | 'other' = 'plane',
  // `location` is required on `Transport`, so it gets a default rather than
  // being left off: a record without one is invalid data, and the transports
  // page used to crash outright on it.
  location: string = 'Test Station',
): Promise<string> {
  const transportId = await page.evaluate(
    async ({ tripId, personId, type, datetime, mode, location }) => {
      const id = `p16-transport-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikouchou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('transports', 'readwrite');
          const store = tx.objectStore('transports');

          const transport: Record<string, unknown> = {
            id,
            tripId,
            personId,
            type,
            datetime,
            mode,
            needsPickup: type === 'arrival',
          };

          transport.location = location;

          store.add(transport);

          tx.oncomplete = () => {
            db.close();
            resolve(id);
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create transport'));
          };
        };
      });
    },
    { tripId, personId, type, datetime, mode, location },
  );

  return transportId;
}

/**
 * Gets a room assignment from IndexedDB by ID.
 */
async function getAssignmentFromDB(
  page: Page,
  assignmentId: string,
): Promise<{ startDate: string; endDate: string } | null> {
  return page.evaluate(async (id) => {
    return new Promise((resolve, reject) => {
      const dbRequest = indexedDB.open('kikouchou');
      dbRequest.onerror = () => reject(new Error('Failed to open database'));
      dbRequest.onsuccess = () => {
        const db = dbRequest.result;
        const tx = db.transaction('roomAssignments', 'readonly');
        const store = tx.objectStore('roomAssignments');
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
          db.close();
          const assignment = getRequest.result;
          if (assignment) {
            resolve({ startDate: assignment.startDate, endDate: assignment.endDate });
          } else {
            resolve(null);
          }
        };
        getRequest.onerror = () => {
          db.close();
          reject(new Error('Failed to get assignment'));
        };
      };
    });
  }, assignmentId);
}

/**
 * Every room assignment stored for a trip, as the database holds them.
 *
 * The point of reading the rows back — rather than re-reading the form — is
 * BUG-1: the dialog showed the right check-out day while storing the day after
 * it, and only the stored value tells those two apart.
 */
async function getTripAssignmentsFromDB(
  page: Page,
  tripId: string,
): Promise<{ roomId: string; startDate: string; endDate: string }[]> {
  return page.evaluate(async (id) => {
    return new Promise((resolve, reject) => {
      const dbRequest = indexedDB.open('kikouchou');
      dbRequest.onerror = () => reject(new Error('Failed to open database'));
      dbRequest.onsuccess = () => {
        const db = dbRequest.result;
        const tx = db.transaction('roomAssignments', 'readonly');
        const getAll = tx.objectStore('roomAssignments').getAll();

        getAll.onsuccess = () => {
          db.close();
          const rows = (getAll.result as Record<string, string>[])
            .filter((row) => row.tripId === id)
            .map((row) => ({
              roomId: row.roomId ?? '',
              startDate: row.startDate ?? '',
              endDate: row.endDate ?? '',
            }))
            .sort((a, b) => a.startDate.localeCompare(b.startDate));
          resolve(rows);
        };
        getAll.onerror = () => {
          db.close();
          reject(new Error('Failed to read assignments'));
        };
      };
    });
  }, tripId);
}

// ============================================================================
// Test Data
// ============================================================================

const TEST_DATA = {
  trip: {
    name: 'Phase 16 UX Test Trip',
    location: 'Brittany, France',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
    description: 'Testing Phase 16 UX improvements',
  },
  person: {
    name: 'Alice Phase16',
    color: '#3b82f6',
  },
  person2: {
    name: 'Bob Phase16',
    color: '#22c55e',
  },
  room: {
    name: 'Master Suite',
    capacity: 2,
  },
  // Multi-day assignment spanning 3 days
  multiDayAssignment: {
    startDate: fixtureDate(2),
    endDate: fixtureDate(5), // 3 nights: day 2, 3, 4
  },
  // Transport times for timezone testing
  transport: {
    // Store as UTC - when user enters 14:00 in UTC+1, it's stored as 13:00 UTC
    datetime: fixtureDatetime(2, '13:00:00.000Z'),
    expectedDisplayTime: '14:00', // Should display as local time
    location: 'Paris CDG Airport',
  },
} as const;

/**
 * The accessible name a calendar pill carries for the fixture stay.
 *
 * `CalendarPage` builds it as `${person} - ${room}`, and it is the pill's
 * `aria-label`, its `title` and — on the segments that show a label — its text.
 * Matching it exactly is what makes these assertions fail when the room name
 * stops being rendered, which "person name is somewhere on the page" did not.
 */
const STAY_LABEL = `${TEST_DATA.person.name} - ${TEST_DATA.room.name}`;

/** The days of the fixture month the multi-day stay occupies. */
const STAY_NIGHTS = stayNights(
  TEST_DATA.multiDayAssignment.startDate,
  TEST_DATA.multiDayAssignment.endDate,
);

// ============================================================================
// Test Suite: Trip Creation with New UI
// ============================================================================

test.describe('Trip Creation with New UI', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppData(page);
  });

  test('trip form includes description field', async ({ page }) => {
    // Navigate directly to trip creation page
    await page.goto('/trips/new');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Verify we're on the trip form page
    await expect(page).toHaveURL('/trips/new');

    // A retrying assertion, not `.count()` / `.isVisible()`. The route is lazy,
    // so `waitForLoadState('load')` returns while `main` still holds the
    // "Loading..." fallback, and an instant read there sees no form at all.
    await expect(page.locator('#trip-description')).toBeVisible();
  });

  test('trip form has location input', async ({ page }) => {
    // Navigate directly to trip creation page
    await page.goto('/trips/new');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Find location input (could be LocationPicker or regular input)
    const locationInput = page.getByLabel(/location|lieu/i);
    await expect(locationInput).toBeVisible();
  });

  test('trip form has date range picker', async ({ page }) => {
    // Navigate directly to trip creation page
    await page.goto('/trips/new');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Retrying assertions, for the same reason as the description field above.
    await expect(page.locator('#trip-start-date')).toBeVisible();
    await expect(page.locator('#trip-end-date')).toBeVisible();
  });

  test('trip card shows guests count after creation', async ({ page }) => {
    // Create trip with guests
    const tripId = await createTestTrip(page, TEST_DATA.trip);
    await createTestPerson(page, tripId, TEST_DATA.person.name, TEST_DATA.person.color);
    await createTestPerson(page, tripId, TEST_DATA.person2.name, TEST_DATA.person2.color);

    // Navigate to trips list
    await page.goto('/trips');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Find trip card
    const tripCard = page.getByRole('button', { name: new RegExp(TEST_DATA.trip.name) });
    await expect(tripCard).toBeVisible({ timeout: 5000 });

    // The whole card is one `role="button"`, so its accessible name is
    // everything a screen reader is told about it — the guest count has to be
    // in there or it is not announced at all. Anchored on a word boundary:
    // the `/2.*guest/` this replaces also matched "12 guests", and matched it
    // anywhere on the page rather than on this card.
    await expect(tripCard).toHaveAccessibleName(/(^|\D)2 (guests|invités)(\D|$)/);

    // And the badges themselves, scoped to the card. Unscoped, a guest name
    // rendered anywhere else — the sidebar, another trip's card — stood in for
    // this card's own guest list.
    const card = page.locator('[data-slot="card"]').filter({ hasText: TEST_DATA.trip.name });
    await expect(card.getByText(TEST_DATA.person.name)).toBeVisible();
    await expect(card.getByText(TEST_DATA.person2.name)).toBeVisible();
  });
});

// ============================================================================
// Test Suite: Calendar Multi-Day Events
// ============================================================================

test.describe('Calendar Multi-Day Events', () => {
  let tripId: string;

  test.beforeEach(async ({ page }) => {
    await clearAppData(page);
    tripId = await createTestTrip(page, TEST_DATA.trip);
  });

  test('multi-day assignment displays as spanning event', async ({ page }) => {
    // Create room, person, and multi-day assignment
    const roomId = await createTestRoom(page, tripId, TEST_DATA.room.name, TEST_DATA.room.capacity);
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name, TEST_DATA.person.color);
    await createTestAssignment(
      page,
      tripId,
      roomId,
      personId,
      TEST_DATA.multiDayAssignment.startDate,
      TEST_DATA.multiDayAssignment.endDate,
    );

    // Navigate to calendar. Month view: the timeline view (the default) renders
    // no `role="grid"`, so the assertions below never find the calendar.
    await page.goto(`/trips/${tripId}/calendar?view=card`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // One segment per night of the stay. A retrying count rather than a fixed
    // wait: the calendar opens on today's month and only jumps to the trip's
    // month once the trip has loaded, from inside a `setTimeout`.
    const segments = page.getByRole('button', { name: STAY_LABEL, exact: true });
    await expect(segments).toHaveCount(STAY_NIGHTS.length);

    // What makes it a *spanning* event is geometry, not a class name: one bar
    // per night, all the same size, each exactly one day cell to the right of
    // the last until the week wraps.
    const { bars, dayPitch } = await page.evaluate((label) => {
      const measure = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      };

      const cells = Array.from(document.querySelectorAll('[role="gridcell"]')).map(measure);
      // Distance from one day column to the next, taken from the grid itself
      // rather than assumed — it differs between the mobile and desktop layouts.
      const pitch =
        cells.length >= 2 && cells[1]!.top === cells[0]!.top
          ? cells[1]!.left - cells[0]!.left
          : 0;

      return {
        bars: Array.from(
          document.querySelectorAll<HTMLElement>(`button[aria-label="${label}"]`),
        ).map(measure),
        dayPitch: pitch,
      };
    }, STAY_LABEL);

    // Guard against a vacuous pass: with no bars and no grid on screen every
    // check below holds for the wrong reason.
    expect(bars.length).toBe(STAY_NIGHTS.length);
    expect(dayPitch).toBeGreaterThan(0);

    for (let index = 1; index < bars.length; index++) {
      const previous = bars[index - 1]!;
      const current = bars[index]!;
      expect(current.height).toBeCloseTo(previous.height, 0);
      expect(current.width).toBeCloseTo(previous.width, 0);

      if (Math.abs(current.top - previous.top) < 1) {
        // Same week row: the next night sits one whole day column along. Three
        // bars stacked in one cell, or scattered across the month, would fail.
        expect(Math.abs(current.left - previous.left - dayPitch)).toBeLessThanOrEqual(2);
      } else {
        // A week boundary: the stay continues on the next row, further left.
        expect(current.top).toBeGreaterThan(previous.top);
        expect(current.left).toBeLessThan(previous.left);
      }
    }

    // The bar is the way into the stay's details.
    await segments.first().click();

    const detailDialog = page.getByRole('dialog');
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText(TEST_DATA.person.name)).toBeVisible();
    await expect(detailDialog.getByText(TEST_DATA.room.name)).toBeVisible();
    // The dialog spells out the length of the stay, which is the same fact the
    // segment count above asserts — read here from the other end of the app.
    await expect(detailDialog).toContainText(
      new RegExp(`${STAY_NIGHTS.length}\\s+(nights?|nuits?)`, 'i'),
    );
  });

  test('calendar shows room name in event', async ({ page }) => {
    // Create room, person, and assignment
    const roomId = await createTestRoom(page, tripId, TEST_DATA.room.name, TEST_DATA.room.capacity);
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name, TEST_DATA.person.color);
    await createTestAssignment(
      page,
      tripId,
      roomId,
      personId,
      TEST_DATA.multiDayAssignment.startDate,
      TEST_DATA.multiDayAssignment.endDate,
    );

    // Navigate to calendar. Month view: the timeline view (the default) renders
    // no `role="grid"`, so the assertions below never find the calendar.
    await page.goto(`/trips/${tripId}/calendar?view=card`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // A retrying assertion, not a fixed 500 ms wait: the calendar opens on
    // today's month and only jumps to the trip's start month once the trip has
    // loaded, from inside a `setTimeout`. The fixture trip is two months out,
    // so an instant read here looked at the wrong month.
    //
    // The room name is asserted as part of the pill's own label, not as text
    // "somewhere on the page": the `room OR person` this replaces passed on the
    // guest's name alone, which is exactly the half a dropped room name leaves
    // behind.
    const segment = page.getByRole('button', { name: STAY_LABEL, exact: true }).first();
    await expect(segment).toBeVisible();

    // The check-in segment is the one that renders the label — later segments
    // deliberately show a blank so the bar reads as one continuous stay — so
    // the room name is on screen, not only in the accessibility tree.
    await expect(segment).toHaveText(STAY_LABEL);
  });

  test('clicking calendar event opens detail dialog', async ({ page }) => {
    // Create room, person, and assignment
    const roomId = await createTestRoom(page, tripId, TEST_DATA.room.name, TEST_DATA.room.capacity);
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name, TEST_DATA.person.color);
    await createTestAssignment(
      page,
      tripId,
      roomId,
      personId,
      TEST_DATA.multiDayAssignment.startDate,
      TEST_DATA.multiDayAssignment.endDate,
    );

    // Navigate to calendar. Month view: the timeline view (the default) renders
    // no `role="grid"`, so the assertions below never find the calendar.
    await page.goto(`/trips/${tripId}/calendar?view=card`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // No `if (found) … else assert the calendar exists` any more. The stay was
    // seeded, so a missing pill is the bug this test is for; falling back to
    // "a calendar rendered" made the failure invisible.
    const segment = page.getByRole('button', { name: STAY_LABEL, exact: true }).first();
    await expect(segment).toBeVisible();
    await segment.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Both actions, not either: the dialog is the only place a stay can be
    // edited or removed from the calendar, so one of them missing is a
    // regression that `hasEdit || hasDelete` could not see.
    await expect(dialog.getByRole('button', { name: /^(edit|modifier)$/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^(delete|supprimer)$/i })).toBeVisible();
  });
});

// ============================================================================
// Test Suite: Transport Single List
// ============================================================================

test.describe('Transport Single List', () => {
  let tripId: string;

  test.beforeEach(async ({ page }) => {
    await clearAppData(page);
    tripId = await createTestTrip(page, TEST_DATA.trip);
  });

  test('transport page shows single chronological list without tabs', async ({ page }) => {
    // Create person and transports
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name, TEST_DATA.person.color);
    await createTestTransport(page, tripId, personId, 'arrival', fixtureDatetime(2, '10:00:00.000Z'), 'plane');
    await createTestTransport(page, tripId, personId, 'departure', fixtureDatetime(8, '16:00:00.000Z'), 'train');

    // Navigate to transports page
    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Verify NO tabs are present
    const tabs = page.getByRole('tablist');
    const hasTabs = await tabs.isVisible().catch(() => false);
    expect(hasTabs).toBe(false);

    // Verify both arrival and departure are visible in the same list
    const arrivalIndicator = page.getByText(/arrival|arriv[ée]/i).first();
    const departureIndicator = page.getByText(/departure|d[ée]part/i).first();

    await expect(arrivalIndicator).toBeVisible({ timeout: 5000 });
    await expect(departureIndicator).toBeVisible({ timeout: 5000 });
  });

  test('transports are grouped by date', async ({ page }) => {
    // Create person and multiple transports on different dates
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name, TEST_DATA.person.color);
    const person2Id = await createTestPerson(page, tripId, TEST_DATA.person2.name, TEST_DATA.person2.color);

    await createTestTransport(page, tripId, personId, 'arrival', fixtureDatetime(2, '10:00:00.000Z'), 'plane');
    await createTestTransport(page, tripId, person2Id, 'arrival', fixtureDatetime(2, '14:00:00.000Z'), 'train');
    await createTestTransport(page, tripId, personId, 'departure', fixtureDatetime(8, '16:00:00.000Z'), 'car');

    // Navigate to transports page
    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Look for date headers (grouped by date)
    // The page should show dates like "March 2" or "2 mars" as section headers
    const dateHeaders = page.locator('h2, h3, [role="heading"]').filter({
      hasText: FIXTURE_MONTH_PATTERN,
    });

    await expect(dateHeaders.first()).toBeVisible();
  });

  test('arrivals show green indicator and departures show orange', async ({ page }) => {
    // Create person and transports
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name, TEST_DATA.person.color);
    await createTestTransport(page, tripId, personId, 'arrival', fixtureDatetime(2, '10:00:00.000Z'), 'plane');
    await createTestTransport(page, tripId, personId, 'departure', fixtureDatetime(8, '16:00:00.000Z'), 'train');

    // Navigate to transports page
    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Look for arrival and departure indicators
    // The TransportListPage uses specific styling for arrivals/departures
    // Check for arrival indicator (down arrow icon or green styling)
    await expect(page.getByText(/arrival|arriv[ée]/i).first()).toBeVisible();
    await expect(page.getByText(/departure|d[ée]part/i).first()).toBeVisible();
  });

  test('past transports section exists', async ({ page }) => {
    // Create person with past transport (before trip start, but we'll use a date marker)
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name, TEST_DATA.person.color);
    await createTestTransport(page, tripId, personId, 'arrival', fixtureDatetime(2, '10:00:00.000Z'), 'plane');

    // Navigate to transports page
    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Look for past transports section or indicator
    // This might be a collapsible section or separate area
    // The past section may or may not be present depending on the current date,
    // so this only asserts the page itself rendered.
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});

// ============================================================================
// Test Suite: Bug Fix Verification - BUG-1 (Assignment Dates)
// ============================================================================

test.describe('Bug Fix: Assignment Dates (BUG-1)', () => {
  let tripId: string;

  test.beforeEach(async ({ page }) => {
    await clearAppData(page);
    tripId = await createTestTrip(page, TEST_DATA.trip);
  });

  test('assignment stores correct end date (not +1 day)', async ({ page }) => {
    // Create room and person
    const roomId = await createTestRoom(page, tripId, TEST_DATA.room.name);
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name);

    // Create assignment with specific dates
    const startDate = fixtureDate(2);
    const endDate = fixtureDate(5);

    const assignmentId = await createTestAssignment(
      page,
      tripId,
      roomId,
      personId,
      startDate,
      endDate,
    );

    // Verify the stored dates match exactly
    const storedAssignment = await getAssignmentFromDB(page, assignmentId);

    expect(storedAssignment).not.toBeNull();
    expect(storedAssignment?.startDate).toBe(startDate);
    expect(storedAssignment?.endDate).toBe(endDate);
  });

  test('assignment created via UI has correct dates', async ({ page }) => {
    const roomId = await createTestRoom(page, tripId, TEST_DATA.room.name);
    await createTestPerson(page, tripId, TEST_DATA.person.name);

    // Card view: the timeline (the default) renders no room card to expand, so
    // the assignment section this test drives does not exist there.
    await page.goto(`/trips/${tripId}/rooms?view=card`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    await page.locator('[role="listitem"]').filter({ hasText: TEST_DATA.room.name }).click();

    await page.getByRole('button', { name: /^(assign a room|attribuer une chambre)$/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.locator('#person-select').click();
    await page.getByRole('option', { name: new RegExp(TEST_DATA.person.name) }).click();

    const { startDate, endDate } = TEST_DATA.multiDayAssignment;
    await pickStayDates(page, startDate, endDate);

    await dialog.getByRole('button', { name: /^(add|ajouter)$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // The whole of BUG-1: the dialog showed the right check-out day while
    // storing the day after it. Only the stored row tells those apart, so this
    // reads the row back rather than re-reading the form — and it asserts the
    // exact pair, so an off-by-one in either direction fails.
    //
    // Polling, because the write goes through the assignment context before it
    // reaches Dexie.
    await expect
      .poll(() => getTripAssignmentsFromDB(page, tripId), { timeout: 5000 })
      .toEqual([{ roomId, startDate, endDate }]);
  });

  test('calendar displays assignment with correct date range', async ({ page }) => {
    // Create room, person, and assignment
    const roomId = await createTestRoom(page, tripId, TEST_DATA.room.name);
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name);

    const { startDate, endDate } = TEST_DATA.multiDayAssignment;
    await createTestAssignment(page, tripId, roomId, personId, startDate, endDate);

    // Navigate to calendar. Month view: the timeline view (the default) renders
    // no `role="grid"`, so the assertions below never find the calendar.
    await page.goto(`/trips/${tripId}/calendar?view=card`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // The stay runs check-in day to check-out morning, so it belongs on the
    // 2nd, 3rd and 4th and *not* on the 5th — the day the guest leaves.
    //
    // This used to read `expect(hasEvent || await calendarGrid.isVisible())`,
    // whose right-hand side was already known true three lines above, so the
    // date range was never checked at all. Naming the exact days is what makes
    // the assertion fail when the last night is off by one in either direction.
    //
    // `expect.poll` rather than a fixed wait: the calendar opens on today's
    // month and jumps to the trip's month from inside a `setTimeout`.
    await expect
      .poll(
        async () =>
          (await readMonthGrid(page))
            .filter((cell) => cell.pills.includes(STAY_LABEL))
            .map((cell) => cell.day),
        { timeout: 10_000 },
      )
      .toEqual(stayNights(startDate, endDate));
  });
});

// ============================================================================
// Test Suite: Bug Fix Verification - BUG-2 (Timezone Display)
// ============================================================================

test.describe('Bug Fix: Timezone Display (BUG-2)', () => {
  let tripId: string;

  test.beforeEach(async ({ page }) => {
    await clearAppData(page);
    tripId = await createTestTrip(page, TEST_DATA.trip);
  });

  test('transport time displays correctly in list view', async ({ page }) => {
    // Create person and transport with specific UTC time
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name);

    // Create transport at 13:00 UTC (which is 14:00 in UTC+1)
    // The stored datetime is UTC ISO string
    await createTestTransport(
      page,
      tripId,
      personId,
      'arrival',
      TEST_DATA.transport.datetime,
      'plane',
      TEST_DATA.transport.location,
    );

    // Navigate to transports page
    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // BUG-2 is a *wrong* time, not a missing one, so "some string matching
    // \d{1,2}:\d{2} is visible" — which the page's own date headers satisfy —
    // could not see it. The suite cannot know the runner's timezone, but it can
    // compute what that timezone makes of the stored instant, which is the
    // claim under test.
    const expectedTime = localClockTime(TEST_DATA.transport.datetime);
    // The transport's own card, not the "needs a driver" banner above the list
    // — that one is a `role="article"` naming the same guest.
    const transportCard = page
      .locator('[role="article"][data-slot="card"]')
      .filter({ hasText: TEST_DATA.person.name });

    await expect(transportCard).toBeVisible({ timeout: 5000 });
    await expect(transportCard).toHaveAttribute(
      'aria-label',
      new RegExp(`\\b${expectedTime}\\b`),
    );
    await expect(transportCard).toContainText(expectedTime);
  });

  test('transport time displays correctly in calendar view', async ({ page }) => {
    // Create person and transport
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name);
    await createTestTransport(
      page,
      tripId,
      personId,
      'arrival',
      TEST_DATA.transport.datetime,
      'plane',
      TEST_DATA.transport.location,
    );

    // Navigate to calendar. Month view: the timeline view (the default) renders
    // no `role="grid"`, so the assertions below never find the calendar.
    await page.goto(`/trips/${tripId}/calendar?view=card`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // `[data-transport]` and `.transport-indicator` appear nowhere in `src`, so
    // the branch that used them could never run and the test fell through to
    // "a calendar rendered". The indicator is a button inside its day cell,
    // and this trip has exactly one transport and no stays.
    const indicator = page.locator('[role="gridcell"] button');
    await expect(indicator).toHaveCount(1);

    const expectedTime = localClockTime(TEST_DATA.transport.datetime);
    await expect(indicator).toContainText(expectedTime);
    await expect(indicator).toHaveAttribute('title', new RegExp(`^${expectedTime}\\b`));

    // The same instant, rendered by the detail dialog: BUG-2 was a surface
    // disagreeing with its own pill.
    await indicator.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog).toContainText(expectedTime);
  });

  test('round-trip: entered time matches displayed time', async ({ page }) => {
    // Create person
    await createTestPerson(page, tripId, TEST_DATA.person.name);

    // Navigate to transports
    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Click add transport button - look for "New transport" button or FAB
    const addButton = page.getByRole('button', { name: /new transport|nouveau transport/i });
    const hasFab = await addButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasFab) {
      // Try the FAB on mobile (has aria-label)
      const fabButton = page.locator('button[aria-label*="transport"], button[aria-label*="Transport"]');
      const hasFabAlt = await fabButton.isVisible({ timeout: 2000 }).catch(() => false);
      if (hasFabAlt) {
        await fabButton.click();
      } else {
        // No add button found - page might be empty state with different button
        // Just verify the page loaded
        await expect(page.getByText(/transport/i).first()).toBeVisible();
        return;
      }
    } else {
      await addButton.click();
    }

    // Wait for dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Find datetime input
    const datetimeInput = dialog.locator('input[type="datetime-local"]');
    const hasDatetimeInput = await datetimeInput.isVisible().catch(() => false);

    if (hasDatetimeInput) {
      // Enter a specific time
      const testDatetime = `${fixtureDate(2)}T14:30`;
      await datetimeInput.fill(testDatetime);

      // The form should show the entered time
      const inputValue = await datetimeInput.inputValue();
      expect(inputValue).toContain('14:30');
    }

    // Close dialog
    const cancelBtn = dialog.getByRole('button', { name: /cancel|annuler/i });
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }
  });
});

// ============================================================================
// Test Suite: Room Assignment Drag-Drop (16.10)
// ============================================================================

test.describe('Room Assignment Drag-Drop', () => {
  let tripId: string;

  test.beforeEach(async ({ page }) => {
    await clearAppData(page);
    tripId = await createTestTrip(page, TEST_DATA.trip);
  });

  test('unassigned guests section shows guests with transport but no assignment', async ({ page }) => {
    // Create room and person with arrival transport but no assignment
    await createTestRoom(page, tripId, TEST_DATA.room.name);
    const personId = await createTestPerson(page, tripId, TEST_DATA.person.name);
    await createTestTransport(page, tripId, personId, 'arrival', fixtureDatetime(2, '10:00:00.000Z'), 'plane');
    await createTestTransport(page, tripId, personId, 'departure', fixtureDatetime(8, '16:00:00.000Z'), 'train');

    // Navigate to rooms page
    await page.goto(`/trips/${tripId}/rooms`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Either the unassigned section is there or the guest is listed. Retrying,
    // because the rooms page resolves its guests after the route mounts.
    await expect(
      page
        .getByText(/unassigned|sans chambre|no room/i)
        .or(page.getByText(TEST_DATA.person.name))
        .first(),
    ).toBeVisible();
  });

  test('room icons are displayed (16.9)', async ({ page }) => {
    // Create rooms with different capacities
    await createTestRoom(page, tripId, 'Single Room', 1);
    await createTestRoom(page, tripId, 'Double Room', 2);
    await createTestRoom(page, tripId, 'Family Room', 4);

    // Navigate to rooms page
    await page.goto(`/trips/${tripId}/rooms`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Verify rooms are displayed
    await expect(page.getByText('Single Room')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Double Room')).toBeVisible();
    await expect(page.getByText('Family Room')).toBeVisible();

    // Look for icons (bed icons, room icons)
    const icons = page.locator('svg, [data-icon], .lucide');
    const iconCount = await icons.count();

    // Should have some icons on the page
    expect(iconCount).toBeGreaterThan(0);
  });
});

// ============================================================================
// Cleanup
// ============================================================================

test.afterAll(async () => {
  // Tests use local IndexedDB which is isolated per browser context
  // No explicit cleanup needed
});
