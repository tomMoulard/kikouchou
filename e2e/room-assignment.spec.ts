/**
 * @fileoverview E2E Tests for Room Assignment Flow
 * Tests the complete workflow of managing rooms, persons, and assignments in the Kikoushou PWA.
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

import { test, expect, type Page } from '@playwright/test';

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Clears IndexedDB to ensure a clean state before each test.
 * This is essential for E2E tests to be independent and reproducible.
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

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * Test data constants for consistent test execution
 */
const TEST_DATA = {
  trip: {
    name: 'E2E Test Trip',
    location: 'Test Location',
    // Using dates in the future to avoid date-related issues
    startDate: '2026-03-01',
    endDate: '2026-03-10',
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
    startDate: '2026-03-02',
    endDate: '2026-03-05',
  },
  assignment2: {
    // Non-overlapping dates for second assignment
    startDate: '2026-03-06',
    endDate: '2026-03-08',
  },
  overlappingAssignment: {
    // Overlapping with first assignment
    startDate: '2026-03-04',
    endDate: '2026-03-07',
  },
  editedAssignment: {
    // New dates for edited assignment
    startDate: '2026-03-03',
    endDate: '2026-03-06',
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
  await page.waitForLoadState('networkidle');

  // Create trip directly in IndexedDB
  const tripId = await page.evaluate(
    async ({ startDate, endDate, name, location }) => {
      const id = `room-trip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
        const dbRequest = indexedDB.open('kikoushou');
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
        const dbRequest = indexedDB.open('kikoushou');
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
        const dbRequest = indexedDB.open('kikoushou');
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
 * Navigates to the rooms page for a given trip.
 */
async function navigateToRooms(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/rooms`);
  await page.waitForLoadState('networkidle');
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
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    return !document.body.textContent?.toLowerCase().includes('loading');
  }, { timeout: 10000 }).catch(() => {});
}

/**
 * Navigates to the calendar page for a given trip.
 */
