/**
 * @fileoverview E2E Tests for Room Assignment Flow
 * Tests the complete workflow of managing rooms, persons, and assignments in the Kikouchou PWA.
 *
 * Test scenarios covered:
 * 1. Adding a room to a trip
 * 2. Adding a person/guest to a trip
 * 3. Assigning a person to a room for a date range
 * 4. Conflict detection for overlapping assignments
 * 5. Editing existing assignments
 * 6. Deleting assignments with confirmation
 * 7. Drag and drop assignment (if applicable)
 *
 * @module e2e/room-assignment
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedTransport } from './support/seed';
import { clearIndexedDB } from './support/storage';
import { fixtureDate } from './support/fixture-dates';

// ============================================================================
// Database Helpers
// ============================================================================

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * Test data constants for consistent test execution.
 *
 * Every date is a day of the fixture month, which is derived from today — see
 * `support/fixture-dates`. These were pinned to March 2026, the exact month the
 * project has already been burned by: once it passed, the transport list folded
 * every fixture into its collapsed "Past transports" accordion and the
 * assertions hunted for rows that were rendered and hidden. The offsets are what
 * these tests are about — a stay inside the trip, a second that does not overlap
 * it, a third that does — so the offsets are what is preserved here.
 */
const TEST_DATA = {
  trip: {
    name: 'E2E Test Trip',
    location: 'Test Location',
    // Ten days, always ahead of today.
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
  },
  room: {
    name: 'Master Bedroom',
    capacity: '2',
    description: 'Main bedroom with king bed',
  },
  room2: {
    name: 'Guest Room',
    capacity: '1',
    description: 'Small guest room',
  },
  person: {
    name: 'Alice Test',
  },
  person2: {
    name: 'Bob Test',
  },
  assignment: {
    // Dates within trip range
    startDate: fixtureDate(2),
    endDate: fixtureDate(5),
  },
  assignment2: {
    // Non-overlapping dates for second assignment
    startDate: fixtureDate(6),
    endDate: fixtureDate(8),
  },
  overlappingAssignment: {
    // Overlapping with first assignment
    startDate: fixtureDate(4),
    endDate: fixtureDate(7),
  },
  editedAssignment: {
    // New dates for edited assignment
    startDate: fixtureDate(3),
    endDate: fixtureDate(6),
  },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a new trip directly via IndexedDB for testing purposes.
 * This is more reliable than UI-based creation for test setup.
 */
async function createTestTrip(page: Page): Promise<string> {
  // Navigate to trips page to ensure the database is initialized
  await page.goto('/trips');
  await page.waitForLoadState('load');

  // Create trip directly in IndexedDB
  const tripId = await page.evaluate(
    async ({ startDate, endDate, name, location }) => {
      const id = `room-trip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const shareId = `share-${Math.random().toString(36).substr(2, 10)}`;
      const now = Date.now();

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikouchou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('trips', 'readwrite');
          const store = tx.objectStore('trips');

          const trip = {
            id,
            shareId,
            name,
            location,
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
    {
      startDate: TEST_DATA.trip.startDate,
      endDate: TEST_DATA.trip.endDate,
      name: TEST_DATA.trip.name,
      location: TEST_DATA.trip.location,
    },
  );

  expect(tripId).toBeTruthy();
  return tripId;
}

/**
 * Creates a room directly via IndexedDB.
 */
async function createRoomViaDB(
  page: Page,
  tripId: string,
  roomData: { name: string; capacity: number; description?: string },
  order: number = 0,
): Promise<string> {
  return page.evaluate(
    async ({ tripId, roomData, order }) => {
      const id = `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikouchou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('rooms', 'readwrite');
          const store = tx.objectStore('rooms');

          const room = {
            id,
            tripId,
            name: roomData.name,
            capacity: roomData.capacity,
            description: roomData.description,
            order,
            icon: 'bed-double',
          };

          store.add(room);

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
    { tripId, roomData, order },
  );
}

/**
 * Creates a person directly via IndexedDB.
 */
async function createPersonViaDB(
  page: Page,
  tripId: string,
  personData: { name: string; color?: string },
): Promise<string> {
  return page.evaluate(
    async ({ tripId, personData }) => {
      const id = `person-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const colors = ['#EF4444', '#F97316', '#22C55E', '#3B82F6', '#8B5CF6'];
      const color = personData.color ?? colors[Math.floor(Math.random() * colors.length)];

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikouchou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('persons', 'readwrite');
          const store = tx.objectStore('persons');

          const person = {
            id,
            tripId,
            name: personData.name,
            color,
          };

          store.add(person);

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
    { tripId, personData },
  );
}

/**
 * Creates an assignment directly via IndexedDB.
 */
async function createAssignmentViaDB(
  page: Page,
  tripId: string,
  roomId: string,
  personId: string,
  startDate: string,
  endDate: string,
): Promise<string> {
  return page.evaluate(
    async ({ tripId, roomId, personId, startDate, endDate }) => {
      const id = `assignment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return new Promise<string>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikouchou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('roomAssignments', 'readwrite');
          const store = tx.objectStore('roomAssignments');

          const assignment = {
            id,
            tripId,
            roomId,
            personId,
            startDate,
            endDate,
          };

          store.add(assignment);

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
}

/**
 * Every room assignment stored for a trip, as the database holds them.
 *
 * Several tests below turn on whether a row was written at all — "the dialog is
 * still open" and "the save is still in flight" look identical from the DOM,
 * and one of them is a passing capacity check while the other is a slow
 * success.
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

/**
 * The number of nights a stay occupies under the check-in / check-out model:
 * the check-out day is the morning the guest leaves, not a night.
 *
 * Derived from the fixture dates rather than hardcoded, so those can move.
 */
function nightCount(startDate: string, endDate: string): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  // UTC arithmetic: a local-time subtraction is off by an hour across a DST
  // boundary, and off by a whole night once rounded.
  return Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / DAY_MS,
  );
}

/**
 * Clicks a page's "add" affordance, whichever of the two is on screen.
 *
 * This replaces `page.locator('button.fixed')` — the mobile FAB named by a
 * Tailwind class, which any styling change breaks silently — read through a
 * chain of instant `isVisible()` calls taken right after
 * `waitForLoadState('load')`, which races the lazy route every time. The header
 * button and the FAB carry the same accessible name and exactly one of them is
 * visible at a given viewport, so a retrying count both waits for the route and
 * asserts there is one unambiguous way in.
 */
async function clickAddButton(page: Page, name: RegExp): Promise<void> {
  const addButton = page.getByRole('button', { name }).filter({ visible: true });
  await expect(addButton).toHaveCount(1);
  await addButton.click();
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
  // cosmetic: the popover is itself a `role="dialog"`, so anything reading
  // `getByRole('dialog')` afterwards would match two elements.
  await expect(calendar).toBeHidden();
}

/**
 * Closes the assignment dialog through the discard confirmation.
 *
 * Escape alone is not enough once the form holds anything: the dialog raises a
 * "Discard changes?" `alertdialog` that has to be answered, or the form stays
 * open and the next assertion times out on the wrong element.
 */
async function discardAssignmentDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /^(discard|abandonner)$/i })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });
}

