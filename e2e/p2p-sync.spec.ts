import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const TEST_TRIP = {
  name: 'P2P Sync Test Trip',
  updatedName: 'P2P Sync Test Trip Updated',
  location: 'Test Island',
  startDate: '2026-08-01',
  endDate: '2026-08-10',
} as const;

async function seedTripData(page: Page): Promise<{ tripId: string }> {
  return page.evaluate(async ({ name, location, startDate, endDate }) => {
    const openRequest = indexedDB.open('kikoushou');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.onerror = () => reject(openRequest.error ?? new Error('Failed to open IndexedDB'));
      openRequest.onsuccess = () => resolve(openRequest.result);
    });

    const trip = {
      id: 'trip-owner-1',
      name,
      location,
      startDate,
      endDate,
      shareId: 'shareowner',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies Record<string, unknown>;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        ['trips', 'persons', 'rooms', 'roomAssignments', 'transports', 'settings'],
        'readwrite',
      );
      tx.objectStore('trips').put(trip);
      tx.objectStore('persons').put({
        id: 'person-owner',
        tripId: trip.id,
        name: 'Owner Guest',
        color: '#2563eb',
      });
      tx.objectStore('rooms').put({
        id: 'room-alpha',
        tripId: trip.id,
        name: 'Blue Room',
        capacity: 2,
        order: 0,
      });
      tx.objectStore('roomAssignments').put({
        id: 'assignment-owner',
        tripId: trip.id,
        roomId: 'room-alpha',
        personId: 'person-owner',
        startDate,
        endDate,
      });
      tx.objectStore('transports').put({
        id: 'transport-owner',
        tripId: trip.id,
        personId: 'person-owner',
        type: 'arrival',
        datetime: `${startDate}T12:00:00.000Z`,
        location: 'Main Station',
        needsPickup: false,
      });
      tx.objectStore('settings').put({
        id: 'settings',
        currentTripId: trip.id,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to seed trip data'));
    });

    db.close();
    return { tripId: String(trip.id) };
  }, TEST_TRIP);
}

async function enableP2PSharing(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    const randomString = (length: number) =>
      Array.from(crypto.getRandomValues(new Uint8Array(length)))
        .map((value) => alphabet[value % alphabet.length])
        .join('');

    const roomId = randomString(12);
    const key = randomString(24);

    const openRequest = indexedDB.open('kikoushou');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.onerror = () =>
        reject(openRequest.error ?? new Error('Failed to open IndexedDB'));
      openRequest.onsuccess = () => resolve(openRequest.result);
    });

    const trip = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const tx = db.transaction('trips', 'readonly');
      const request = tx.objectStore('trips').openCursor();
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to read trips'));
      request.onsuccess = () => {
        if (request.result?.value) {
          resolve(request.result.value as Record<string, unknown>);
          return;
        }
        reject(new Error('No trip found'));
      };
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('trips', 'readwrite');
      tx.objectStore('trips').put({
        ...trip,
        p2pRoomId: roomId,
        p2pEncryptionKey: key,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error('Failed to update trip credentials'));
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ id: 'settings', currentTripId: trip.id });
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error('Failed to persist currentTripId'));
    });

    db.close();
    return `${window.location.origin}/trip/${roomId}#${key}`;
  });
}

async function countTrips(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const openRequest = indexedDB.open('kikoushou');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.onerror = () =>
        reject(openRequest.error ?? new Error('Failed to open IndexedDB'));
      openRequest.onsuccess = () => resolve(openRequest.result);
    });

    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction('trips', 'readonly');
      const request = tx.objectStore('trips').count();
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to count trips'));
      request.onsuccess = () => resolve(request.result);
    });

    db.close();
    return count;
  });
}

async function countRoomUpdates(page: Page, roomId: string): Promise<number> {
  return page.evaluate(async (targetRoomId) => {
    const openRequest = indexedDB.open('kikoushou');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.onerror = () =>
        reject(openRequest.error ?? new Error('Failed to open IndexedDB'));
      openRequest.onsuccess = () => resolve(openRequest.result);
    });

    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction('yjsUpdates', 'readonly');
      const request = tx.objectStore('yjsUpdates').index('roomId').count(targetRoomId);
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to count yjs updates'));
      request.onsuccess = () => resolve(request.result);
    });

    db.close();
    return count;
  }, roomId);
}