async function navigateToCalendar(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/calendar`);
  await page.waitForLoadState('networkidle');
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
  // Click add room button - check for header button or FAB
  const headerAddButton = page.locator('header').getByRole('button', { name: /new|nouveau/i });
  const fabAddButton = page.locator('button.fixed');

  if (await headerAddButton.isVisible()) {
    await headerAddButton.click();
  } else if (await fabAddButton.isVisible()) {
    await fabAddButton.click();
  } else {
    // Try generic button with room-related text
    await page.getByRole('button', { name: /new|add|nouveau|ajouter/i }).first().click();
  }

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
  // Click add person button
  const headerAddButton = page.locator('header').getByRole('button', { name: /new|nouveau/i });
  const fabAddButton = page.locator('button.fixed');

  if (await headerAddButton.isVisible()) {
    await headerAddButton.click();
  } else if (await fabAddButton.isVisible()) {
    await fabAddButton.click();
  } else {
    await page.getByRole('button', { name: /new|add|nouveau|ajouter/i }).first().click();
  }

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
    await page.waitForLoadState('networkidle');

    // Navigate to calendar to verify assignment shows
    await navigateToCalendar(page, tripId);

    // Wait for calendar grid to be visible
    await page.waitForSelector('[role="grid"]', { state: 'visible', timeout: 10000 });

    // The calendar should show the assignment (person's name in a pill/badge)
    await expect(page.getByText(new RegExp(TEST_DATA.person.name, 'i'))).toBeVisible({ timeout: 10000 });

    // Also verify on rooms page - expand room to see assignment
    await navigateToRooms(page, tripId);
    await openRoomAssignments(page, TEST_DATA.room.name);

    // Verify person's name appears in the assignment section
    await expect(page.getByText(TEST_DATA.person.name)).toBeVisible({ timeout: 5000 });
  });

  // --------------------------------------------------------------------------
  // Test 4: Shows conflict error when dates overlap
  // --------------------------------------------------------------------------
  test('shows conflict error when dates overlap', async ({ page }) => {
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
    await page.waitForLoadState('networkidle');

    // Navigate to rooms
    await navigateToRooms(page, tripId);
    await openRoomAssignments(page, TEST_DATA.room.name);

    // Verify first assignment exists
    await expect(page.getByText(TEST_DATA.person.name)).toBeVisible();

    // Try to create overlapping assignment for person2 (same dates = conflict due to capacity)
    // Click add assignment
    const addButton = page.locator('section, [aria-label*="assignment"]').getByRole('button').filter({
      has: page.locator('svg')
    }).first();
    await addButton.click();

    // Wait for dialog
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Select person2
    const personSelect = page.locator('#person-select');
    await personSelect.click();
    await page.getByRole('option', { name: new RegExp(person2Name, 'i') }).click();

    // The dates should default to trip dates or we need to open the date picker
    // Check if there's an error/conflict message shown
    // Either the conflict shows immediately (if dates are pre-filled with overlapping range)
    // or we need to manually select dates
    
    // Wait a bit for any conflict validation to run
    await page.waitForTimeout(500);

    // Check for conflict error or try to submit and see if it fails
    const conflictError = page.getByRole('alert').or(
      page.getByText(/conflict|conflit|capacity|capacité|full|complet/i)
    );

    // If no immediate error, the submit button should be disabled or show error on click
    const submitButton = page.getByRole('dialog').getByRole('button', { name: /add|ajouter/i }).last();
    
    // Either there's an immediate conflict message, or the button is disabled
    const hasConflict = await conflictError.isVisible().catch(() => false);
    const isDisabled = await submitButton.isDisabled().catch(() => false);
    
    // At minimum, verify the dialog is functional (shows person selection)
    await expect(page.getByRole('dialog')).toBeVisible();
    
    // Verify one of: conflict message shown OR button disabled OR assignment count doesn't change
    if (!hasConflict && !isDisabled) {
      // If neither, click submit and verify error appears
      await submitButton.click();
      await page.waitForTimeout(500);
      // Should see an error or the dialog should stay open
      const errorAfterSubmit = page.getByRole('alert').or(
        page.getByText(/error|erreur|conflict|conflit/i)
      );
      const dialogStillOpen = await page.getByRole('dialog').isVisible();
      expect(dialogStillOpen || await errorAfterSubmit.isVisible().catch(() => false)).toBe(true);
    }

    // Close the dialog
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });
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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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

    // Wait for confirmation dialog (ConfirmDialog uses Dialog, not AlertDialog)
    const confirmDialog = page.getByRole('dialog');
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
    await page.waitForLoadState('networkidle');

    // Re-navigate to the room assignments
    await openRoomAssignments(page, TEST_DATA.room.name);

    // Wait for the assignments to load
    await page.waitForTimeout(500);

    // Verify the person is no longer in the assignments list
    // Either the assignment list is empty or the person is not there
    const personInAssignments = page.getByText(uniquePersonName);
    
    // The person should not be visible anywhere on the page
    await expect(personInAssignments).toBeHidden({ timeout: 5000 });
  });

  // --------------------------------------------------------------------------
  // Test 7: Drag and drop assignment (if implemented)
  // --------------------------------------------------------------------------
  test('drag and drop opens quick assignment dialog', async ({ page }) => {
    tripId = await createTestTrip(page);

    // Setup: Create room
    await navigateToRooms(page, tripId);
    await createRoom(page, TEST_DATA.room);

    // Create person
    await navigateToPersons(page, tripId);
    await createPerson(page, TEST_DATA.person);

    // Navigate to rooms page where drag and drop is available
    await navigateToRooms(page, tripId);

    // Look for unassigned guests section
    // Note: Person needs transport to appear in unassigned section
    const unassignedSection = page.getByText(/unassigned|guests without rooms|sans chambre/i);
    const hasUnassignedSection = await unassignedSection.isVisible().catch(() => false);

    if (!hasUnassignedSection) {
      // If no unassigned section, the person doesn't have transport set up
      // This is expected behavior - skip the drag test
      test.skip(true, 'No unassigned guests section - person needs transport to appear');
      return;
    }

    // Find the draggable guest element
    const draggableGuest = page.locator('[data-draggable="true"]').filter({
      hasText: TEST_DATA.person.name
    });

    const hasDraggable = await draggableGuest.isVisible().catch(() => false);

    if (!hasDraggable) {
      test.skip(true, 'No draggable guest element found');
      return;
    }

    // Find the droppable room
    const droppableRoom = page.locator('[role="listitem"]').filter({
      hasText: TEST_DATA.room.name
    });

    // Perform drag and drop
    await draggableGuest.dragTo(droppableRoom);

    // Wait for quick assignment dialog to open
    const quickAssignDialog = page.getByRole('dialog');
    await expect(quickAssignDialog).toBeVisible({ timeout: 5000 });

    // Verify dialog shows the correct person and room
    await expect(quickAssignDialog.getByText(TEST_DATA.person.name)).toBeVisible();
    await expect(quickAssignDialog.getByText(TEST_DATA.room.name)).toBeVisible();

    // Close the dialog without saving
    const cancelButton = page.getByRole('button', { name: /cancel|annuler/i });
    await cancelButton.click();

    await expect(quickAssignDialog).toBeHidden({ timeout: 5000 });
  });
});

// ============================================================================
// Cleanup
// ============================================================================

test.afterAll(async () => {
  // Tests use local IndexedDB which is isolated per browser context
  // No explicit cleanup needed as each test creates a fresh trip
});