/**
 * Navigates to the rooms page for a given trip.
 *
 * Defaults to `?view=card` for the same reason as the calendar: the rooms page
 * defaults to the timeline view, which renders no room cards — so the
 * `[role="listitem"]` a caller clicks to expand a room does not exist there.
 * Pass `'timeline'` for the drag-and-drop flow, which lives only there.
 */
async function navigateToRooms(
  page: Page,
  tripId: string,
  view: 'card' | 'timeline' = 'card',
): Promise<void> {
  await page.goto(`/trips/${tripId}/rooms?view=${view}`);
  await page.waitForLoadState('load');
  // Wait for loading to complete
  await page.waitForFunction(() => {
    return !document.body.textContent?.toLowerCase().includes('loading');
  }, { timeout: 10000 }).catch(() => {
    // Timeout is ok - loading might have already finished
  });
}

/**
 * Navigates to the persons page for a given trip.
 */
async function navigateToPersons(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/persons`);
  await page.waitForLoadState('load');
  await page.waitForFunction(() => {
    return !document.body.textContent?.toLowerCase().includes('loading');
  }, { timeout: 10000 }).catch(() => {});
}

/**
 * Navigates to the calendar page for a given trip, in month view.
 *
 * `?view=card` is not decoration. The calendar defaults to the timeline view,
 * which renders no `role="grid"` at all, so callers waiting for the month grid
 * waited out their timeout instead.
 */
async function navigateToCalendar(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/calendar?view=card`);
  await page.waitForLoadState('load');
  await page.waitForFunction(() => {
    return !document.body.textContent?.toLowerCase().includes('loading');
  }, { timeout: 10000 }).catch(() => {});
}

