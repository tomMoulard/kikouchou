/**
 * @fileoverview Tests for the address book search behind the guest name field.
 *
 * @module lib/contacts/__tests__/contact-search.test
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(() => plugin),
}));

vi.mock('@/lib/platform', () => ({
  hasNativePlugin: vi.fn(() => true),
}));

import { hasNativePlugin } from '@/lib/platform';
import { MAX_LENGTHS } from '@/lib/db/sanitize';

import {
  CONTACT_SEARCH_PLUGIN,
  CONTACTS_ASKED_KEY,
  MAX_CONTACT_SUGGESTIONS,
  ensureContactsAccess,
  isContactSearchAvailable,
  searchContacts,
  toContactSuggestions,
} from '../contact-search';

const ROOT = resolve(__dirname, '../../../..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

/** jsdom is configured without web storage here, so the test brings one. */
function installMemoryLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
    },
  });
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasNativePlugin).mockReturnValue(true);
  installMemoryLocalStorage();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('isContactSearchAvailable', () => {
  it('asks for the plugin by its registered name', () => {
    expect(isContactSearchAvailable()).toBe(true);
    expect(hasNativePlugin).toHaveBeenCalledWith(CONTACT_SEARCH_PLUGIN);
  });

  it('is false where the plugin is missing, as on the web', () => {
    vi.mocked(hasNativePlugin).mockReturnValue(false);
    expect(isContactSearchAvailable()).toBe(false);
  });
});

describe('ensureContactsAccess', () => {
  it('answers false on the web without touching the plugin', async () => {
    vi.mocked(hasNativePlugin).mockReturnValue(false);

    await expect(ensureContactsAccess()).resolves.toBe(false);
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
  });

  it.each(['granted', 'limited'])('reads a %s permission without asking', async (state) => {
    plugin.checkPermissions.mockResolvedValue({ contacts: state });

    await expect(ensureContactsAccess()).resolves.toBe(true);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('asks once, and remembers that it asked', async () => {
    plugin.checkPermissions.mockResolvedValue({ contacts: 'prompt' });
    plugin.requestPermissions.mockResolvedValue({ contacts: 'granted' });

    await expect(ensureContactsAccess()).resolves.toBe(true);
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONTACTS_ASKED_KEY)).toBe('1');
  });

  it('never asks again after a refusal', async () => {
    plugin.checkPermissions.mockResolvedValue({ contacts: 'prompt' });
    plugin.requestPermissions.mockResolvedValue({ contacts: 'denied' });

    await expect(ensureContactsAccess()).resolves.toBe(false);
    // Android answers `prompt-with-rationale` after one refusal, and would
    // show the dialog again if asked.
    plugin.checkPermissions.mockResolvedValue({ contacts: 'prompt-with-rationale' });
    await expect(ensureContactsAccess()).resolves.toBe(false);

    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the OS already says no', async () => {
    plugin.checkPermissions.mockResolvedValue({ contacts: 'denied' });

    await expect(ensureContactsAccess()).resolves.toBe(false);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('reads access given later in the system settings', async () => {
    localStorage.setItem(CONTACTS_ASKED_KEY, '1');
    plugin.checkPermissions.mockResolvedValue({ contacts: 'granted' });

    await expect(ensureContactsAccess()).resolves.toBe(true);
  });

  it('answers false when the plugin fails', async () => {
    plugin.checkPermissions.mockRejectedValue(new Error('bridge gone'));

    await expect(ensureContactsAccess()).resolves.toBe(false);
  });

  it('still asks when storage is blocked', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    plugin.checkPermissions.mockResolvedValue({ contacts: 'prompt' });
    plugin.requestPermissions.mockResolvedValue({ contacts: 'granted' });

    await expect(ensureContactsAccess()).resolves.toBe(true);
  });
});

describe('toContactSuggestions', () => {
  it('makes one line per number, and one for a contact with none', () => {
    expect(
      toContactSuggestions([
        { name: 'Mary Poppins', phones: ['+33 6 12 34 56 78', '+44 20 7946 0000'] },
        { name: 'Marie Curie', phones: [] },
      ]),
    ).toEqual([
      { id: '0:0', name: 'Mary Poppins', phone: '+33 6 12 34 56 78' },
      { id: '0:1', name: 'Mary Poppins', phone: '+44 20 7946 0000' },
      { id: '1', name: 'Marie Curie' },
    ]);
  });

  it('cleans ragged values and drops a contact with no name', () => {
    expect(
      toContactSuggestions([
        { name: '  Mary   Poppins ', phones: ['  0612 ', '', 42, null] },
        { name: '   ', phones: ['0699'] },
        { phones: ['0699'] },
        null,
        'not a contact',
      ]),
    ).toEqual([{ id: '0:0', name: 'Mary Poppins', phone: '0612' }]);
  });

  it('offers one number stored twice with different spacing once', () => {
    expect(
      toContactSuggestions([{ name: 'Mary', phones: ['06 12 34', '0612 34', '+33 612 34'] }]),
    ).toEqual([
      { id: '0:0', name: 'Mary', phone: '06 12 34' },
      { id: '0:1', name: 'Mary', phone: '+33 612 34' },
    ]);
  });

  it('caps each value to what a guest can store', () => {
    const [line] = toContactSuggestions([
      { name: 'M'.repeat(500), phones: ['1'.repeat(500)] },
    ]);

    expect(line?.name).toHaveLength(MAX_LENGTHS.personName);
    expect(line?.phone).toHaveLength(MAX_LENGTHS.personPhone);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      name: `Guest ${index}`,
      phones: ['0600'],
    }));

    expect(toContactSuggestions(many)).toHaveLength(MAX_CONTACT_SUGGESTIONS);
  });

  it('answers nothing for an answer that is not a list', () => {
    expect(toContactSuggestions(undefined)).toEqual([]);
    expect(toContactSuggestions({ name: 'Mary' })).toEqual([]);
  });
});