async function renameTrip(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/edit`);
  await page.locator('#trip-name').fill(TEST_TRIP.updatedName);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(new RegExp(`/trips/${tripId}/calendar$`), { timeout: 10_000 });
}

test.describe('P2P sync via y-webrtc', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'P2P sync requires Chromium');

  let ownerContext: BrowserContext;
  let joinerContext: BrowserContext;
  let ownerPage: Page;
  let joinerPage: Page;

  test.beforeEach(async ({ browser }) => {
    ownerContext = await browser.newContext();
    joinerContext = await browser.newContext();
    ownerPage = await ownerContext.newPage();
    joinerPage = await joinerContext.newPage();
  });

  test.afterEach(async () => {
    await Promise.all([ownerContext.close(), joinerContext.close()]);
  });

  test('imports an existing trip and receives live updates from another peer', async () => {
    await ownerPage.goto('/');
    await ownerPage.waitForLoadState('load');
    const { tripId } = await seedTripData(ownerPage);
    await ownerPage.goto(`/trips/${tripId}/calendar`);
    await ownerPage.waitForLoadState('load');
    await expect(
      ownerPage.getByRole('heading', { name: TEST_TRIP.name }).first(),
    ).toBeVisible();

    const shareUrl = await enableP2PSharing(ownerPage);
    await ownerPage.reload();
    await ownerPage.waitForLoadState('load');
    const roomId = new URL(shareUrl).pathname.split('/').pop();
    if (!roomId) {
      throw new Error('Missing roomId in share URL');
    }
    await expect.poll(async () => countRoomUpdates(ownerPage, roomId)).toBeGreaterThan(0);

    // Effective check: the joiner starts in a separate isolated browser context.
    await joinerPage.goto('/');
    await expect.poll(async () => countTrips(joinerPage)).toBe(0);

    await joinerPage.goto(shareUrl);
    await expect
      .poll(() => joinerPage.evaluate(() => document.body.innerText), {
        timeout: 30_000,
      })
      .toContain(TEST_TRIP.name);
    await expect
      .poll(() => joinerPage.evaluate(() => document.body.innerText), {
        timeout: 30_000,
      })
      .toContain('Owner Guest');

    const joinerSnapshot = await joinerPage.evaluate(async (resolvedTripId) => {
      const openRequest = indexedDB.open('kikoushou');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        openRequest.onerror = () => reject(openRequest.error ?? new Error('Failed to open IndexedDB'));
        openRequest.onsuccess = () => resolve(openRequest.result);
      });

      const count = (tableName: string) =>
        new Promise<number>((resolve, reject) => {
          const tx = db.transaction(tableName, 'readonly');
          const request = tx.objectStore(tableName).count();
          request.onerror = () => reject(request.error ?? new Error(`Failed to count ${tableName}`));
          request.onsuccess = () => resolve(request.result);
        });

      const trip = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const tx = db.transaction('trips', 'readonly');
        const request = tx.objectStore('trips').get(resolvedTripId);
        request.onerror = () => reject(request.error ?? new Error('Failed to read trip'));
        request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      });

      const snapshot = {
        trip,
        persons: await count('persons'),
        rooms: await count('rooms'),
        assignments: await count('roomAssignments'),
        transports: await count('transports'),
      };
      db.close();
      return snapshot;
    }, tripId);

    expect(joinerSnapshot.trip?.name).toBe(TEST_TRIP.name);
    expect(joinerSnapshot.persons).toBeGreaterThanOrEqual(1);
    expect(joinerSnapshot.rooms).toBeGreaterThanOrEqual(1);
    expect(joinerSnapshot.assignments).toBeGreaterThanOrEqual(1);
    expect(joinerSnapshot.transports).toBeGreaterThanOrEqual(1);

    // Effective real-time check: mutate owner state after join, then verify the
    // joiner UI updates without any manual refresh.
    await renameTrip(ownerPage, tripId);
    await expect
      .poll(() => joinerPage.evaluate(() => document.body.innerText), {
        timeout: 30_000,
      })
      .toContain(TEST_TRIP.updatedName);
  });
});