/**
 * Creates a room in the current trip.
 */
async function createRoom(
  page: Page,
  roomData: { name: string; capacity: string; description?: string }
): Promise<void> {
  await clickAddButton(page, /^(new room|nouvelle chambre)$/i);

  // Wait for dialog to open
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

  // Fill room name (id="room-name" from RoomForm)
  await page.locator('#room-name').fill(roomData.name);

  // Fill capacity (id="room-capacity")
  await page.locator('#room-capacity').fill(roomData.capacity);

  // Fill description if provided (id="room-description")
  if (roomData.description) {
    await page.locator('#room-description').fill(roomData.description);
  }

  // Save the room
  const saveButton = page.getByRole('dialog').getByRole('button', { name: /save|sauvegarder/i });
  await saveButton.click();

  // Wait for dialog to close
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });

  // Verify room appears in the list
  await expect(page.getByText(roomData.name)).toBeVisible({ timeout: 5000 });
}

/**
 * Creates a person/guest in the current trip.
 */
async function createPerson(
  page: Page,
  personData: { name: string }
): Promise<void> {
  await clickAddButton(page, /^(new guest|nouveau participant)$/i);

  // Wait for dialog to open
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

  // Fill person name (id="person-name" from PersonForm)
  await page.locator('#person-name').fill(personData.name);

  // Color is auto-selected - no action needed

  // Save the person
  const saveButton = page.getByRole('dialog').getByRole('button', { name: /save|sauvegarder/i });
  await saveButton.click();

  // Wait for dialog to close
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });

  // Verify person appears
  await expect(page.getByText(personData.name)).toBeVisible({ timeout: 5000 });
}

/**
 * Drags one element onto another in a way dnd-kit actually notices.
 *
 * `locator.dragTo()` is not enough here, and its failure mode is a silent
 * no-op rather than an error. `RoomListPage` configures dnd-kit's `MouseSensor`
 * with an 8px activation constraint and then tracks the pointer through
 * `mousemove` events on the document: the drag only begins on the first move
 * past 8px, and the drop target is resolved from the pointer delta accumulated
 * by the moves that follow. Playwright's built-in drag emits too few moves, and
 * they jump straight to the destination — so the sensor either never activates
 * or activates at the destination with nothing left to travel, and `onDragEnd`
 * fires with `over === null`.
 *
 * Nudging past the threshold first and then travelling in steps produces the
 * event stream a real pointer would.
 */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();

  const from = await source.boundingBox();
  const to = await target.boundingBox();

  if (!from || !to) {
    throw new Error('Cannot drag: source or target has no bounding box');
  }

  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height / 2;
  const toX = to.x + to.width / 2;
  const toY = to.y + to.height / 2;

  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  // Clear the 8px activation constraint before setting off.
  await page.mouse.move(fromX + 12, fromY, { steps: 5 });
  await page.mouse.move(toX, toY, { steps: 20 });
  // One more move at rest: dnd-kit resolves the collision on the last move it
  // saw, and a drop that lands exactly on the final step of a travel is worth
  // confirming rather than assuming.
  await page.mouse.move(toX, toY);
  await page.mouse.up();
}

/**
 * Opens the room assignment section for a specific room by clicking on the room card.
 */
async function openRoomAssignments(page: Page, roomName: string): Promise<void> {
  // Click on the room card to expand it
  const roomCard = page.locator('[role="listitem"]').filter({ hasText: roomName });
  await roomCard.click();

  // Wait for assignment section to be visible
  await expect(page.getByText(/assignments|affectations/i).first()).toBeVisible({ timeout: 5000 });
}