describe('searchContacts', () => {
  it('searches the trimmed query and normalizes the answer', async () => {
    plugin.search.mockResolvedValue({ contacts: [{ name: 'Mary', phones: ['0612'] }] });

    await expect(searchContacts('  Mar ')).resolves.toEqual([
      { id: '0:0', name: 'Mary', phone: '0612' },
    ]);
    expect(plugin.search).toHaveBeenCalledWith({ query: 'Mar', limit: expect.any(Number) });
  });

  it('does not call the plugin for an empty query or on the web', async () => {
    await expect(searchContacts('   ')).resolves.toEqual([]);
    vi.mocked(hasNativePlugin).mockReturnValue(false);
    await expect(searchContacts('Mar')).resolves.toEqual([]);

    expect(plugin.search).not.toHaveBeenCalled();
  });

  it('answers nothing when the plugin fails', async () => {
    plugin.search.mockRejectedValue(new Error('Contacts permission not granted'));

    await expect(searchContacts('Mar')).resolves.toEqual([]);
  });
});

describe('the native projects', () => {
  it('ask Android for read access to the contacts, and never write access', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');

    expect(manifest).toContain('android.permission.READ_CONTACTS');
    expect(manifest).not.toContain('android.permission.WRITE_CONTACTS');
  });

  it('register the plugin under the name the page asks for, on both platforms', () => {
    expect(read('android/app/src/main/java/app/kikouchou/ContactSearchPlugin.java')).toContain(
      `name = "${CONTACT_SEARCH_PLUGIN}"`,
    );
    expect(read('android/app/src/main/java/app/kikouchou/MainActivity.java')).toContain(
      'registerPlugin(ContactSearchPlugin.class)',
    );
    expect(read('ios/App/App/ContactSearchPlugin.swift')).toContain(
      `jsName = "${CONTACT_SEARCH_PLUGIN}"`,
    );
    expect(read('ios/App/App/AppViewController.swift')).toContain(
      'registerPluginInstance(ContactSearchPlugin())',
    );
    expect(read('ios/App/App/SceneDelegate.swift')).toContain('AppViewController()');
  });

  it('explain the contacts prompt on iOS, in both languages', () => {
    expect(read('ios/App/App/Info.plist')).toContain('NSContactsUsageDescription');
    expect(read('ios/App/App/en.lproj/InfoPlist.strings')).toContain('NSContactsUsageDescription');
    expect(read('ios/App/App/fr.lproj/InfoPlist.strings')).toContain('NSContactsUsageDescription');
  });
});
