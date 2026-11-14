/**
 * @fileoverview Tests for the "Check for updates" actions.
 *
 * The hard reload is the one worth pinning hardest: it must refuse to run
 * offline, because with the worker and its caches gone a reload without a
 * network leaves no app at all.
 *
 * @module lib/pwa/__tests__/app-update
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false, liveUpdate: false }));

vi.mock('@/lib/platform', () => ({ isNativeApp: () => platform.native }));
vi.mock('@/lib/native/live-update', () => ({
  applyLiveUpdateNow: vi.fn(),
  canLiveUpdate: () => platform.liveUpdate,
}));

import {
  canCheckForAppUpdate,
  canReloadFromServer,
  checkForAppUpdate,
  reloadFromServer,
  type ClearableCaches,
  type UnregistrableContainer,
} from '../app-update';
import type { StaleBuildContainer, StaleBuildRegistration } from '../stale-build';

// ============================================================================
// Helpers
// ============================================================================

function workerContainer(registration: StaleBuildRegistration | null): StaleBuildContainer {
  return {
    controller: {},
    getRegistration: () => Promise.resolve(registration),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

function registrationWith(update: () => Promise<unknown>): StaleBuildRegistration {
  return { update, installing: null, waiting: null };
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  platform.native = false;
  platform.liveUpdate = false;
});

describe('where the button shows', () => {
  it('shows both actions on the website', () => {
    expect(canCheckForAppUpdate()).toBe(true);
    expect(canReloadFromServer()).toBe(true);
  });

  it('shows only the check in a store app with live updates', () => {
    platform.native = true;
    platform.liveUpdate = true;
    expect(canCheckForAppUpdate()).toBe(true);
    expect(canReloadFromServer()).toBe(false);
  });

  it('shows nothing in the F-Droid build, which has no live updates', () => {
    platform.native = true;
    expect(canCheckForAppUpdate()).toBe(false);
  });
});

describe('checkForAppUpdate', () => {
  it('says current on the web with the browser defaults and no worker', async () => {
    await expect(checkForAppUpdate()).resolves.toBe('current');
  });

  it('asks nothing offline', async () => {
    const update = vi.fn(() => Promise.resolve());
    const container = workerContainer(registrationWith(update));

    await expect(checkForAppUpdate({ online: false, native: false, container })).resolves.toBe('offline');
    expect(update).not.toHaveBeenCalled();
  });

  it('says current when the worker finds nothing newer', async () => {
    const container = workerContainer(registrationWith(() => Promise.resolve()));

    await expect(checkForAppUpdate({ online: true, native: false, container })).resolves.toBe('current');
  });

  it('says current when no worker serves the page', async () => {
    await expect(checkForAppUpdate({ online: true, native: false, container: null })).resolves.toBe('current');
  });

  it('says failed when the worker check fails', async () => {
    const container = workerContainer(registrationWith(() => Promise.reject(new Error('net'))));

    await expect(checkForAppUpdate({ online: true, native: false, container })).resolves.toBe('failed');
  });

  it('says installing when a newer worker is slow to take over', async () => {
    const registration: StaleBuildRegistration = {
      update: () => Promise.resolve(),
      installing: {},
      waiting: null,
    };

    await expect(
      checkForAppUpdate({ online: true, native: false, container: workerContainer(registration), timeoutMs: 1 }),
    ).resolves.toBe('installing');
  });

  it('reloads onto a newer worker', async () => {
    const reload = vi.fn();
    let takeOver: (() => void) | null = null;
    const container: StaleBuildContainer = {
      controller: {},
      getRegistration: () => Promise.resolve({ update: () => Promise.resolve(), installing: {}, waiting: null }),
      addEventListener: (_type, listener) => {
        takeOver = listener;
      },
      removeEventListener: () => undefined,
    };

    const outcome = checkForAppUpdate({ online: true, native: false, container, reload });
    await vi.waitFor(() => {
      expect(takeOver).not.toBeNull();
    });
    takeOver!();

    await expect(outcome).resolves.toBe('reloading');
  });

  it.each([
    ['reloading', 'reloading'],
    ['current', 'current'],
    ['blocked', 'failed'],
    ['failed', 'failed'],
    ['unavailable', 'failed'],
  ] as const)('in a store app, maps a live update %s to %s', async (liveOutcome, expected) => {
    const applyLiveUpdate = vi.fn(() => Promise.resolve(liveOutcome));

    await expect(checkForAppUpdate({ online: true, native: true, applyLiveUpdate })).resolves.toBe(expected);
    expect(applyLiveUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('reloadFromServer', () => {
  function browser() {
    const unregister = vi.fn(() => Promise.resolve(true));
    const remove = vi.fn<(name: string) => Promise<boolean>>(() => Promise.resolve(true));
    const container: UnregistrableContainer = {
      getRegistrations: () => Promise.resolve([{ unregister }, { unregister }]),
    };
    const caches: ClearableCaches = {
      keys: () => Promise.resolve(['workbox-precache-v2', 'osm-tiles']),
      delete: remove,
    };
    return { container, caches, unregister, remove, reload: vi.fn<() => void>() };
  }

  it('reads the network state from the browser by default', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await expect(reloadFromServer()).resolves.toBe(false);
    onLine.mockRestore();
  });

  it('uses the browser worker and caches by default', async () => {
    const { unregister, remove, reload } = browser();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: () => Promise.resolve([{ unregister }]) },
    });
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: { keys: () => Promise.resolve(['osm-tiles']), delete: remove },
    });
    try {
      await expect(reloadFromServer({ reload })).resolves.toBe(true);
      expect(unregister).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith('osm-tiles');
    } finally {
      Reflect.deleteProperty(navigator, 'serviceWorker');
      Reflect.deleteProperty(window, 'caches');
    }
  });

  it('refuses to run offline, and touches nothing', async () => {
    const { container, caches, unregister, remove, reload } = browser();

    await expect(reloadFromServer({ online: false, container, caches, reload })).resolves.toBe(false);
    expect(unregister).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('drops every worker and every cache, then reloads', async () => {
    const { container, caches, unregister, remove, reload } = browser();

    await expect(reloadFromServer({ online: true, container, caches, reload })).resolves.toBe(true);
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith('workbox-precache-v2');
    expect(remove).toHaveBeenCalledWith('osm-tiles');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(remove.mock.invocationCallOrder.at(-1)).toBeLessThan(reload.mock.invocationCallOrder[0]!);
  });

  it('still reloads when a step fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reload = vi.fn();

    await expect(
      reloadFromServer({
        online: true,
        container: { getRegistrations: () => Promise.reject(new Error('denied')) },
        caches: { keys: () => Promise.reject(new Error('denied')), delete: vi.fn() },
        reload,
      }),
    ).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('reloads where there is no worker and no Cache Storage', async () => {
    const reload = vi.fn();

    await expect(reloadFromServer({ online: true, container: null, caches: null, reload })).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