// ============================================================================
// Test Suite: Room Assignment Flow
// ============================================================================

test.describe('Room Assignment Flow', () => {
  let tripId: string;

  // Clear IndexedDB before each test to ensure clean state
  test.beforeEach(async ({ page }) => {
    // Navigate to the app first (needed to access IndexedDB context)
    await page.goto('/');
    await clearIndexedDB(page);
    // Reload to apply the cleared state
    await page.reload();
  });

  // --------------------------------------------------------------------------
  // Test 1: Adds room to trip
  // --------------------------------------------------------------------------
  test('adds room to trip', async ({ page }) => {
    // Create a test trip first
    tripId = await createTestTrip(page);

    // Navigate to rooms page
    await navigateToRooms(page, tripId);

    // Create the room
    await createRoom(page, TEST_DATA.room);

    // Verify the room was created and is visible
    await expect(page.getByText(TEST_DATA.room.name)).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Test 2: Adds person/guest to trip
  // --------------------------------------------------------------------------
  test('adds person/guest to trip', async ({ page }) => {
    tripId = await createTestTrip(page);

    // Navigate to persons page
    await navigateToPersons(page, tripId);

    // Create the person
    await createPerson(page, TEST_DATA.person);

    // Verify the person was created
    await expect(page.getByText(TEST_DATA.person.name)).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Test 3: Assigns person to room for date range
  // --------------------------------------------------------------------------
  test('assigns person to room for date range', async ({ page }) => {
    tripId = await createTestTrip(page);

    // Create room, person, and assignment via IndexedDB for reliable setup
    const roomId = await createRoomViaDB(page, tripId, {
      name: TEST_DATA.room.name,
      capacity: parseInt(TEST_DATA.room.capacity, 10),
      description: TEST_DATA.room.description,
    });
    const personId = await createPersonViaDB(page, tripId, { name: TEST_DATA.person.name });
    await createAssignmentViaDB(
      page,
      tripId,
      roomId,
      personId,
      TEST_DATA.assignment.startDate,
      TEST_DATA.assignment.endDate,
    );

    // Reload to ensure contexts pick up the data
    await page.reload();
    await page.waitForLoadState('load');

    // Navigate to calendar to verify assignment shows
    await navigateToCalendar(page, tripId);

    // Wait for calendar grid to be visible
    await page.waitForSelector('[role="grid"]', { state: 'visible', timeout: 10000 });

    // The calendar should show the assignment (person's name in a pill/badge).
    // `.first()`: a multi-day stay renders one bar segment per spanned cell, so
    // this legitimately matches more than one element.
    await expect(page.getByText(new RegExp(TEST_DATA.person.name, 'i')).first()).toBeVisible({ timeout: 10000 });

    // One bar per night, each labelled with the guest *and* the room. The name
    // match above is satisfied by any list of guests on the page; this is the
    // stay itself, and its length.
    await expect(
      page.getByRole('button', {
        name: `${TEST_DATA.person.name} - ${TEST_DATA.room.name}`,
        exact: true,
      }),
    ).toHaveCount(nightCount(TEST_DATA.assignment.startDate, TEST_DATA.assignment.endDate));

    // Also verify on rooms page - expand room to see assignment
    await navigateToRooms(page, tripId);
    await openRoomAssignments(page, TEST_DATA.room.name);

    // Verify person's name appears in the assignment section
    await expect(page.getByText(TEST_DATA.person.name)).toBeVisible({ timeout: 5000 });
  });

  // --------------------------------------------------------------------------
  // Test 4: Warns when a second guest would fill the room past its capacity
  //
  // Named for what the dialog actually does. Capacity here is deliberately
  // soft — `computedCapacityWarning` is not part of `isFormValid`, so the save
  // is still allowed — and a test asserting prevention would be asserting a
  // behaviour the product does not have. What it must not do is stay silent.
  // --------------------------------------------------------------------------
  test('warns when a second guest would put the room over capacity', async ({ page }) => {
    tripId = await createTestTrip(page);

    // Setup: Create room and TWO persons via IndexedDB
    const roomId = await createRoomViaDB(page, tripId, {
      name: TEST_DATA.room.name,
      capacity: 1, // Room can only hold 1 person - this ensures conflict
      description: TEST_DATA.room.description,
    });
    const person1Id = await createPersonViaDB(page, tripId, { name: TEST_DATA.person.name });
    const person2Name = 'Bob Conflicting';
    // person2Id is created but not directly used - the person is referenced by name in UI
    await createPersonViaDB(page, tripId, { name: person2Name });

    // Create first assignment via IndexedDB (days 2-5) for person1
    await createAssignmentViaDB(
      page,
      tripId,
      roomId,
      person1Id,
      TEST_DATA.assignment.startDate,
      TEST_DATA.assignment.endDate,
    );

    // Reload to ensure contexts pick up the data
    await page.reload();
    await page.waitForLoadState('load');

    // Navigate to rooms
    await navigateToRooms(page, tripId);
    await openRoomAssignments(page, TEST_DATA.room.name);

    // Verify first assignment exists
    await expect(page.getByText(TEST_DATA.person.name)).toBeVisible();

    // Add a second guest over the same nights, in a room with one bed.
    const roomItem = page.locator('[role="listitem"]').filter({ hasText: TEST_DATA.room.name });
    await roomItem
      .getByRole('button', { name: /^(assign a room|attribuer une chambre)$/i })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.locator('#person-select').click();
    await page.getByRole('option', { name: new RegExp(person2Name, 'i') }).click();

    // The dates are what make this an over-capacity request, and the test this
    // replaces never set them: it opened the form, waited 500 ms and accepted
    // "any role=alert exists" (every Sonner toast is one) OR "the button is
    // disabled" (it was — for having no dates yet) OR "the dialog is still
    // open" (which is also what a slow success looks like). It passed with
    // capacity checking deleted outright.
    await pickStayDates(page, TEST_DATA.assignment.startDate, TEST_DATA.assignment.endDate);

    // The warning, inside the dialog, by its own copy.
    await expect(
      dialog.getByRole('alert').filter({ hasText: /over capacity|surchargée/i }),
    ).toBeVisible();

    // And nothing has been written: the guest is not in the room yet, which is
    // the fact the DOM cannot distinguish from a save still in flight.
    expect(await getTripAssignmentsFromDB(page, tripId)).toHaveLength(1);

    await discardAssignmentDialog(page);
    expect(await getTripAssignmentsFromDB(page, tripId)).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // Test 4b: The assignment the form genuinely refuses
  //
  // Capacity is a warning; a guest sleeping in two rooms on the same night is
  // not. `isFormValid` excludes `conflictError`, so this is the one path where
  // the save is actually blocked — and nothing covered it.
  // --------------------------------------------------------------------------
  test('blocks assigning a guest who already has a room those nights', async ({ page }) => {
    tripId = await createTestTrip(page);

    const roomId = await createRoomViaDB(page, tripId, {
      name: TEST_DATA.room.name,
      capacity: parseInt(TEST_DATA.room.capacity, 10),
    });
    const otherRoomId = await createRoomViaDB(
      page,
      tripId,
      { name: TEST_DATA.room2.name, capacity: parseInt(TEST_DATA.room2.capacity, 10) },
      1,
    );
    const personId = await createPersonViaDB(page, tripId, { name: TEST_DATA.person.name });

    // The guest already sleeps in the other room for these nights.
    await createAssignmentViaDB(
      page,
      tripId,
      otherRoomId,
      personId,
      TEST_DATA.assignment.startDate,
      TEST_DATA.assignment.endDate,
    );

    await page.reload();
    await page.waitForLoadState('load');

    await navigateToRooms(page, tripId);
    await openRoomAssignments(page, TEST_DATA.room.name);

    const roomItem = page.locator('[role="listitem"]').filter({ hasText: TEST_DATA.room.name });
    await roomItem
      .getByRole('button', { name: /^(assign a room|attribuer une chambre)$/i })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.locator('#person-select').click();
    await page.getByRole('option', { name: new RegExp(TEST_DATA.person.name) }).click();

    // Overlapping the existing stay by a night is enough — back-to-back stays
    // are a room move, not a double booking.
    await pickStayDates(
      page,
      TEST_DATA.overlappingAssignment.startDate,
      TEST_DATA.overlappingAssignment.endDate,
    );

    await expect(
      dialog.getByRole('alert').filter({ hasText: /already assigned|déjà assign/i }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^(add|ajouter)$/i })).toBeDisabled();

    await discardAssignmentDialog(page);

    // Still one stay, still in the other room.
    expect(await getTripAssignmentsFromDB(page, tripId)).toEqual([
      {
        roomId: otherRoomId,
        startDate: TEST_DATA.assignment.startDate,
        endDate: TEST_DATA.assignment.endDate,
      },
    ]);
    expect(otherRoomId).not.toBe(roomId);
  });

  // --------------------------------------------------------------------------
  // Test 5: Edits existing assignment - verifies edit dialog opens with data
  // --------------------------------------------------------------------------
  test('edits existing assignment', async ({ page }) => {
    tripId = await createTestTrip(page);

    // Setup via IndexedDB
    const roomId = await createRoomViaDB(page, tripId, {
      name: TEST_DATA.room.name,
      capacity: parseInt(TEST_DATA.room.capacity, 10),
      description: TEST_DATA.room.description,
    });
    const personId = await createPersonViaDB(page, tripId, { name: TEST_DATA.person.name });

    // Create initial assignment via IndexedDB (days 2-5)
    await createAssignmentViaDB(
      page,
      tripId,
      roomId,
      personId,
      TEST_DATA.assignment.startDate,
      TEST_DATA.assignment.endDate,
    );

    // Reload to ensure contexts pick up the data
    await page.reload();
    await page.waitForLoadState('load');

    // Navigate to rooms
    await navigateToRooms(page, tripId);
    await openRoomAssignments(page, TEST_DATA.room.name);

    // Verify assignment exists
    await expect(page.getByText(TEST_DATA.person.name)).toBeVisible();

    // Find and click the edit button on the assignment
    const assignmentItem = page.locator('[role="listitem"]').filter({
      hasText: TEST_DATA.person.name
    }).last();

    // The edit button has a Pencil icon (first button in the item)
    const editButton = assignmentItem.locator('button').first();
    await editButton.click();

    // Wait for edit dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify the dialog shows edit mode (has "Edit" or "Modifier" in title or save button)
    const dialogContent = await dialog.textContent();
    expect(dialogContent?.toLowerCase()).toMatch(/edit|modifier|save|sauvegarder/i);

    // Verify person is pre-selected (their name should appear in the dialog)
    await expect(dialog.getByText(TEST_DATA.person.name)).toBeVisible();

    // Close the dialog without making changes
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // Verify the assignment is still visible
    await expect(page.getByText(TEST_DATA.person.name)).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Test 6: Deletes assignment with confirmation
  // --------------------------------------------------------------------------
  test('deletes assignment with confirmation', async ({ page }) => {
    tripId = await createTestTrip(page);

    // Use a unique name for this test to avoid conflicts
    const uniquePersonName = 'DeleteMe Person';

    // Setup via IndexedDB
    const roomId = await createRoomViaDB(page, tripId, {
      name: TEST_DATA.room.name,
      capacity: parseInt(TEST_DATA.room.capacity, 10),
      description: TEST_DATA.room.description,
    });
    const personId = await createPersonViaDB(page, tripId, { name: uniquePersonName });

    // Create assignment via IndexedDB (days 2-5)
    await createAssignmentViaDB(
      page,
      tripId,
      roomId,
      personId,
      TEST_DATA.assignment.startDate,
      TEST_DATA.assignment.endDate,
    );

    // Reload to ensure contexts pick up the data
    await page.reload();
    await page.waitForLoadState('load');

    // Navigate to rooms
    await navigateToRooms(page, tripId);
    await openRoomAssignments(page, TEST_DATA.room.name);

    // Verify assignment exists
    await expect(page.getByText(uniquePersonName)).toBeVisible();

    // Find the assignment item
    const assignmentItem = page.locator('[role="listitem"]').filter({
      hasText: uniquePersonName
    });

    // The delete button has aria-label="Delete" or "Supprimer"
    const deleteButton = assignmentItem.getByRole('button', { name: /^delete$|^supprimer$/i });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    // Wait for confirmation dialog (ConfirmDialog is a Radix AlertDialog)
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    // Verify confirmation message appears in the dialog
    // The message is "Are you sure you want to delete this assignment?"
    const dialogText = await confirmDialog.textContent();
    expect(dialogText?.toLowerCase()).toMatch(/delete|supprimer/i);

    // Click the "Delete" confirm button in the dialog footer
    // The dialog has Cancel, Delete, and Close (X) buttons
    // We need to find the button with exact text "Delete" (not the Close button)
    const confirmButton = confirmDialog.getByRole('button', { name: /^delete$|^supprimer$/i, exact: false }).first();
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Wait for dialog to close and deletion to complete
    await expect(confirmDialog).toBeHidden({ timeout: 5000 });

    // Since assignments created via IndexedDB might not trigger context updates properly,
    // reload the page to verify the deletion persisted to the database
    await page.reload();
    await page.waitForLoadState('load');

    // Re-navigate to the room assignments
    await openRoomAssignments(page, TEST_DATA.room.name);

    // `toBeHidden` passes when the locator matches nothing at all — which is
    // also what a page that never rendered looks like, and the 500 ms wait it
    // followed made that outcome likely. Assert the section is there and says
    // it is empty first, so the absence below is a real absence.
    await expect(
      page.getByText(/no room assignments yet|aucune attribution/i),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(uniquePersonName)).toBeHidden();

    // And the row is gone from storage, not just from this render.
    expect(await getTripAssignmentsFromDB(page, tripId)).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 7: Drag and drop assignment
  // --------------------------------------------------------------------------
  //
  // A drop in the timeline books the room there and then — no confirmation
  // step, because the bar the guest was dragged from already states the nights
  // and the room row states the room, so a dialog would only ask the reader to
  // re-read what they just did. (The cards view keeps its dialog for "Claim
  // this room", which starts with neither of those decided.)
  test('dragging a guest onto a room in the timeline books it', async ({ page }) => {
    tripId = await createTestTrip(page);

    /**
     * The whole fixture is written before the trip is ever opened, and both
     * halves of that sentence are load-bearing.
     *
     * *What* is seeded: a room, a guest, and the guest's arrival **and**
     * departure transports. The transports pin the guest's stay to four
     * nights inside the trip; without them they would be read as here for the
     * whole trip, which is still draggable but makes the bar span the entire
     * day axis and the assertion below say less about where it sits.
     *
     * *When*: before `navigateToRooms`, because these rows go straight into
     * IndexedDB. Once a trip is current, `YjsTripSync` mounts a document for
     * it and `syncDocToDexie` reprojects that document over Dexie — dropping
     * any row the document has never heard of. See `e2e/support/seed.ts`.
     */
    await createRoomViaDB(page, tripId, {
      name: TEST_DATA.room.name,
      capacity: parseInt(TEST_DATA.room.capacity, 10),
      description: TEST_DATA.room.description,
    });
    const personId = await createPersonViaDB(page, tripId, { name: TEST_DATA.person.name });
    await seedTransport(page, {
      tripId,
      personId,
      type: 'arrival',
      datetime: `${TEST_DATA.assignment.startDate}T10:00:00Z`,
    });
    await seedTransport(page, {
      tripId,
      personId,
      type: 'departure',
      datetime: `${TEST_DATA.assignment.endDate}T18:00:00Z`,
    });

    // The timeline view: the "needs room" row is the only place a guest with
    // no bed is draggable from. The warning card that used to carry them in
    // card view is gone — the row says the same thing on the day axis.
    await navigateToRooms(page, tripId, 'timeline');

    const needsRoomRow = page
      .getByRole('listitem')
      .filter({ has: page.locator('[data-unhoused="true"]') });
    await expect(needsRoomRow).toBeVisible();

    /**
     * dnd-kit's `useDraggable` spreads `role="button"` and
     * `aria-roledescription="draggable"` onto the node it is attached to.
     * There is no `data-draggable` attribute anywhere in the application —
     * the locator this test used to carry could never have matched anything.
     */
    // The guest's own bar inside that row, named — the treatment it replaced
    // was an empty dashed outline with the name back in the label column.
    const draggableGuest = needsRoomRow
      .locator('[aria-roledescription="draggable"]')
      .filter({ hasText: TEST_DATA.person.name });
    await expect(draggableGuest).toBeVisible();

    // Find the droppable room — its own row on the same day axis
    const droppableRoom = page.locator('[role="listitem"]').filter({
      hasText: TEST_DATA.room.name
    });
    await expect(droppableRoom).toBeVisible();

    // Perform drag and drop
    await dragOnto(page, draggableGuest, droppableRoom);

    // The guest is now a pill in the room's own row, over the nights they were
    // dragged for — and no longer in the "needs room" row, which is the whole
    // point of the two rows reading against each other.
    await expect(
      droppableRoom.getByRole('button', { name: new RegExp(TEST_DATA.person.name) }),
    ).toBeVisible({ timeout: 5000 });
    await expect(needsRoomRow).toBeHidden();

    // And it is a real booking, not just a redraw. The dates are the bar's own
    // — the guest's seeded nights, booked as dragged rather than widened to
    // the trip. (The helper projects roomId, not personId.)
    expect(await getTripAssignmentsFromDB(page, tripId)).toEqual([
      {
        roomId: expect.stringContaining('room-') as unknown as string,
        startDate: TEST_DATA.assignment.startDate,
        endDate: TEST_DATA.assignment.endDate,
      },
    ]);
  });

  // --------------------------------------------------------------------------
  // Test 8: Double-click a room name to edit it
  // --------------------------------------------------------------------------
  //
  // These two belong in a real browser rather than in jsdom, and the reason is
  // the whole difficulty of the feature. In the cards view the room name is
  // covered by the full-card activation button, which is `absolute inset-0
  // z-10`; jsdom has no layout and no stacking, so a unit test fires the double
  // click straight at the name and passes whether or not a user could ever
  // reach it. Playwright's hit-target check is what actually asserts the name
  // is on top — remove the `z-20` lift and this test fails with the button
  // named as the interceptor.
  test('double-clicking a room name in the cards view opens its edit dialog', async ({ page }) => {
    tripId = await createTestTrip(page);
    await createRoomViaDB(page, tripId, {
      name: TEST_DATA.room.name,
      capacity: parseInt(TEST_DATA.room.capacity, 10),
      description: TEST_DATA.room.description,
    });
    await navigateToRooms(page, tripId, 'card');

    const roomName = page
      .locator('[data-slot="card-title"]')
      .filter({ hasText: TEST_DATA.room.name });
    await expect(roomName).toBeVisible();
    await roomName.dblclick();

    // The same dialog the menu's Edit item opens, on the same room.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#room-name')).toHaveValue(TEST_DATA.room.name);
    await expect(page.locator('#room-capacity')).toHaveValue(TEST_DATA.room.capacity);
  });

  test('double-clicking a room name in the timeline opens its edit dialog', async ({ page }) => {
    tripId = await createTestTrip(page);
    await createRoomViaDB(page, tripId, {
      name: TEST_DATA.room.name,
      capacity: parseInt(TEST_DATA.room.capacity, 10),
      description: TEST_DATA.room.description,
    });
    await navigateToRooms(page, tripId, 'timeline');

    // The sticky label column: the only place the timeline prints a room name,
    // and the only element carrying a title that mentions it.
    const roomLabel = page.getByTitle(new RegExp(TEST_DATA.room.name));
    await expect(roomLabel).toBeVisible();
    await roomLabel.dblclick();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#room-name')).toHaveValue(TEST_DATA.room.name);
  });
});

// ============================================================================
// Cleanup
// ============================================================================

test.afterAll(async () => {
  // Tests use local IndexedDB which is isolated per browser context
  // No explicit cleanup needed as each test creates a fresh trip
});
